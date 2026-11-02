import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import {
  deleteClient,
  deleteCredentials,
  loadClient,
  loadCredentials,
  saveClient,
  saveCredentials,
  type OAuthClientRecord,
  type OAuthCredentialRecord,
} from './credentials.ts'

export const CALLBACK_PORT = 19_880

/** Loopback callback. Tests set `SUPERMEMORY_OAUTH_PORT` to avoid the live login port. */
export function callbackPort(): number {
  const configured = Number(process.env.SUPERMEMORY_OAUTH_PORT)
  return Number.isInteger(configured) && configured > 0 && configured < 65_536 ? configured : CALLBACK_PORT
}

export function redirectUri(): string {
  return `http://127.0.0.1:${callbackPort()}/callback`
}
const OAUTH_SCOPE = 'openid profile email offline_access'
const LOGIN_TIMEOUT_MS = 5 * 60_000

export interface OAuthTarget {
  apiBaseUrl: string
  issuer: string
  resource: string
}

export class AuthError extends Error {
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
  }
}

/** HTTPS, or HTTP only for a loopback development issuer. No user info or query. */
export function secureUrl(value: string): string {
  const url = new URL(value)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  if (
    url.username || url.password || url.hash || url.search
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new Error('OAuth requires HTTPS (HTTP is allowed only for loopback development).')
  }
  return url.toString().replace(/\/+$/, '')
}

function sameTarget(record: { apiBaseUrl: string; issuer: string; resource: string } | undefined, target: OAuthTarget): boolean {
  return record?.apiBaseUrl === target.apiBaseUrl && record.issuer === target.issuer && record.resource === target.resource
}

/** Reject an endpoint that discovery points outside the issuer origin. */
function issuerEndpoint(value: unknown, issuer: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('OAuth discovery is missing an endpoint.')
  const endpoint = secureUrl(value)
  if (new URL(endpoint).origin !== new URL(issuer).origin) {
    throw new Error('OAuth endpoint does not belong to the configured issuer.')
  }
  return endpoint
}

async function oauthJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, redirect: 'error' })
  const body: unknown = await response.json().catch(() => null)
  const data = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (!response.ok) {
    const reported = String(data.error)
    const code = reported === 'invalid_grant' || reported === 'invalid_client' || reported === 'access_denied'
      ? reported
      : 'oauth_request_failed'
    throw new AuthError(`Supermemory authorization failed (${code}, HTTP ${response.status}).`, code)
  }
  return data
}

/** Reuse a saved public client, otherwise register one through discovery. */
export async function registerClient(target: OAuthTarget, signal: AbortSignal): Promise<OAuthClientRecord> {
  const saved = loadClient()
  if (sameTarget(saved, target) && saved?.redirectUri === redirectUri()) return saved
  const issuer = new URL(target.issuer)
  const metadata = await oauthJson(
    new URL(`/.well-known/oauth-authorization-server${issuer.pathname.replace(/\/$/, '')}`, issuer).toString(),
    { signal },
  )
  if (metadata.issuer !== target.issuer) throw new Error('OAuth discovery returned an unexpected issuer.')
  const client: OAuthClientRecord = {
    ...target,
    authorizationEndpoint: issuerEndpoint(metadata.authorization_endpoint, target.issuer),
    tokenEndpoint: issuerEndpoint(metadata.token_endpoint, target.issuer),
    revocationEndpoint: issuerEndpoint(metadata.revocation_endpoint, target.issuer),
    redirectUri: redirectUri(),
    clientId: '',
  }
  const registration = await oauthJson(issuerEndpoint(metadata.registration_endpoint, target.issuer), {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Supermemory for DeepSeek Harness',
      client_uri: 'https://github.com/eya46/dsh-plugins',
      software_id: 'dsh-supermemory',
      software_version: '0.1.0',
      redirect_uris: [redirectUri()],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: OAUTH_SCOPE,
    }),
  })
  if (typeof registration.client_id !== 'string' || registration.client_id.length === 0 || registration.token_endpoint_auth_method !== 'none') {
    throw new Error('OAuth registration did not return a public client.')
  }
  client.clientId = registration.client_id
  signal.throwIfAborted()
  saveClient(client)
  return client
}

