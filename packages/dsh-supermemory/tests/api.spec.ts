import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { SupermemoryApi } from '../src/api.ts'
import type { MemoryScopeTags } from '../src/types.ts'

const tags: MemoryScopeTags = {
  canonical: 'repo_demo__0123456789abcdef',
  projectId: '0123456789abcdef',
  projectName: 'demo',
  personalReads: ['repo_demo__0123456789abcdef'],
  projectReads: ['repo_demo__0123456789abcdef'],
}

interface SeenRequest {
  method: string
  path: string
  body: unknown
}

function serve(handler: (request: SeenRequest) => unknown): Promise<{ server: Server; baseUrl: string; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = []
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const request = { method: req.method ?? '', path: req.url ?? '', body: raw.length > 0 ? JSON.parse(raw) : undefined }
      seen.push(request)
      const value = handler(request)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, seen })
    })
  })
}

describe('Supermemory v5 routes', () => {
  let server: Server | undefined
  afterEach(() => server?.close())

  it('searches, saves, and forgets on the namespace routes', async () => {
    const started = await serve((request) => {
      if (request.path.endsWith('/search')) return { results: [{ id: 'm1', memory: 'uses vitest', similarity: 0.9 }] }
      if (request.method === 'DELETE') return { count: 1 }
      return { id: 'saved-1', status: 'queued' }
    })
    server = started.server
    const api = new SupermemoryApi(started.baseUrl, () => Promise.resolve('token'), { similarityThreshold: 0.5, maxMemories: 5 })

    const found = await api.search('test runner', tags, 'project', 2_000)
    expect(found).toEqual({ ok: true, hits: [{ id: 'm1', text: 'uses vitest', similarity: 0.9, containerTag: '' }] })
    expect(started.seen[0]?.path).toBe(`/ns/${tags.canonical}/search`)
    expect(started.seen[0]?.body).toMatchObject({ query: 'test runner', searchMode: 'hybrid' })

    const saved = await api.add('uses vitest', tags, 'project', 'project-config', 'tool')
    expect(saved).toEqual({ ok: true, id: 'saved-1' })
    expect(started.seen[1]?.path).toBe(`/ns/${tags.canonical}/document`)
    expect(started.seen[1]?.body).toMatchObject({ supportingContext: expect.stringContaining('coding-agent memory') })

    const forgotten = await api.forget('m1', tags)
    expect(forgotten.ok).toBe(true)
    expect(started.seen[2]).toMatchObject({ method: 'DELETE', path: `/ns/${tags.canonical}/memories` })
  })

  it('reads profile facts and lists documents', async () => {
    const started = await serve((request) => request.path.includes('/profile')
      ? { profile: { static: ['prefers concise replies'], dynamic: [] } }
      : request.path.includes('/document/')
      ? { id: 'd1', content: 'run pnpm test' }
      : { documents: [{ id: 'd1', system: { createdAt: '2026-11-02T00:00:00Z' } }] })
    server = started.server
    const api = new SupermemoryApi(started.baseUrl, () => Promise.resolve('token'), { similarityThreshold: 0.5, maxMemories: 5 })

    const profile = await api.profile(tags, 'user', 2_000)
    expect(profile).toEqual({ ok: true, profile: { staticFacts: ['prefers concise replies'], dynamicFacts: [] } })

    const listed = await api.list(tags, undefined, 10)
    expect(listed.ok ? listed.memories : undefined).toEqual([{ id: 'd1', text: 'run pnpm test', createdAt: '2026-11-02T00:00:00Z' }])
    expect(started.seen[1]?.path).toContain('/list/documents?')
  })

  it('reports an HTTP failure instead of throwing', async () => {
    const failing = createServer((_req, res) => {
      res.writeHead(401).end('nope')
    })
    await new Promise<void>(resolve => failing.listen(0, '127.0.0.1', resolve))
    server = failing
    const address = failing.address() as AddressInfo
    const api = new SupermemoryApi(`http://127.0.0.1:${address.port}`, () => Promise.resolve('token'), { similarityThreshold: 0.5, maxMemories: 5 })
    const outcome = await api.search('anything at all', tags, undefined, 2_000)
    expect(outcome).toEqual({ ok: false, error: 'Supermemory returned HTTP 401.' })
  })
})
