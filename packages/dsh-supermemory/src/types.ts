/** Tunables for `@eya46/dsh-supermemory`. Secrets are not stored here. */
export interface PluginConfig {
  /** Supermemory API origin. OAuth issuer defaults to `${baseUrl}/api/auth`. */
  baseUrl?: string
  /** Minimum similarity (0–1) kept from a search. */
  similarityThreshold?: number
  /** Memories injected for one prompt. */
  maxMemories?: number
  /** Profile facts injected on the first turn. */
  maxProfileItems?: number
  /** Inject the user profile on a session's first user message. */
  injectProfile?: boolean
  /** `direct` searches every substantive prompt; `advisory` only nudges; `off` disables recall. */
  recallMode?: 'direct' | 'advisory' | 'off'
  /** Completed turns between automatic captures. `0` captures only when the session ends. */
  captureEveryNTurns?: number
  /** Extra case-insensitive keyword patterns that force a save. */
  keywordPatterns?: string[]
  /** Save a compaction summary back to Supermemory. */
  saveCompactionSummaries?: boolean
  /** Milliseconds before a recall search gives up and lets the turn continue. */
  recallTimeoutMs?: number
  /** Override the OAuth issuer. Defaults to `${baseUrl}/api/auth`. */
  oauthIssuer?: string
  /** Override the OAuth resource (MCP URL). Defaults to the `mcp.` sibling of the API host. */
  oauthResource?: string
}

/** Resolved config with every default filled in. */
export interface ResolvedConfig {
  baseUrl: string
  similarityThreshold: number
  maxMemories: number
  maxProfileItems: number
  injectProfile: boolean
  recallMode: 'direct' | 'advisory' | 'off'
  captureEveryNTurns: number
  keywordPatterns: readonly string[]
  saveCompactionSummaries: boolean
  recallTimeoutMs: number
  oauthIssuer: string | undefined
  oauthResource: string | undefined
}

/** Personal preference versus project knowledge, stored as metadata on one container. */
export type MemoryScope = 'user' | 'project'

/** Memory kinds the agent may assign when saving. */
export type MemoryType =
  | 'project-config'
  | 'architecture'
  | 'error-solution'
  | 'preference'
  | 'learned-pattern'
  | 'conversation'

export const MEMORY_SCOPES = ['user', 'project'] as const
export const MEMORY_TYPES = [
  'project-config',
  'architecture',
  'error-solution',
  'preference',
  'learned-pattern',
  'conversation',
] as const

/** Container identity for the repository the agent is working in. */
export interface MemoryScopeTags {
  /** Container every new write lands in. */
  canonical: string
  projectId: string
  projectName: string
  /** Containers searched for personal memories, canonical first. */
  personalReads: readonly string[]
  /** Containers searched for project memories, canonical first. */
  projectReads: readonly string[]
}

/** One search hit, normalized across API versions. */
export interface MemoryHit {
  id: string
  text: string
  similarity: number | undefined
  containerTag: string
}

export interface SearchOutcome {
  ok: boolean
  hits?: MemoryHit[]
  error?: string
}

export interface ProfileFacts {
  staticFacts: string[]
  dynamicFacts: string[]
}

export interface ProfileOutcome {
  ok: boolean
  profile?: ProfileFacts
  error?: string
}

export interface WriteOutcome {
  ok: boolean
  id?: string
  error?: string
}

export interface ListedMemory {
  id: string
  text: string
  createdAt: string | undefined
}

export interface ListOutcome {
  ok: boolean
  memories?: ListedMemory[]
  error?: string
}

/** Conversation fragment stored as one memory. */
export interface CaptureMessage {
  role: 'user' | 'assistant'
  text: string
}
