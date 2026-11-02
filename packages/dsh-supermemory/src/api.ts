import type { ResolvedConfig } from './types.ts'
import type {
  CaptureMessage,
  ListOutcome,
  ListedMemory,
  MemoryHit,
  MemoryScope,
  MemoryScopeTags,
  MemoryType,
  ProfileFacts,
  ProfileOutcome,
  SearchOutcome,
  WriteOutcome,
} from './types.ts'

const SOURCE = 'dsh'

/** Tells Supermemory which facts in a coding conversation are worth keeping. */
const SUPPORTING_CONTEXT = `Shared coding-agent memory for one software repository.
Remember decisions, lessons, preferences, conventions, and durable project knowledge.
Condense the conversation into outcomes a later session can use.
Skip secrets, transient git state, command output, and implementation chatter.`
const REQUEST_TIMEOUT_MS = 20_000

/** How a bearer is obtained. An API key and an OAuth access token look the same on the wire. */
export type TokenProvider = () => Promise<string>

interface MemoryMetadata {
  sm_source: string
  sm_scope: 'personal' | 'project'
  sm_project_id: string
  sm_project: string
  sm_capture_mode: string
  type?: MemoryType
  [key: string]: string | number | boolean | undefined
}

/** JSON request that reports HTTP failures as an error string instead of throwing. */
async function requestJson(method: 'GET' | 'POST' | 'DELETE', url: string, token: string, body: unknown, timeoutMs: number, signal?: AbortSignal): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-sm-source': SOURCE,
      },
      ...body === undefined ? {} : { body: JSON.stringify(body) },
      signal: combined,
      redirect: 'error',
    })
    const value: unknown = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, error: `Supermemory returned HTTP ${response.status}.` }
    return { ok: true, value }
  } catch (error) {
    const aborted = (error instanceof Error && error.name === 'TimeoutError') || combined.aborted
    return { ok: false, error: aborted ? 'Supermemory timed out.' : 'Supermemory is unreachable.' }
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object') {
    const record = value as { memory?: unknown; content?: unknown; text?: unknown }
    for (const candidate of [record.memory, record.content, record.text]) {
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate
    }
  }
  return ''
}

function hitsFrom(value: unknown, containerTag: string): MemoryHit[] {
  const results = value !== null && typeof value === 'object' ? (value as { results?: unknown }).results : undefined
  if (!Array.isArray(results)) return []
  return results.flatMap((item): MemoryHit[] => {
    if (item === null || typeof item !== 'object') return []
    const record = item as { id?: unknown; similarity?: unknown; score?: unknown }
    const text = textOf(item)
    if (text.length === 0) return []
    const similarity = typeof record.similarity === 'number'
      ? record.similarity
      : typeof record.score === 'number' ? record.score : undefined
    return [{
      id: typeof record.id === 'string' ? record.id : '',
      text,
      similarity,
      containerTag,
    }]
  })
}

function factsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(textOf).filter(fact => fact.trim().length > 0)
}

function scopeMetadata(scope: MemoryScope): 'personal' | 'project' {
  return scope === 'user' ? 'personal' : 'project'
}

/**
 * Supermemory v5 JSON API, the same routes the official SDK calls:
 * `POST /ns/{namespace}/document`, `/search`, `/profile`, `/list/documents`,
 * and `DELETE /ns/{namespace}/memories`.
 */
