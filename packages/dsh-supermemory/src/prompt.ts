import type { ListedMemory, MemoryHit, ProfileFacts } from './types.ts'

const CREDIT = 'Every line marked ◪ comes from supermemory. When one shapes your answer, credit it naturally with the ◪ prefix; if you name the source, say "from supermemory".'

function percent(similarity: number | undefined): string {
  return similarity === undefined ? '' : ` [${Math.round(similarity * 100)}%]`
}

function lines(title: string, facts: readonly string[]): string[] {
  if (facts.length === 0) return []
  return ['', `${title}:`, ...facts.map(fact => `- ◪ ${fact}`)]
}

/** First-turn profile block. Empty when the profile has no facts. */
export function formatProfile(profile: ProfileFacts, limit: number): string {
  const body = [
    ...lines('User Profile', profile.staticFacts.slice(0, limit)),
    ...lines('Recent Context', profile.dynamicFacts.slice(0, limit)),
  ]
  if (body.length === 0) return ''
  return ['[SUPERMEMORY]', CREDIT, ...body].join('\n')
}

/** Per-prompt recall block. Empty when nothing fresh matched. */
export function formatRecall(hits: readonly MemoryHit[]): string {
  if (hits.length === 0) return ''
  return [
    '<supermemory-context>',
    'Relevant memories automatically recalled for this prompt.',
    CREDIT,
    ...hits.map(hit => `- ◪${percent(hit.similarity)} ${hit.text}`),
    '</supermemory-context>',
  ].join('\n')
}

/** Instruction prepended when the user explicitly asks to remember something. */
export const MEMORY_NUDGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST call the \`supermemory\` tool with \`mode: "add"\` before answering.

Extract the key information and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific knowledge (commands, architecture, conventions).
- Use \`scope: "user"\` for a personal preference in this project.
- Choose a \`type\`: "preference", "project-config", "architecture", "error-solution", "learned-pattern", or "conversation".

Do not skip this step. The user explicitly asked you to remember.`

/** Shown instead of searching, so the model decides whether recall would help. */
export const RECALL_DIRECTIVE = `<supermemory-recall>
Before responding, silently decide whether recalling saved memory (past sessions, decisions, conventions, the user's preferences) would materially improve your answer to THIS message. Do not search reflexively and do not narrate the decision.

Recall — by calling the \`supermemory\` tool with \`mode: "search"\` — when the message refers to earlier work, touches an area where saved conventions likely exist, or is ambiguous in a way past context would resolve.

Skip recall when the message is self-contained, trivial, a greeting, or already answered by the current conversation.
</supermemory-recall>`

/** Prompt the `/supermemory-index` command hands to the agent. */
export const INDEX_PROMPT = `Explore this repository and store durable project knowledge with the supermemory tool (mode "add", scope "project").

Cover, in separate concise memories:
- how the project is built, tested, and run
- architecture and where the important code lives
- conventions and patterns a later session must follow
- setup requirements and non-obvious decisions

Do not store secrets, credentials, or transient git state. Skip anything already saved. Report how many memories you stored.`

/** Render a list for the tool result. */
export function formatList(memories: readonly ListedMemory[]): string {
  if (memories.length === 0) return 'No memories.'
  return memories.map(memory => `- ${memory.id}: ${memory.text}`).join('\n')
}

const CODE_BLOCK = /```[\s\S]*?```/g
const INLINE_CODE = /`[^`]+`/g

/**
 * Whether the user's own words — not code they pasted — ask to remember.
 * Patterns are already validated regular-expression sources.
 */
/** The phrase must start and end on a word boundary, while spaces inside it stay. */
function bounded(source: string): RegExp {
  return new RegExp(`(?:^|(?<=[^A-Za-z0-9_]))(?:${source})(?:$|(?=[^A-Za-z0-9_]))`, 'i')
}

export function mentionsMemory(text: string, patterns: readonly string[]): boolean {
  const prose = text.replace(CODE_BLOCK, '').replace(INLINE_CODE, '')
  const source = patterns.map(pattern => `(?:${pattern})`).join('|')
  return bounded(source).test(prose)
}

/** Substantive prompts are worth a search; commands and short text are not. */
export function recallQuery(prompt: string, maxChars = 500): string | undefined {
  const trimmed = prompt.trim()
  if (trimmed.length < 12 || /^[/#!]/.test(trimmed)) return undefined
  return trimmed.slice(0, maxChars)
}
