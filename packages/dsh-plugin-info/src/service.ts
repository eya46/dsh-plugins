import { fileURLToPath } from 'node:url'
import { hasNewerVersion } from './semver.ts'
import {
  classifySpec,
  listUserPlugins,
  parseGithubRepo,
  readInstalledPackage,
  readProfileManifest,
  repositoryUrlOf,
} from './profile.ts'
import { latestVersionOf, packumentUrl, previousPublishedVersion, recentVersions } from './registry.ts'
import type {
  Packument,
  PluginConfig,
  PluginSummary,
  PluginVersionRow,
  VersionCommit,
  VersionNotes,
} from './types.ts'

/** Fetch a JSON payload with a timeout. */
export type JsonFetcher = (url: string, timeoutMs: number, headers?: Record<string, string>) => Promise<unknown>

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

/** Query surface used by the HTTP API and tests. */
export class PluginInfoService {
  private readonly packuments = new Map<string, CacheEntry<Packument>>()
  private readonly notes = new Map<string, CacheEntry<VersionNotes>>()

  constructor(
    private readonly config: PluginConfig,
    private readonly fetchJson: JsonFetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** List user-added plugins for one profile directory. */
  async listPlugins(profileDir: string): Promise<{ profile: string, plugins: PluginSummary[] }> {
    const manifest = readProfileManifest(profileDir)
    const listed = listUserPlugins(manifest).filter((item) => isAllowedScope(item.name, this.config.allowScopes))
    const plugins = await Promise.all(listed.map(async (item) => this.describePlugin(profileDir, item.name, item.spec)))
    return { profile: manifest.name ?? profileDir, plugins }
  }

  /** Recent published versions for one user-added plugin. */
  async listVersions(profileDir: string, name: string, limit: number): Promise<{
    name: string
    installedVersion?: string
    latestVersion?: string
    versions: PluginVersionRow[]
  }> {
    const plugin = findUserPlugin(profileDir, name, this.config.allowScopes)
    const installed = readInstalledPackage(profileDir, name)
    if (plugin.source !== 'registry') {
      const installedVersion = installed?.version
      return {
        name,
        ...installedVersion === undefined ? {} : { installedVersion },
        versions: installedVersion === undefined
          ? []
          : [{ version: installedVersion, latest: false, installed: true }],
      }
    }
    const packument = await this.loadPackument(name)
    const installedVersion = installed?.version
    const latestVersion = latestVersionOf(packument)
    return {
      name,
      ...installedVersion === undefined ? {} : { installedVersion },
      ...latestVersion === undefined ? {} : { latestVersion },
      versions: recentVersions(packument, installedVersion, limit),
    }
  }

  /** Update notes for one published version. */
  async versionNotes(profileDir: string, name: string, version: string): Promise<VersionNotes> {
    findUserPlugin(profileDir, name, this.config.allowScopes)
    const cacheKey = `${name}@${version}`
    const cached = this.notes.get(cacheKey)
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.value
    const notes = await this.loadNotes(profileDir, name, version)
    this.notes.set(cacheKey, { value: notes, expiresAt: this.now() + this.config.cacheTtlMs })
    return notes
  }

  private async describePlugin(profileDir: string, name: string, spec: string): Promise<PluginSummary> {
    const source = classifySpec(spec)
    const installed = readInstalledPackage(profileDir, name)
    const installedRepository = repositoryUrlOf(installed?.repository)
    const summary: PluginSummary = {
      name,
      spec,
      source,
      hasUpdate: false,
      ...installed?.description === undefined ? {} : { description: installed.description },
      ...installed?.version === undefined ? {} : { installedVersion: installed.version },
      ...installed?.homepage === undefined ? {} : { homepage: installed.homepage },
      ...installedRepository === undefined ? {} : { repository: installedRepository },
    }
    if (source !== 'registry') return summary
    try {
      const packument = await this.loadPackument(name)
      const latestVersion = latestVersionOf(packument)
      const homepage = summary.homepage ?? packument.homepage
      const repository = summary.repository ?? repositoryUrlOf(packument.repository)
      return {
        ...summary,
        ...packument.description === undefined || summary.description !== undefined ? {} : { description: packument.description },
        ...latestVersion === undefined ? {} : { latestVersion },
        hasUpdate: hasNewerVersion(summary.installedVersion, latestVersion),
        ...homepage === undefined ? {} : { homepage },
        ...repository === undefined ? {} : { repository },
      }
    } catch (error) {
      return { ...summary, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async loadPackument(name: string): Promise<Packument> {
    const cached = this.packuments.get(name)
    if (cached !== undefined && cached.expiresAt > this.now()) return cached.value
    const payload = await this.fetchJson(packumentUrl(this.config.registryUrl, name), this.config.timeoutMs, {
      accept: 'application/json',
    })
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`registry returned a non-object packument for ${name}`)
    }
    const packument = payload as Packument
    this.packuments.set(name, { value: packument, expiresAt: this.now() + this.config.cacheTtlMs })
    return packument
  }

  private async loadNotes(profileDir: string, name: string, version: string): Promise<VersionNotes> {
    const installed = readInstalledPackage(profileDir, name)
    let packument: Packument | undefined
    try {
      packument = await this.loadPackument(name)
    } catch {
      packument = undefined
    }
    const repository = repositoryUrlOf(installed?.repository) ?? repositoryUrlOf(packument?.repository)
    const github = repository === undefined ? undefined : parseGithubRepo(repository)
    const publishedAt = packument?.time?.[version]
    const base: VersionNotes = {
      name,
      version,
      source: 'none',
      ...publishedAt === undefined ? {} : { publishedAt },
    }
    if (github === undefined) return base

    const release = await this.fetchGithubRelease(github.owner, github.repo, version)
    if (release !== undefined) {
      return {
        ...base,
        source: 'github-release',
        ...release.title === undefined ? {} : { title: release.title },
        ...release.body === undefined ? {} : { body: release.body },
        ...release.url === undefined ? {} : { url: release.url },
        ...release.publishedAt === undefined ? {} : { publishedAt: release.publishedAt },
      }
    }

    const previous = packument === undefined ? undefined : previousPublishedVersion(packument, version)
    if (previous === undefined) return base
    const compare = await this.fetchGithubCompare(github.owner, github.repo, previous, version)
    if (compare === undefined) return base
    return {
      ...base,
      source: 'github-compare',
      url: compare.url,
      commits: compare.commits,
    }
  }

  private async fetchGithubRelease(
    owner: string,
    repo: string,
    version: string,
  ): Promise<{ title?: string, body?: string, url?: string, publishedAt?: string } | undefined> {
    const tags = unique([version, `v${version}`])
    for (const tag of tags) {
      try {
        const payload = await this.fetchJson(
          `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`,
          this.config.timeoutMs,
          githubHeaders(),
        )
        if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) continue
        const record = payload as Record<string, unknown>
        if (record.message === 'Not Found') continue
        const title = typeof record.name === 'string' && record.name.length > 0 ? record.name : undefined
        const body = typeof record.body === 'string' && record.body.trim().length > 0 ? record.body : undefined
        const url = typeof record.html_url === 'string' ? record.html_url : undefined
        const publishedAt = typeof record.published_at === 'string' ? record.published_at : undefined
        return {
          ...title === undefined ? {} : { title },
          ...body === undefined ? {} : { body },
          ...url === undefined ? {} : { url },
          ...publishedAt === undefined ? {} : { publishedAt },
        }
      } catch {
        continue
      }
    }
    return undefined
  }

  private async fetchGithubCompare(
    owner: string,
    repo: string,
    previous: string,
    version: string,
  ): Promise<{ url: string, commits: VersionCommit[] } | undefined> {
    const bases = unique([previous, `v${previous}`])
    const heads = unique([version, `v${version}`])
    for (const base of bases) {
      for (const head of heads) {
        try {
          const payload = await this.fetchJson(
            `https://api.github.com/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
            this.config.timeoutMs,
            githubHeaders(),
          )
          if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) continue
          const record = payload as Record<string, unknown>
          if (!Array.isArray(record.commits)) continue
          const commits: VersionCommit[] = []
          for (const item of record.commits) {
            if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
            const commitRecord = item as Record<string, unknown>
            const sha = typeof commitRecord.sha === 'string' ? commitRecord.sha.slice(0, 7) : undefined
            const nested = commitRecord.commit
            const message = nested !== null && typeof nested === 'object' && !Array.isArray(nested)
              && typeof (nested as Record<string, unknown>).message === 'string'
              ? String((nested as Record<string, unknown>).message).split('\n')[0]
              : undefined
            if (sha === undefined || message === undefined || message.length === 0) continue
            const url = typeof commitRecord.html_url === 'string' ? commitRecord.html_url : undefined
            commits.push({ sha, message, ...url === undefined ? {} : { url } })
          }
          if (commits.length === 0) continue
          const url = typeof record.html_url === 'string'
            ? record.html_url
            : `https://github.com/${owner}/${repo}/compare/${base}...${head}`
          return { url, commits: commits.slice(-20).reverse() }
        } catch {
          continue
        }
      }
    }
    return undefined
  }
}

function findUserPlugin(profileDir: string, name: string, allowScopes?: string[]): { name: string, spec: string, source: ReturnType<typeof classifySpec> } {
  const listed = listUserPlugins(readProfileManifest(profileDir))
  const match = listed.find(item => item.name === name)
  if (match === undefined) throw new Error(`"${name}" is not a user-added plugin in this profile`)
  if (allowScopes !== undefined && !isAllowedScope(match.name, allowScopes)) {
    throw new Error(`"${name}" is filtered out by allowScopes`)
  }
  return match
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(value => value.length > 0))]
}

/** True when `name` matches one of the configured scope prefixes (empty list = allow all). */
function isAllowedScope(name: string, allowScopes: string[] | undefined): boolean {
  if (allowScopes === undefined || allowScopes.length === 0) return true
  const lower = name.toLowerCase()
  return allowScopes.some((prefix) => lower.startsWith(prefix.toLowerCase()))
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'user-agent': '@eya46/dsh-plugin-info',
  }
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
  if (token !== undefined && token.length > 0) headers.authorization = `Bearer ${token}`
  return headers
}

/** Resolve the current profile directory from the Loader base URL. */
export function profileDirFromBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error('ctx.baseUrl is unset — cannot locate the current profile')
  }
  return fileURLToPath(new URL('.', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`))
}

/** Default JSON fetch used by the live plugin. */
export async function fetchJson(url: string, timeoutMs: number, headers: Record<string, string> = {}): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)), timeoutMs)
  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`HTTP ${response.status} ${response.statusText}${text.length > 0 ? `: ${text.slice(0, 200)}` : ''}`)
    }
    return await response.json() as unknown
  } finally {
    clearTimeout(timer)
  }
}
