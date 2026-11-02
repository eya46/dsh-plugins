import { randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Credential directory. Tests point `SUPERMEMORY_DSH_HOME` at a temporary
 * directory; a normal run uses `~/.supermemory-dsh`.
 */
export function credentialsDir(): string {
  return process.env.SUPERMEMORY_DSH_HOME ?? join(homedir(), '.supermemory-dsh')
}

export function credentialsFile(): string {
  return join(credentialsDir(), 'credentials.json')
}

export function clientFile(): string {
  return join(credentialsDir(), 'oauth-client.json')
}

/** Public client discovered and registered against one issuer. */
export interface OAuthClientRecord {
  apiBaseUrl: string
  issuer: string
  resource: string
  clientId: string
  redirectUri: string
  authorizationEndpoint: string
  tokenEndpoint: string
  revocationEndpoint: string
}

/** Refreshable sign-in. An API key is never written here. */
export interface OAuthCredentialRecord extends OAuthClientRecord {
  type: 'oauth'
  accessToken: string
  refreshToken: string
  /** Unix epoch milliseconds when the access token expires. */
  expiresAt: number
  savedAt: string
}

const REFRESH_SKEW_MS = 60_000

function readObject(file: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function writeObject(file: string, value: unknown): void {
  mkdirSync(credentialsDir(), { recursive: true })
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  try {
    chmodSync(temporary, 0o600)
  } catch {
    // Windows does not honor the POSIX mode; the file stays inside the user profile.
  }
  renameSync(temporary, file)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Saved public client, or `undefined` when the file is missing or incomplete. */
export function loadClient(): OAuthClientRecord | undefined {
  const raw = readObject(clientFile())
  if (!raw) return undefined
  const record = {
    apiBaseUrl: text(raw.apiBaseUrl),
    issuer: text(raw.issuer),
    resource: text(raw.resource),
    clientId: text(raw.clientId),
    redirectUri: text(raw.redirectUri),
    authorizationEndpoint: text(raw.authorizationEndpoint),
    tokenEndpoint: text(raw.tokenEndpoint),
    revocationEndpoint: text(raw.revocationEndpoint),
  }
  return Object.values(record).every(item => item !== undefined)
    ? record as OAuthClientRecord
    : undefined
}

export function saveClient(record: OAuthClientRecord): void {
  writeObject(clientFile(), record)
}

export function deleteClient(): void {
  rmSync(clientFile(), { force: true })
}

/** Saved OAuth session, or `undefined` when signed out. */
export function loadCredentials(): OAuthCredentialRecord | undefined {
  const raw = readObject(credentialsFile())
  if (raw?.type !== 'oauth') return undefined
  const client = {
    apiBaseUrl: text(raw.apiBaseUrl),
    issuer: text(raw.issuer),
    resource: text(raw.resource),
    clientId: text(raw.clientId),
    redirectUri: text(raw.redirectUri),
    authorizationEndpoint: text(raw.authorizationEndpoint),
    tokenEndpoint: text(raw.tokenEndpoint),
    revocationEndpoint: text(raw.revocationEndpoint),
  }
  const accessToken = text(raw.accessToken)
  const refreshToken = text(raw.refreshToken)
  const expiresAt = raw.expiresAt
  if (Object.values(client).some(item => item === undefined)) return undefined
  if (!accessToken || !refreshToken || typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return undefined
  return {
    ...(client as OAuthClientRecord),
    type: 'oauth',
    accessToken,
    refreshToken,
    expiresAt,
    savedAt: text(raw.savedAt) ?? '',
  }
}

export function saveCredentials(record: OAuthCredentialRecord): void {
  writeObject(credentialsFile(), record)
}

export function deleteCredentials(): void {
  rmSync(credentialsFile(), { force: true })
}

/** Whether the saved access token is still inside its skew window. */
export function accessTokenUsable(record: OAuthCredentialRecord, now = Date.now()): boolean {
  return record.expiresAt > now + REFRESH_SKEW_MS
}