export class SupermemoryApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: TokenProvider,
    private readonly config: Pick<ResolvedConfig, 'similarityThreshold' | 'maxMemories'>,
  ) {}

  private url(container: string, path: string): string {
    return new URL(`/ns/${encodeURIComponent(container)}${path}`, this.baseUrl).toString()
  }

  async search(query: string, tags: MemoryScopeTags, scope: MemoryScope | undefined, timeoutMs: number, signal?: AbortSignal): Promise<SearchOutcome> {
    const containers = scope === 'user' ? tags.personalReads : scope === 'project' ? tags.projectReads : [tags.canonical]
    try {
      const token = await this.token()
      const responses = await Promise.all(containers.map(container => requestJson('POST', this.url(container, '/search'), token, {
        query,
        threshold: this.config.similarityThreshold,
        limit: this.config.maxMemories,
        searchMode: 'hybrid',
        rerank: 'none',
        rewriteQuery: false,
        ...scope ? { filter: { operator: 'and', operands: [{ field: 'sm_scope', operator: 'eq', value: scopeMetadata(scope) }] } } : {},
      }, timeoutMs, signal)))
      const failure = responses.find(response => !response.ok)
      if (failure && responses.every(response => !response.ok)) return { ok: false, error: failure.error }
      const hits = responses.flatMap(response => response.ok ? hitsFrom(response.value, '') : [])
      const seen = new Set<string>()
      return {
        ok: true,
        hits: hits.filter((hit) => {
          const key = hit.text.trim().toLowerCase()
          if (seen.has(key)) return false
          seen.add(key)
          return true
        }).slice(0, this.config.maxMemories),
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Supermemory authentication failed.' }
    }
  }

  async profile(tags: MemoryScopeTags, scope: MemoryScope, timeoutMs: number, signal?: AbortSignal): Promise<ProfileOutcome> {
    try {
      const token = await this.token()
      const response = await requestJson('POST', this.url(tags.canonical, '/profile'), token, {
        filter: { operator: 'and', operands: [{ field: 'sm_scope', operator: 'eq', value: scopeMetadata(scope) }] },
      }, timeoutMs, signal)
      if (!response.ok) return { ok: false, error: response.error }
      const profile = response.value !== null && typeof response.value === 'object'
        ? (response.value as { profile?: { static?: unknown; dynamic?: unknown } }).profile
        : undefined
      const facts: ProfileFacts = {
        staticFacts: factsFrom(profile?.static),
        dynamicFacts: factsFrom(profile?.dynamic),
      }
      return { ok: true, profile: facts }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Supermemory authentication failed.' }
    }
  }

  async add(content: string, tags: MemoryScopeTags, scope: MemoryScope, type: MemoryType | undefined, captureMode: string, customId?: string, signal?: AbortSignal): Promise<WriteOutcome> {
    const metadata: MemoryMetadata = {
      sm_source: SOURCE,
      sm_scope: scopeMetadata(scope),
      sm_project_id: tags.projectId,
      sm_project: tags.projectName,
      sm_capture_mode: captureMode,
      ...type ? { type } : {},
    }
    try {
      const token = await this.token()
      const response = await requestJson('POST', this.url(tags.canonical, '/document'), token, {
        content,
        supportingContext: SUPPORTING_CONTEXT,
        ...customId ? { id: customId } : {},
        metadata,
        taskType: 'memory',
        dreaming: 'dynamic',
      }, REQUEST_TIMEOUT_MS, signal)
      if (!response.ok) return { ok: false, error: response.error }
      const id = response.value !== null && typeof response.value === 'object' ? (response.value as { id?: unknown }).id : undefined
      if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'Supermemory accepted no document.' }
      return { ok: true, id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Supermemory authentication failed.' }
    }
  }

  async list(tags: MemoryScopeTags, scope: MemoryScope | undefined, limit: number, signal?: AbortSignal): Promise<ListOutcome> {
    try {
      const token = await this.token()
      const listUrl = new URL(this.url(tags.canonical, '/list/documents'))
      listUrl.searchParams.set('limit', String(limit))
      listUrl.searchParams.set('order', 'desc')
      listUrl.searchParams.set('sort', 'createdAt')
      const response = await requestJson('POST', listUrl.toString(), token, {
        ...scope ? { filter: { operator: 'and', operands: [{ field: 'sm_scope', operator: 'eq', value: scopeMetadata(scope) }] } } : {},
      }, REQUEST_TIMEOUT_MS, signal)
      if (!response.ok) return { ok: false, error: response.error }
      const documents = response.value !== null && typeof response.value === 'object'
        ? (response.value as { documents?: unknown }).documents
        : undefined
      const summaries = Array.isArray(documents) ? documents.slice(0, limit) : []
      const listed: ListedMemory[] = []
      for (const item of summaries) {
        if (item === null || typeof item !== 'object') continue
        const record = item as { id?: unknown; createdAt?: unknown; system?: { createdAt?: unknown } }
        if (typeof record.id !== 'string') continue
        const inline = textOf(item)
        const text = inline.length > 0 ? inline : await this.documentText(tags.canonical, record.id, token, signal)
        if (text.length === 0) continue
        const created = record.system?.createdAt ?? record.createdAt
        listed.push({ id: record.id, text, createdAt: typeof created === 'string' ? created : undefined })
      }
      return { ok: true, memories: listed }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Supermemory authentication failed.' }
    }
  }

  /** A list row often carries only the document id, so the text is read separately. */
  private async documentText(container: string, id: string, token: string, signal?: AbortSignal): Promise<string> {
    const response = await requestJson('GET', this.url(container, `/document/${encodeURIComponent(id)}`), token, undefined, REQUEST_TIMEOUT_MS, signal)
    return response.ok ? textOf(response.value) : ''
  }

  async forget(id: string, tags: MemoryScopeTags, signal?: AbortSignal): Promise<WriteOutcome> {
    try {
      const token = await this.token()
      const response = await requestJson('DELETE', this.url(tags.canonical, '/memories'), token, { ids: [id] }, REQUEST_TIMEOUT_MS, signal)
      if (!response.ok) return { ok: false, error: response.error }
      return { ok: true, id }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Supermemory authentication failed.' }
    }
  }

  /** Store one redacted conversation batch under a stable id. */
  async capture(id: string, messages: readonly CaptureMessage[], tags: MemoryScopeTags, signal?: AbortSignal): Promise<WriteOutcome> {
    const transcript = messages.map((message, index) => `${index + 1}. [${message.role}] ${message.text}`).join('\n')
    const content = `[Conversation ${id}]\n${transcript}`.slice(0, 24_000)
    return this.add(content, tags, 'project', 'conversation', 'automatic', id, signal)
  }
}
