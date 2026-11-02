/**
 * Persistent memory for DeepSeek Harness, backed by Supermemory.
 *
 * Recall and the first-turn profile are appended to the step that triggered
 * them through `agent/pre-step`. The provider is synchronous, so a search
 * cannot live in a runtime-context section. A keyword nudge uses the same
 * step and is not replayed later.
 * Completed turns are captured when the agent goes idle. Compaction summaries
 * are saved after the fact: the summarizer request itself is sealed inside
 * `dsh-compaction-basic` and a plugin cannot amend its instruction.
 *
 * @module @eya46/dsh-supermemory
 */

import { createHash } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { boundContextSummary, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, ContextFormed } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { SupermemoryApi } from './api.ts'
import { loadCredentials } from './credentials.ts'
import { accountLabel, logout, refreshAccessToken, secureUrl, startLogin, type LoginSession, type OAuthTarget } from './oauth.ts'
import { isFullyPrivate, stripPrivateContent } from './privacy.ts'
import {
  formatList,
  formatProfile,
  formatRecall,
  INDEX_PROMPT,
  MEMORY_NUDGE,
  mentionsMemory,
  RECALL_DIRECTIVE,
  recallQuery,
} from './prompt.ts'
import { memoryTags } from './tags.ts'
import type { MemoryScope, MemoryScopeTags, MemoryType, PluginConfig, ResolvedConfig } from './types.ts'
import { MEMORY_SCOPES, MEMORY_TYPES } from './types.ts'

export const name = 'dsh-supermemory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * Memory injected by dsh-supermemory: a first-turn profile, a per-prompt
     * recall, or the nudge that follows an explicit "remember" request.
     * @persistenceAttribution
     */
    supermemory: { kind: 'supermemory' } & ContextFormed
  }
}

/** Source marking one injected memory message, with a bounded transcript summary. */
function memorySource(summary: string): { kind: 'supermemory'; form: 'notice'; summary: string } {
  return { kind: 'supermemory', form: 'notice', summary: boundContextSummary(summary) }
}

/** Present wherever an agent runs. Commands register only when that service exists. */
export const inject = ['agents', 'systemPrompt', 'tools']

const DEFAULT_PATTERNS = [
  'remember\\s+(?:that|this)',
  'please\\s+remember',
  'memorize',
  'save\\s+this',
  'note\\s+this',
  'keep\\s+in\\s+mind',
  'don\'?t\\s+forget',
  'learn\\s+this',
  'store\\s+this',
  'record\\s+this',
  'make\\s+a\\s+note',
  'take\\s+note',
  'jot\\s+down',
  'commit\\s+to\\s+memory',
  'remember\\s+that',
  'never\\s+forget',
  'always\\s+remember',
]

const DEFAULT_BASE_URL = 'https://api.supermemory.ai'

/** Cordis plugin configuration. */
export interface Config extends PluginConfig {}

/** Runtime schema for {@link Config}. Invalid values reject the plugin at load. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  similarityThreshold: z.number().min(0).max(1).default(0.55),
  maxMemories: z.number().step(1).min(1).max(20).default(5),
  maxProfileItems: z.number().step(1).min(1).max(20).default(5),
  injectProfile: z.boolean().default(true),
  recallMode: z.union([z.const('direct'), z.const('advisory'), z.const('off')]).default('direct'),
  captureEveryNTurns: z.number().step(1).min(0).default(1),
  keywordPatterns: z.array(z.string()),
  saveCompactionSummaries: z.boolean().default(true),
  recallTimeoutMs: z.number().step(1).min(200).max(30_000).default(3_000),
  oauthIssuer: z.string(),
  oauthResource: z.string(),
})

const ENTITY_CONTEXT = `Shared coding-agent memory for one software repository.
Remember decisions, lessons, preferences, and durable project knowledge.
Condense assistant responses into outcomes. Skip secrets, transient git state, and command output.`

interface SessionMemory {
  /** Normalized recall texts already shown in this session. */
  seen: Set<string>
  capturing: Promise<void> | undefined
}

