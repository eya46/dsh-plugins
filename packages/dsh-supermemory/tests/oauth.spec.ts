import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { secureUrl, startLogin } from '../src/oauth.ts'
import { loadCredentials } from '../src/credentials.ts'

const directories: string[] = []
const servers: Server[] = []

afterEach(() => {
  for (const server of servers) server.close()
  servers.length = 0
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  directories.length = 0
})

describe('oauth urls', () => {
  it('accepts https and loopback, and rejects a credential in the URL', () => {
    expect(secureUrl('https://api.supermemory.ai/api/auth')).toBe('https://api.supermemory.ai/api/auth')
    expect(secureUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787')
    expect(() => secureUrl('http://example.com')).toThrow(/HTTPS/)
    expect(() => secureUrl('https://user:secret@api.supermemory.ai')).toThrow(/HTTPS/)
  })
})

describe('oauth login', () => {
  it('exchanges a callback code and saves the refresh token', async () => {
    process.env.SUPERMEMORY_OAUTH_PORT = '19881'
    const home = mkdtempSync(join(tmpdir(), 'supermemory-dsh-'))
    directories.push(home)
    process.env.SUPERMEMORY_DSH_HOME = home

    const issuer = await new Promise<Server>((resolve) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname.endsWith('/oauth-authorization-server')) {
          const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            revocation_endpoint: `${origin}/revoke`,
          }))
          return
        }
        if (url.pathname === '/register') {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ client_id: 'client-1', token_endpoint_auth_method: 'none' }))
          return
        }
        if (url.pathname === '/token') {
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
            access_token: 'access-1', token_type: 'bearer', expires_in: 3600, refresh_token: 'refresh-1',
          }))
          return
        }
        res.writeHead(404).end()
      })
      server.listen(0, '127.0.0.1', () => resolve(server))
    })
    servers.push(issuer)
    const origin = `http://127.0.0.1:${(issuer.address() as AddressInfo).port}`

    const session = startLogin({
      apiBaseUrl: origin,
      issuer: origin,
      resource: `${origin}/mcp`,
    }, (url) => {
      const state = url.searchParams.get('state') ?? ''
      const code = 'auth-code'
      fetch(`http://127.0.0.1:19881/callback?code=${code}&state=${state}`).catch(() => undefined)
    })

    await expect(session.done).resolves.toMatch(/Signed in/)
    expect(loadCredentials()).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1', clientId: 'client-1' })
  })
})
