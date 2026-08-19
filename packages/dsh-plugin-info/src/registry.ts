import type { Packument, PluginVersionRow } from './types.ts'

/** Join a registry origin with a package name, encoding the scoped slash. */
export function packumentUrl(registryUrl: string, name: string): string {
  const base = registryUrl.replace(/\/+$/, '')
  const encoded = name.startsWith('@') ? name.replace('/', '%2f') : name
  return `${base}/${encoded}`
}

/** Latest dist-tag, when the packument has one. */
export function latestVersionOf(packument: Packument): string | undefined {
  const latest = packument['dist-tags']?.latest
  return typeof latest === 'string' && latest.length > 0 ? latest : undefined
}

/** Most recently published versions, newest first. */
export function recentVersions(
  packument: Packument,
  installedVersion: string | undefined,
  limit: number,
): PluginVersionRow[] {
  const versions = Object.keys(packument.versions ?? {})
  const time = packument.time ?? {}
  versions.sort((left, right) => timestampOf(time[right]) - timestampOf(time[left]))
  const latest = latestVersionOf(packument)
  const installed = installedVersion === undefined ? undefined : installedVersion
  return versions.slice(0, Math.max(0, limit)).map((version) => ({
    version,
    ...typeof time[version] === 'string' ? { publishedAt: time[version] } : {},
    latest: latest === version,
    installed: installed === version,
  }))
}

/** The published version immediately older than `version` by publish time. */
export function previousPublishedVersion(packument: Packument, version: string): string | undefined {
  const versions = Object.keys(packument.versions ?? {})
  const time = packument.time ?? {}
  versions.sort((left, right) => timestampOf(time[right]) - timestampOf(time[left]))
  const index = versions.indexOf(version)
  if (index < 0) return undefined
  return versions[index + 1]
}

function timestampOf(value: string | undefined): number {
  if (value === undefined) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

/** Clamp the versions query to a sane positive integer. */
export function resolveVersionLimit(raw: unknown, fallback: number): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : fallback
  if (!Number.isFinite(value)) return fallback
  return Math.min(50, Math.max(1, Math.trunc(value)))
}