interface TokenResponse {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

async function exchange(client: OAuthClientRecord, parameters: Record<string, string>, signal: AbortSignal, previous?: OAuthCredentialRecord): Promise<TokenResponse> {
  const data = await oauthJson(client.tokenEndpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, resource: client.resource, ...parameters }),
  })
  const refreshToken = typeof data.refresh_token === 'string' && data.refresh_token.length > 0
    ? data.refresh_token
    : previous?.refreshToken
  const expiresIn = data.expires_in
  if (
    typeof data.access_token !== 'string' || data.access_token.length === 0
    || typeof data.token_type !== 'string' || data.token_type.toLowerCase() !== 'bearer'
    || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn) || expiresIn <= 0
    || refreshToken === undefined
  ) {
    throw new Error('OAuth returned an invalid token response.')
  }
  return { accessToken: data.access_token, refreshToken, expiresAt: Date.now() + expiresIn * 1000 }
}

function store(client: OAuthClientRecord, token: TokenResponse): OAuthCredentialRecord {
  const record: OAuthCredentialRecord = { ...client, type: 'oauth', ...token, savedAt: new Date().toISOString() }
  saveCredentials(record)
  return record
}

const SUCCESS_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Connected - Supermemory</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
<div style="text-align: center;"><h1 style="color: #22c55e;">Connected</h1><p>You can close this window and return to DeepSeek Harness.</p></div>
</body></html>`

const DENIED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Authorization denied - Supermemory</title></head>
<body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fafafa;">
<div style="text-align: center;"><h1 style="color: #ef4444;">Authorization denied</h1><p>Supermemory was not connected. Run /supermemory-login to retry.</p></div>
</body></html>`

/**
 * Open the system browser without waiting for it to exit.
 * Windows `start` and `explorer.exe` both split a URL at `&`, so the browser only
 * receives `client_id`. The shell protocol handler keeps the query intact.
 */