function resolveConfig(config: Config): ResolvedConfig {
  const patterns = [...DEFAULT_PATTERNS, ...(config.keywordPatterns ?? [])]
  for (const pattern of patterns) {
    try {
      RegExp(pattern)
    } catch {
      throw new Error(`dsh-supermemory: keyword pattern is not a valid regular expression: ${pattern}`)
    }
  }
  let baseUrl: string
  try {
    baseUrl = secureUrl(config.baseUrl ?? DEFAULT_BASE_URL)
  } catch (error) {
    throw new Error(`dsh-supermemory: baseUrl is not a usable URL (${error instanceof Error ? error.message : String(error)})`)
  }
  return {
    baseUrl,
    similarityThreshold: config.similarityThreshold ?? 0.55,
    maxMemories: config.maxMemories ?? 5,
    maxProfileItems: config.maxProfileItems ?? 5,
    injectProfile: config.injectProfile ?? true,
    recallMode: config.recallMode ?? 'direct',
    captureEveryNTurns: config.captureEveryNTurns ?? 1,
    keywordPatterns: patterns,
    saveCompactionSummaries: config.saveCompactionSummaries ?? true,
    recallTimeoutMs: config.recallTimeoutMs ?? 3_000,
    oauthIssuer: config.oauthIssuer,
    oauthResource: config.oauthResource,
  }
}

function oauthTarget(config: ResolvedConfig): OAuthTarget {
  const issuer = config.oauthIssuer ?? `${config.baseUrl}/api/auth`
  let resource = config.oauthResource
  if (resource === undefined) {
    const saved = loadCredentials()
    if (saved?.apiBaseUrl === config.baseUrl) resource = saved.resource
  }
  if (resource === undefined) {
    const api = new URL(config.baseUrl)
    if (!api.hostname.startsWith('api.')) {
      throw new Error('Set oauthResource for OAuth against a custom Supermemory backend.')
    }
    api.hostname = api.hostname.replace(/^api\./, 'mcp.')
    api.pathname = '/mcp'
    resource = api.toString().replace(/\/+$/, '')
  }
  return { apiBaseUrl: config.baseUrl, issuer: secureUrl(issuer), resource: secureUrl(resource) }
}

function blockText(block: ContentBlock): string {
  return block.type === 'text' ? block.text : ''
}

function messageText(content: readonly ContentBlock[]): string {
  return content.map(blockText).filter(text => text.trim().length > 0).join('\n')
}

