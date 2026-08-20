/** Where a profile dependency spec came from. */
export type PluginSource = 'registry' | 'file' | 'link' | 'git' | 'other'

/** One user-added profile plugin as the UI lists it. */
export interface PluginSummary {
  /** npm package name. */
  name: string
  /** Installed package description, when present. */
  description?: string
  /** Raw dependency spec from the profile manifest. */
  spec: string
  /** Classified install source. */
  source: PluginSource
  /** Version currently resolved in the profile. */
  installedVersion?: string
  /** `dist-tags.latest` from the registry, when known. */
  latestVersion?: string
  /** True when the registry latest is newer than the installed version. */
  hasUpdate: boolean
  /** Package homepage. */
  homepage?: string
  /** Normalized repository browse URL. */
  repository?: string
  /** Why registry / install metadata is incomplete. */
  error?: string
}

/** One published version row. */
export interface PluginVersionRow {
  version: string
  publishedAt?: string
  latest: boolean
  installed: boolean
}

/** How version notes were recovered. */
export type VersionNotesSource = 'github-release' | 'github-compare' | 'none'

/** One commit summarized from a GitHub compare. */
export interface VersionCommit {
  sha: string
  message: string
  url?: string
}

/** Update notes for one published version. */
export interface VersionNotes {
  name: string
  version: string
  source: VersionNotesSource
  publishedAt?: string
  title?: string
  body?: string
  url?: string
  commits?: VersionCommit[]
}

/** Parsed profile manifest slice this plugin reads. */
export interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  dsh?: {
    profile?: {
      bundles?: string[]
    }
  }
}

/** Installed package.json fields used by the listing. */
export interface InstalledPackage {
  name: string
  version?: string
  description?: string
  homepage?: string
  repository?: string | { url?: string, directory?: string }
}

/** npm packument subset. */
export interface Packument {
  name?: string
  description?: string
  homepage?: string
  repository?: string | { url?: string, directory?: string }
  'dist-tags'?: Record<string, string>
  versions?: Record<string, { version?: string, description?: string, homepage?: string, repository?: string | { url?: string, directory?: string } }>
  time?: Record<string, string>
}

/** Plugin configuration. */
export interface PluginConfig {
  /** npm registry origin. */
  registryUrl: string
  /** Default number of recent versions to return. */
  defaultVersionLimit: number
  /** HTTP timeout for registry / GitHub requests. */
  timeoutMs: number
  /** How long packument and notes stay cached. */
  cacheTtlMs: number
  /**
   * Optional allow-list: when omitted or empty, all profile-added plugins
   * appear in the settings page and the version/notes APIs. When non-empty,
   * only plugins whose npm name starts with one of these prefixes appear
   * (case-insensitive, e.g. `@eya46/`).
   */
  allowScopes?: string[]
}
