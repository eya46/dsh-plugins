import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { MemoryScopeTags } from './types.ts'

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

function git(cwd: string, args: readonly string[]): string | undefined {
  try {
    const output = execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
      windowsHide: true,
    }).trim()
    return output.length > 0 ? output : undefined
  } catch {
    return undefined
  }
}

/** Git working tree root, or the directory itself when it is not a repository. */
export function projectBase(directory: string): string {
  return git(directory, ['rev-parse', '--show-toplevel']) ?? resolve(directory)
}

/**
 * Normalize a git remote to `host[:port]/path` so the same repository maps to
 * one container from https, ssh, and the `.git` suffix.
 */
export function normalizeGitRemote(remoteUrl: string): string | undefined {
  const raw = remoteUrl.trim()
  if (raw.length === 0) return undefined
  let normalized: string
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      normalized = parsed.protocol === 'file:'
        ? `file:${decodeURIComponent(parsed.pathname)}`
        : `${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ''}/${parsed.pathname.replace(/^\/+/, '')}`
    } catch {
      normalized = raw
    }
  } else {
    const scp = /^[^@]+@([^:]+):(.+)$/.exec(raw)
    normalized = scp ? `${scp[1]?.toLowerCase()}/${scp[2]}` : raw
  }
  return normalized.replace(/\.git$/i, '').replace(/\/+$/, '') || undefined
}

function remoteIdentity(directory: string): string | undefined {
  const base = projectBase(directory)
  const remote = git(base, ['remote', 'get-url', 'origin'])
  return remote ? normalizeGitRemote(remote) : undefined
}

function stablePath(directory: string): string {
  try {
    return realpathSync.native(directory)
  } catch {
    return resolve(directory)
  }
}

/** Container tag shared with the other Supermemory coding-agent plugins. */
export function memoryTags(directory: string): MemoryScopeTags {
  const base = projectBase(directory)
  const remote = remoteIdentity(directory)
  const identity = sha256(remote ?? `path:${stablePath(base)}`)
  const name = basename(base)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 72)
    .replace(/_+$/g, '') || 'unknown'
  const canonical = `repo_${name}__${identity}`
  return {
    canonical,
    projectId: identity,
    projectName: basename(base) || 'unknown',
    personalReads: [canonical],
    projectReads: [canonical],
  }
}