function directoryOf(agent: Agent): string {
  return agent.session.header.cwd ?? process.cwd()
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/**
 * Register the memory tool, recall, capture, and the `/supermemory-*` commands.
 * @param ctx - agent context. `commands` is optional.
 * @param rawConfig - plugin configuration.
 */
export function apply(ctx: Context, rawConfig: Config): void {
  const config = resolveConfig(rawConfig)
  const sessions = new Map<string, SessionMemory>()
  let login: LoginSession | undefined

  const apiKey = (): string | undefined => process.env.SUPERMEMORY_API_KEY
  const signedIn = (): boolean => apiKey() !== undefined || loadCredentials() !== undefined

  const token = async (): Promise<string> => {
    const key = apiKey()
    if (key) return key
    return refreshAccessToken(oauthTarget(config))
  }
  const api = new SupermemoryApi(config.baseUrl, token, config)

  const stateFor = (sessionId: string): SessionMemory => {
    let state = sessions.get(sessionId)
    if (!state) {
      state = { seen: new Set(), capturing: undefined }
      sessions.set(sessionId, state)
    }
    return state
  }

  const tagsFor = (agent: Agent): MemoryScopeTags => memoryTags(directoryOf(agent))

  ctx.on('agent/pre-step', async ({ agent, messages, step }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || !signedIn()) return decision
    const userText = messages
      .filter(message => message.source.kind === 'user')
      .map(message => messageText(message.content))
      .join('\n')
    if (userText.trim().length === 0) return decision
    const state = stateFor(agent.session.id)
    const profileInjected = hasProfileInjection(agent)
    const additions = []
    if (step === 1 && mentionsMemory(userText, config.keywordPatterns)) {
      additions.push(injected(MEMORY_NUDGE, 'Remember requested'))
    }
    if (step === 1 && config.recallMode === 'advisory') {
      additions.push(injected(RECALL_DIRECTIVE, 'Recall is available'))
    }
    const recalled: string[] = []
    try {
      if (config.recallMode === 'direct') {
        const query = recallQuery(userText)
        if (query) {
          const outcome = await api.search(query, tagsFor(agent), undefined, config.recallTimeoutMs)
          if (outcome.ok && outcome.hits) {
            const fresh = outcome.hits.filter((hit) => {
              const key = hit.text.trim().toLowerCase()
              if (state.seen.has(key)) return false
              state.seen.add(key)
              return true
            })
            const block = formatRecall(fresh)
            if (block.length > 0) recalled.push(block)
          } else {
            ctx.logger.warn(`supermemory recall skipped: ${outcome.error}`)
          }
        }
      }
      if (!profileInjected && config.injectProfile) {
        const profile = await api.profile(tagsFor(agent), 'user', config.recallTimeoutMs)
        if (profile.ok && profile.profile) {
          const block = formatProfile(profile.profile, config.maxProfileItems)
          if (block.length > 0) additions.unshift(injected(block, 'Supermemory profile'))
        }
      }
    } catch (error) {
      ctx.logger.warn(`supermemory recall skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (recalled.length > 0) additions.unshift(injected(recalled.join('\n\n'), 'Supermemory recall'))
    return additions.length > 0 ? { ...decision, messages: [...decision.messages, ...additions] } : decision
  })

  ctx.on('agent/status', ({ agent, status }) => {
    if (status !== 'idle' || !signedIn()) return
    void capture(agent)
  })

  ctx.on('session/event', (session, event) => {
    if (!config.saveCompactionSummaries || !signedIn() || event.type !== 'compaction/summary') return
    const summary = event.type === 'compaction/summary' ? messageText(event.data.summary) : ''
    if (summary.trim().length < 40) return
    const agent = ctx.agents.get(SessionId(session.id))
    if (!agent) return
    const id = `dsh:compaction:${digest(`${session.id}:${event.seq}`)}`
    void api.add(stripPrivateContent(summary), tagsFor(agent), 'project', 'conversation', 'compaction', id)
      .then((outcome) => {
        if (!outcome.ok) ctx.logger.warn(`supermemory compaction save failed: ${outcome.error}`)
      })
  })

  async function capture(agent: Agent): Promise<void> {
    const state = stateFor(agent.session.id)
    const run = state.capturing ?? Promise.resolve()
    const next = run.then(() => writeCapture(agent)).catch((error: unknown) => {
      ctx.logger.warn(`supermemory capture failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    state.capturing = next
    try {
      await next
    } finally {
      if (state.capturing === next) state.capturing = undefined
    }
  }

  async function writeCapture(agent: Agent): Promise<void> {
    if (config.captureEveryNTurns === 0) return
    for (const turn of completedTurns(agent)) {
      const messages = turn.messages.map(message => ({ ...message, text: stripPrivateContent(message.text) }))
        .filter(message => message.text.trim().length > 0 && message.text.trim() !== '[REDACTED]')
      if (messages.length === 0 || !messages.some(message => message.role === 'assistant')) continue
      const id = `dsh:capture:${digest(`${agent.session.id}:${turn.turn}`)}`
      const outcome = await api.capture(id, messages, tagsFor(agent))
      if (!outcome.ok) ctx.logger.warn(`supermemory capture failed: ${outcome.error}`)
    }
  }

  ctx.tools.register(defineTool({
    name: 'supermemory',
    description: 'Save and search persistent memory that survives this session. Use "add" for a durable fact, "search" to recall, "profile" for the user profile, "list" for recent memories, and "forget" to remove one. Never store secrets or anything wrapped in <private>.',
    parameters: {
      mode: { type: 'string', enum: ['add', 'search', 'profile', 'list', 'forget', 'help'], description: 'Operation to run. Defaults to help.' },
      content: { type: 'string', description: 'Memory text for add.' },
      query: { type: 'string', description: 'Search text for search or profile.' },
      scope: { type: 'string', enum: MEMORY_SCOPES, description: 'user for a personal preference, project for repository knowledge. Defaults to project.' },
      type: { type: 'string', enum: MEMORY_TYPES, description: 'Kind of memory being saved.' },
      memoryId: { type: 'string', description: 'Memory id for forget.' },
      limit: { type: 'integer', description: 'Maximum memories listed. Defaults to 10.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec): Promise<string> {
      const agent = exec.agent
      if (!agent) return 'Supermemory needs an agent session.'
      if (!signedIn()) return 'Supermemory is not signed in. Run /supermemory-login, or set SUPERMEMORY_API_KEY.'
      const scope: MemoryScope = args.scope === 'user' ? 'user' : 'project'
      const tags = tagsFor(agent)
      switch (args.mode ?? 'help') {
        case 'help':
          return [
            'supermemory modes:',
            '- add: content, optional type and scope',
            '- search: query, optional scope',
            '- profile: optional query',
            '- list: optional scope and limit',
            '- forget: memoryId',
            'scope is "project" (default) or "user".',
          ].join('\n')
        case 'add': {
          if (!args.content) return 'content is required for add.'
          if (isFullyPrivate(args.content)) return 'Refused: the content is entirely private.'
          const outcome = await api.add(stripPrivateContent(args.content), tags, scope, args.type as MemoryType | undefined, 'tool', undefined, exec.signal)
          return outcome.ok && outcome.id ? `Saved memory ${outcome.id} (${scope}).` : `Save failed: ${outcome.error ?? 'unknown error'}`
        }
        case 'search': {
          if (!args.query) return 'query is required for search.'
          const outcome = await api.search(args.query, tags, args.scope as MemoryScope | undefined, config.recallTimeoutMs, exec.signal)
          if (!outcome.ok || !outcome.hits) return `Search failed: ${outcome.error ?? 'unknown error'}`
          return outcome.hits.length === 0
            ? 'No matching memories.'
            : outcome.hits.map(hit => `- ${hit.text}`).join('\n')
        }
        case 'profile': {
          const outcome = await api.profile(tags, 'user', config.recallTimeoutMs, exec.signal)
          if (!outcome.ok || !outcome.profile) return `Profile failed: ${outcome.error ?? 'unknown error'}`
          const rendered = formatProfile(outcome.profile, config.maxProfileItems)
          return rendered.length > 0 ? rendered : 'No profile facts yet.'
        }
        case 'list': {
          const outcome = await api.list(tags, args.scope as MemoryScope | undefined, args.limit ?? 10, exec.signal)
          return outcome.ok && outcome.memories ? formatList(outcome.memories) : `List failed: ${outcome.error ?? 'unknown error'}`
        }
        case 'forget': {
          if (!args.memoryId) return 'memoryId is required for forget.'
          const outcome = await api.forget(args.memoryId, tags, exec.signal)
          return outcome.ok && outcome.id ? `Forgot memory ${outcome.id}.` : `Forget failed: ${outcome.error ?? 'unknown error'}`
        }
        default:
          return `Unknown mode "${args.mode}". Use add, search, profile, list, forget, or help.`
      }
    },
  }))

  ctx.inject(['commands'], (commands) => {
    const register = (
      commandName: string,
      description: string,
      hint: string | undefined,
      handler: (invocation: CommandInvocation) => Promise<CommandResult>,
    ): void => {
      commands.effect(() => commands.commands.register({
        name: commandName,
        description,
        ...hint ? { input: { hint } } : {},
        handler,
      }))
    }

    register('supermemory-login', 'Sign in to Supermemory in the browser', undefined, async (invocation) => {
      if (apiKey()) return { kind: 'success', text: 'SUPERMEMORY_API_KEY is set, so OAuth is not used. Unset it to sign in with the browser.' }
      if (loadCredentials() && !invocation.rawInput.includes('again')) {
        return { kind: 'success', text: 'Already signed in. Run /supermemory-login again to replace it, or /supermemory-logout first.' }
      }
      login?.cancel()
      try {
        const session = startLogin(oauthTarget(config))
        login = session
        const consent = await Promise.race([
          session.url,
          session.done.then(() => ''),
        ])
        const result = await session.done
        return { kind: 'success', text: consent.length > 0 ? `${result}\nIf the browser did not open: ${consent}` : result }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : 'Supermemory sign-in failed.' }
      }
    })

    register('supermemory-logout', 'Revoke the saved Supermemory sign-in', undefined, async () => {
      if (apiKey()) return { kind: 'success', text: 'SUPERMEMORY_API_KEY is still set, so memory stays active until you unset it.' }
      return { kind: 'success', text: await logout() }
    })

    register('supermemory-status', 'Show the Supermemory connection and project scope', undefined, async (invocation) => {
      const tags = tagsFor(invocation.agent)
      const lines = [
        `API: ${config.baseUrl}`,
        `Auth: ${apiKey() ? 'API key' : loadCredentials() ? 'OAuth' : 'not signed in'}`,
        `Recall: ${config.recallMode}`,
        `Capture: ${config.captureEveryNTurns === 0 ? 'off' : `every ${config.captureEveryNTurns} completed turns`}`,
        `Project container: ${tags.canonical}`,
      ]
      if (!signedIn()) return { kind: 'success', text: lines.join('\n') }
      try {
        const bearer = await token()
        const account = await accountLabel(config.baseUrl, bearer, invocation.signal)
        const profile = await api.profile(tags, 'user', config.recallTimeoutMs, invocation.signal)
        lines.push(`Account: ${account ?? 'unavailable'}`)
        lines.push(`Connection: ${profile.ok ? 'ok' : profile.error}`)
        return { kind: 'success', text: lines.join('\n') }
      } catch (error) {
        lines.push(`Connection: ${error instanceof Error ? error.message : 'failed'}`)
        return { kind: 'error', text: lines.join('\n') }
      }
    })

    register('supermemory-index', 'Ask the agent to memorize this repository', undefined, (invocation) => {
      invocation.agent.followup(createUserMessage({
        content: [{ type: 'text', text: `${INDEX_PROMPT}\n\n${ENTITY_CONTEXT}` }],
        source: memorySource('Index this repository'),
      }))
      return Promise.resolve({ kind: 'success', text: 'Indexing started. The agent will explore the repository and save durable project memories.' })
    })
  })

  ctx.effect(() => async () => {
    login?.cancel()
    const pending: Promise<void>[] = []
    for (const sessionId of sessions.keys()) {
      const agent = ctx.agents.get(SessionId(sessionId))
      if (agent && signedIn()) pending.push(capture(agent))
    }
    return Promise.all(pending).then(() => undefined)
  })
}

interface CompletedTurn {
  turn: number
  messages: { role: 'user' | 'assistant'; text: string }[]
}

/** Whether this session's durable history already received its first profile injection. */
function hasProfileInjection(agent: Agent): boolean {
  return agent.session.snapshotEvents().some(event =>
    event.type === 'user/message' && event.data.source.kind === 'supermemory' && event.data.source.form === 'notice' && event.data.source.summary === 'Supermemory profile')
}

/** One injected memory message, attributed so the transcript can name it. */
function injected(text: string, summary: string): ReturnType<typeof createUserMessage> {
  return createUserMessage({ content: [{ type: 'text', text }], source: memorySource(summary) })
}

/**
 * Turn that owns a user message. User events carry no turn of their own; the
 * nearest preceding `turn/start` is the turn that claimed them.
 */
function turnOf(agent: Agent, seq: number): number | undefined {
  let turn: number | undefined
  for (const event of agent.session.snapshotEvents()) {
    if (event.seq > seq) break
    if (event.type === 'turn/start') turn = event.data.turn
  }
  return turn
}

/** User and assistant text of turns that have already closed, in order. */
function completedTurns(agent: Agent): CompletedTurn[] {
  const grouped = new Map<number, CompletedTurn>()
  for (const event of agent.session.snapshotEvents()) {
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const message = event.type === 'assistant/message' ? event.data.message : event.data
    const turn = event.type === 'assistant/message' ? event.data.turn : undefined
    const ownedTurn = turn ?? turnOf(agent, event.seq)
    if (ownedTurn === undefined) continue
    const source = message.source
    if (source.kind !== 'user' && source.kind !== 'model') continue
    const text = stripPrivateContent(messageText(message.content)).trim()
    if (text.length === 0 || text === '[REDACTED]') continue
    const entry = grouped.get(ownedTurn) ?? { turn: ownedTurn, messages: [] }
    entry.messages.push({ role: source.kind === 'user' ? 'user' : 'assistant', text })
    grouped.set(ownedTurn, entry)
  }
  return [...grouped.values()].filter(turn => turn.messages.some(message => message.role === 'assistant'))
}

export { memoryTags, normalizeGitRemote } from './tags.ts'
export { stripPrivateContent, isFullyPrivate } from './privacy.ts'
export { mentionsMemory, recallQuery, formatProfile, formatRecall } from './prompt.ts'
export type { PluginConfig, ResolvedConfig } from './types.ts'
