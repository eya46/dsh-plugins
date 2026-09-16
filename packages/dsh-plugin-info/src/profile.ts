import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GithubReleaseSpec, InstalledPackage, PluginSource, ProfileManifest } from './types.ts'

/** Prefix DSH writes onto a profile package.json `name`. */
const PROFILE_PACKAGE_PREFIX = 'dsh-profile-'

/**
 * CLI `--profile` argument for this profile directory.
 *
 * DSH names the manifest `dsh-profile-<dir>` and the CLI flag is the
 * directory basename (`web`, `tui`, …). Prefer the manifest prefix so temp
 * test dirs still resolve; fall back to the folder name, then `web`.
 */
export function profileCliName(manifestName: string | undefined, profileDir: string): string {
  if (typeof manifestName === 'string' && manifestName.startsWith(PROFILE_PACKAGE_PREFIX)) {
    const id = manifestName.slice(PROFILE_PACKAGE_PREFIX.length).trim()
    if (id.length > 0) return id
  }
  // Split on both separators instead of `path.basename`, whose notion of a
  // separator follows the host platform: a Windows profile path would come
  // back whole (and `.`/`..` would slip through) when running on POSIX. A
  // drive-only tail is a filesystem root, whose basename is empty.
  const trimmed = profileDir.replace(/[\\/]+$/, '')
  const dirName = trimmed.split(/[\\/]/).pop() ?? ''
  if (dirName.length > 0 && dirName !== '.' && dirName !== '..' && !/^[A-Za-z]:$/.test(dirName)) return dirName
  return 'web'
}

/** `dsh plugin add …@latest` command for one registry package in this profile. */
export function pluginUpdateCommand(profileCli: string, packageName: string): string {
  return `dsh plugin --profile ${profileCli} add ${packageName}@latest`
}

/** Classify a profile dependency spec. */
export function classifySpec(spec: string): PluginSource {
  const trimmed = spec.trim()
  if (trimmed.startsWith('file:')) return 'file'
  if (trimmed.startsWith('link:')) return 'link'
  if (
    trimmed.startsWith('git+')
    || trimmed.startsWith('github:')
    || trimmed.startsWith('git://')
    || trimmed.startsWith('ssh://')
    || /\.git(?:#|$)/.test(trimmed)
  ) {
    return 'git'
  }
  if (trimmed.startsWith('.') || trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return 'file'
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('workspace:')) return 'other'
  return 'registry'
}

/** User-added plugins are the profile's own `dependencies`, not in-box bundles. */
export function listUserPlugins(manifest: ProfileManifest): Array<{ name: string, spec: string, source: PluginSource }> {
  const dependencies = manifest.dependencies ?? {}
  return Object.entries(dependencies)
    .filter(([name, spec]) => name.trim().length > 0 && spec.trim().length > 0)
    .map(([name, spec]) => ({ name, spec, source: classifySpec(spec) }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Read a profile package.json. */
export function readProfileManifest(dir: string): ProfileManifest {
  const text = readFileSync(join(dir, 'package.json'), 'utf8')
  const parsed = JSON.parse(text) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('profile package.json is not an object')
  }
  return parsed as ProfileManifest
}

/** Resolve one installed package.json from the profile directory. */
export function readInstalledPackage(profileDir: string, name: string): InstalledPackage | undefined {
  const direct = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
  const path = existsSync(direct) ? direct : resolveViaRequire(profileDir, name)
  if (path === undefined) return undefined
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const record = parsed as InstalledPackage
  return {
    name: typeof record.name === 'string' ? record.name : name,
    ...typeof record.version === 'string' && record.version.length > 0 ? { version: record.version } : {},
    ...typeof record.description === 'string' && record.description.length > 0 ? { description: record.description } : {},
    ...typeof record.homepage === 'string' && record.homepage.length > 0 ? { homepage: record.homepage } : {},
    ...record.repository === undefined ? {} : { repository: record.repository },
  }
}

function resolveViaRequire(profileDir: string, name: string): string | undefined {
  try {
    return createRequire(join(profileDir, 'package.json')).resolve(`${name}/package.json`)
  } catch {
    return undefined
  }
}

/** Turn a package `repository` field into a browsable https URL. */
export function repositoryUrlOf(repository: InstalledPackage['repository']): string | undefined {
  if (repository === undefined) return undefined
  const raw = typeof repository === 'string' ? repository : repository.url
  if (raw === undefined || raw.trim().length === 0) return undefined
  const github = parseGithubRepo(raw)
  if (github !== undefined) return `https://github.com/${github.owner}/${github.repo}`
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw.replace(/\.git$/, '')
  return raw
}

/** owner/repo extracted from common GitHub repository spellings. */
export function parseGithubRepo(input: string): { owner: string, repo: string } | undefined {
  const trimmed = input.trim()
  const patterns = [
    /^github:([^/]+)\/([^#]+)/i,
    /^(?:git\+)?https?:\/\/github\.com\/([^/]+)\/([^/#]+)/i,
    /^(?:git\+)?ssh:\/\/git@github\.com\/([^/]+)\/([^/#]+)/i,
    /^git@github\.com:([^/]+)\/([^/#]+)/i,
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(trimmed)
    if (match === null) continue
    const owner = match[1]
    const repo = match[2]?.replace(/\.git$/i, '')
    if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) continue
    return { owner, repo }
  }
  return undefined
}

const GITHUB_RELEASE_SPEC = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/releases\/download\/([^/\s]+)\/([^/\s]+)$/i

/**
 * Parse a `github.com/<owner>/<repo>/releases/download/<tag>/<asset>`
 * dependency spec into its repository, tag, and asset. Everything is derived
 * from the spec itself — no per-plugin configuration.
 */
export function parseGithubReleaseSpec(spec: string): GithubReleaseSpec | undefined {
  const match = GITHUB_RELEASE_SPEC.exec(spec.trim())
  if (match === null) return undefined
  const [rawOwner, rawRepo, rawTag, rawAsset] = match.slice(1)
  if (rawOwner === undefined || rawRepo === undefined || rawTag === undefined || rawAsset === undefined) return undefined
  try {
    return {
      owner: decodeURIComponent(rawOwner),
      repo: decodeURIComponent(rawRepo),
      tag: decodeURIComponent(rawTag),
      asset: decodeURIComponent(rawAsset),
    }
  } catch {
    return { owner: rawOwner, repo: rawRepo, tag: rawTag, asset: rawAsset }
  }
}

/**
 * Rewrite a release spec onto a newer tag. The asset file name keeps its
 * shape: an embedded version token equal to `oldVersion` is replaced by
 * `newVersion` (`dsh-skill-mcp-panel-2.0.3.tgz` → `…-2.0.4.tgz`) without
 * touching longer version numbers (`12.0.3`) that merely contain it.
 */
export function releaseDownloadUrl(spec: GithubReleaseSpec, newTag: string, newVersion: string, oldVersion: string): string {
  return `https://github.com/${spec.owner}/${spec.repo}/releases/download/${encodeURIComponent(newTag)}/${encodeURIComponent(replaceVersionToken(spec.asset, oldVersion, newVersion))}`
}

function replaceVersionToken(asset: string, from: string, to: string): string {
  if (from.length === 0 || from === to) return asset
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return asset.replace(new RegExp(`(?<![\\d.])${escaped}(?!\\d)`), to)
}