export function openBrowser(url: URL): void {
  const target = url.toString()
  if (process.platform === 'win32') {
    spawn('rundll32.exe', ['url.dll,FileProtocolHandler', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else if (process.platform === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref()
  }
}

export interface LoginSession {
  /** Consent URL. Present once the callback port is listening; the browser is opened at the same time. */
  url: Promise<string>
  /** Resolves with a status line once the browser returns, or rejects on denial or timeout. */
  done: Promise<string>
  /** Stop waiting and close the callback port. */
  cancel: () => void
}

/**
 * Dynamic client registration, PKCE, and a loopback callback.
 * One login can be in flight; a second call cancels the first.
 */
export function startLogin(target: OAuthTarget, open: (url: URL) => void = openBrowser): LoginSession {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Authentication timed out.')), LOGIN_TIMEOUT_MS)
  let server: Server | undefined
  let settle = (_result: { ok: true; text: string } | { ok: false; error: unknown }): void => undefined
  let publishUrl = (_url: string): void => undefined
  const done = new Promise<string>((resolve, reject) => {
    settle = (result) => {
      if (result.ok) resolve(result.text)
      else reject(result.error instanceof Error ? result.error : new Error(String(result.error)))
    }
  })
  const url = new Promise<string>((resolve) => {
    publishUrl = resolve
  })
  const cancel = (): void => {
    controller.abort(new Error('Authentication cancelled.'))
    server?.close()
    settle({ ok: false, error: new Error('Authentication cancelled.') })
  }

  void (async () => {
    try {
      const client = await registerClient(target, controller.signal)
      const state = randomBytes(32).toString('base64url')
      const verifier = randomBytes(32).toString('base64url')
      const authorization = new URL(client.authorizationEndpoint)
      authorization.search = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri(),
        response_type: 'code',
        scope: OAUTH_SCOPE,
        resource: client.resource,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
        state,
        }).toString()
      await new Promise<void>((resolve, reject) => {
        let exchanging = false
        server = createServer((req, res) => {
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Referrer-Policy', 'no-referrer')
          const url = new URL(req.url ?? '/', redirectUri())
          if (req.method !== 'GET' || url.pathname !== '/callback') {
            res.writeHead(404).end()
            return
          }
          const received = Buffer.from(url.searchParams.get('state') ?? '')
          const expected = Buffer.from(state)
          if (received.length !== expected.length || !timingSafeEqual(received, expected) || (url.searchParams.has('iss') && url.searchParams.get('iss') !== client.issuer)) {
            res.writeHead(400).end('Invalid authorization state.')
            return
          }
          if (exchanging) {
            res.writeHead(409).end()
            return
          }
          exchanging = true
          void (async () => {
            try {
              if (url.searchParams.has('error')) throw new AuthError('Authorization was denied.', 'access_denied')
              const code = url.searchParams.get('code')
              if (!code) throw new Error('Authorization code missing.')
              const token = await exchange(client, {
                grant_type: 'authorization_code',
                code,
                code_verifier: verifier,
                redirect_uri: redirectUri(),
              }, controller.signal)
              store(client, token)
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(SUCCESS_PAGE)
              resolve()
            } catch (error) {
              const denied = error instanceof AuthError && error.code === 'access_denied'
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(denied ? DENIED_PAGE : 'Connection failed. Return to DeepSeek Harness and run /supermemory-login again.')
              if (error instanceof AuthError && error.code === 'invalid_client') deleteClient()
              reject(error)
            }
          })()
        })
        server.on('error', () => reject(new Error(`Cannot open the authentication callback port ${callbackPort()}. Retry after other logins finish.`)))
        server.listen(callbackPort(), '127.0.0.1', () => {
          publishUrl(authorization.toString())
          open(authorization)
        })
      })
      settle({ ok: true, text: 'Signed in to Supermemory. Memory is active for new turns.' })
    } catch (error) {
      settle({ ok: false, error })
    } finally {
      clearTimeout(timer)
      publishUrl('')
      server?.close()
    }
  })()

  return { url, done, cancel }
}

let refreshing: Promise<string> | undefined

/** Current bearer, refreshing once when the saved access token is near expiry. */
export async function refreshAccessToken(target: OAuthTarget, signal?: AbortSignal): Promise<string> {
  const saved = loadCredentials()
  if (!saved || !sameTarget(saved, target)) throw new AuthError('Supermemory sign-in is missing. Run /supermemory-login.', 'AUTH_REQUIRED')
  if (saved.expiresAt > Date.now() + 60_000) return saved.accessToken
  refreshing ??= (async () => {
    try {
      const token = await exchange(saved, { grant_type: 'refresh_token', refresh_token: saved.refreshToken }, signal ?? AbortSignal.timeout(10_000), saved)
      return store(saved, token).accessToken
    } catch (error) {
      if (error instanceof AuthError && error.code === 'invalid_client') deleteClient()
      throw error
    } finally {
      refreshing = undefined
    }
  })()
  return refreshing
}

/** Revoke the refresh token, then drop the local sign-in. */
export async function logout(signal?: AbortSignal): Promise<string> {
  const saved = loadCredentials()
  if (!saved) return 'No Supermemory sign-in is saved.'
  try {
    await oauthJson(saved.revocationEndpoint, {
      method: 'POST',
      signal: signal ?? AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: saved.clientId, token: saved.refreshToken, token_type_hint: 'refresh_token' }),
    })
  } catch {
    // A failed revocation must not keep a credential the user asked to delete.
  }
  deleteCredentials()
  return 'Signed out of Supermemory. The saved refresh token was revoked.'
}

/** Account label for `/supermemory-status`, or `undefined` when the endpoint is absent. */
export async function accountLabel(apiBaseUrl: string, token: string, signal?: AbortSignal): Promise<string | undefined> {
  for (const path of ['/session', '/v3/session']) {
    const response = await fetch(new URL(path, apiBaseUrl), {
      headers: { Authorization: `Bearer ${token}`, 'x-sm-source': 'dsh' },
      signal: signal ?? AbortSignal.timeout(5_000),
    }).catch(() => undefined)
    if (!response?.ok) continue
    const body: unknown = await response.json().catch(() => null)
    if (body === null || typeof body !== 'object') continue
    const user = (body as { user?: { email?: unknown; name?: unknown } }).user
    if (typeof user?.email === 'string') return user.email
    if (typeof user?.name === 'string') return user.name
  }
  return undefined
}
