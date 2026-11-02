import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import type { PluginManagerLike } from '../src/update.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** One registered route as the fake web server keeps it. */
interface Route {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => void | Promise<void>
}

/** A response that records what the handler wrote. */
function recorder(): { status: number, body: string, res: Record<string, unknown> } {
  const state = { status: 0, body: '', res: {} as Record<string, unknown> }
  state.res = {
    writeHead: (status: number) => { state.status = status },
    end: (body?: string) => { state.body = body ?? '' },
  }
  return state
}

/** A request the JSON body reader accepts, without a socket. */
function post(body: unknown, url: string): unknown {
  const text = JSON.stringify(body)
  return {
    method: 'POST',
    url,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(text)
    },
  }
}

/** A profile directory with one registry plugin and one release-tarball plugin. */
async function profile(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plugin-info-http-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: {
      'dsh-better-sidebar': '^0.13.0',
      'dsh-skill-mcp-panel': 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.3/dsh-skill-mcp-panel-2.0.3.tgz',
    },
  }, null, 2))
  for (const [name, manifest] of Object.entries({
    'dsh-better-sidebar': { name: 'dsh-better-sidebar', version: '0.13.0' },
    'dsh-skill-mcp-panel': { name: 'dsh-skill-mcp-panel', version: '2.0.3' },
  })) {
    const dir = join(root, 'node_modules', ...name.split('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  }
  return root
}

/** Boot the plugin's HTTP half over a fake Cordis context and collect its routes. */
function boot(baseUrl: string, manager: PluginManagerLike | undefined): { routes: Route[], disposed: () => void } {
  const routes: Route[] = []
  let dispose: () => void = () => {}
  const sctx = {
    baseUrl,
    webServer: {
      register: (route: Route) => {
        routes.push(route)
        return () => { routes.splice(routes.indexOf(route), 1) }
      },
    },
    get: (name: string) => (name === 'pluginManager' ? manager : undefined),
    effect: (body: () => () => void) => {
      dispose = body()
    },
  }
  const ctx = {
    inject: (deps: string[], callback: (sctx: unknown) => void) => {
      expect(deps).toEqual(['webServer'])
      callback(sctx)
      return undefined
    },
  }
  apply(ctx as never, {
    registryUrl: 'https://registry.npmjs.org',
    defaultVersionLimit: 10,
    timeoutMs: 1000,
    cacheTtlMs: 60_000,
    allowScopes: [],
  })
  return { routes, disposed: () => { dispose() } }
}

const FETCH: typeof globalThis.fetch = async (input) => {
  const url = String(input instanceof URL ? input : input)
  if (url.includes('registry.npmjs.org/dsh-better-sidebar')) {
    return new Response(JSON.stringify({
      'dist-tags': { latest: '0.14.0' },
      versions: { '0.13.0': {}, '0.14.0': {} },
    }), { status: 200 })
  }
  if (url.endsWith('/releases/latest')) {
    return new Response(JSON.stringify({ tag_name: 'v2.0.4', prerelease: false, draft: false }), { status: 200 })
  }
  return new Response('not found', { status: 404 })
}

describe('plugin-info update API', () => {
  it('registers the update route beside the read routes and answers one upgrade', async () => {
    const dir = await profile()
    const original = globalThis.fetch
    globalThis.fetch = FETCH
    try {
      const manager: PluginManagerLike & { calls: string[] } = {
        calls: [],
        listBundles: async () => [{
          name: 'dsh-better-sidebar', version: '0.13.0', installed: true, removable: true, enabled: true, source: '^0.13.0',
        }],
        removeBundle: async (name) => { manager.calls.push(`remove:${name}`); return { application: 'applied' } },
        installBundle: async (spec) => { manager.calls.push(`install:${spec}`); return { application: 'applied' } },
      }
      const { routes } = boot(pathToFileURL(dir + '/').href, manager)
      expect(routes.map((route) => route.path)).toEqual([
        '/plugin-info/api/plugins',
        '/plugin-info/api/versions',
        '/plugin-info/api/notes',
        '/plugin-info/api/update',
      ])
      const update = routes.find((route) => route.path === '/plugin-info/api/update')
      expect(update).toBeDefined()
      const state = recorder()
      await update?.handler(post({ name: 'dsh-better-sidebar', version: '0.14.0' }, '/plugin-info/api/update'), state.res)
      expect(state.status).toBe(200)
      expect(JSON.parse(state.body)).toMatchObject({
        name: 'dsh-better-sidebar', from: '0.13.0', to: '0.14.0', ok: true, route: 'remove-and-install',
      })
      expect(manager.calls).toEqual(['remove:dsh-better-sidebar', 'install:dsh-better-sidebar@0.14.0'])
    } finally {
      globalThis.fetch = original
    }
  })

  it('rejects a non-POST request and an unpublished version', async () => {
    const dir = await profile()
    const original = globalThis.fetch
    globalThis.fetch = FETCH
    try {
      const { routes } = boot(pathToFileURL(dir + '/').href, undefined)
      const update = routes.find((route) => route.path === '/plugin-info/api/update')
      const refused = recorder()
      await update?.handler({ method: 'GET', url: '/plugin-info/api/update' }, refused.res)
      expect(refused.status).toBe(405)

      const manager: PluginManagerLike = {
        listBundles: async () => [],
        removeBundle: async () => ({ application: 'applied' }),
        installBundle: async () => ({ application: 'applied' }),
      }
      const { routes: withManager } = boot(pathToFileURL(dir + '/').href, manager)
      const target = withManager.find((route) => route.path === '/plugin-info/api/update')
      const state = recorder()
      await target?.handler(post({ name: 'dsh-better-sidebar', version: '0.99.0' }, '/plugin-info/api/update'), state.res)
      expect(state.status).toBe(500)
      expect(JSON.parse(state.body)).toMatchObject({ ok: false, message: expect.stringContaining('not a published version') })
    } finally {
      globalThis.fetch = original
    }
  })

  it('reports an unavailable manager instead of touching the profile', async () => {
    const dir = await profile()
    const { routes } = boot(pathToFileURL(dir + '/').href, undefined)
    const update = routes.find((route) => route.path === '/plugin-info/api/update')
    const state = recorder()
    await update?.handler(post({ name: 'dsh-better-sidebar', version: '0.14.0' }, '/plugin-info/api/update'), state.res)
    expect(state.status).toBe(503)
    expect(JSON.parse(state.body)).toMatchObject({ ok: false, reason: expect.stringContaining('plugin manager') })
  })
})
