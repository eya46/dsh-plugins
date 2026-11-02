import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginInfoService } from '../src/service.ts'
import type { JsonFetcher } from '../src/service.ts'
import { comparableVersion, sameReleaseRepository, updatePlugin } from '../src/update.ts'
import type { BundleFacts, ChangeFacts, PluginManagerLike } from '../src/update.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

const CONFIG = {
  registryUrl: 'https://registry.npmjs.org',
  defaultVersionLimit: 10,
  timeoutMs: 1000,
  cacheTtlMs: 60_000,
  allowScopes: [] as string[],
}

/** A profile with one registry plugin at 0.13.0 and one release-tarball plugin at 2.0.3. */
async function writeProfile(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plugin-info-update-'))
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

const releaseSpec = 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.3/dsh-skill-mcp-panel-2.0.3.tgz'
const nextReleaseSpec = 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.4/dsh-skill-mcp-panel-2.0.4.tgz'

describe('sameReleaseRepository', () => {
  it('accepts a newer tag of the installed repository and rejects another publisher', () => {
    expect(sameReleaseRepository(releaseSpec, nextReleaseSpec)).toBe(true)
    expect(sameReleaseRepository(releaseSpec, releaseSpec.replace('Fishquito7', 'someone-else'))).toBe(false)
    expect(sameReleaseRepository(releaseSpec, 'https://example.com/x.tgz')).toBe(false)
    expect(sameReleaseRepository('^0.13.0', nextReleaseSpec)).toBe(false)
  })
})

describe('comparableVersion', () => {
  it('drops the tag prefix and build metadata', () => {
    expect(comparableVersion('v2.0.4')).toBe('2.0.4')
    expect(comparableVersion('2.0.4+build.7')).toBe('2.0.4')
  })
})

describe('updatePlugin', () => {
  const installed: BundleFacts = {
    name: 'dsh-better-sidebar', version: '0.13.0', installed: true, removable: true, enabled: true, source: '^0.13.0',
  }

  /** A manager whose calls are recorded and answered from the supplied results. */
  function managerOf(overrides: Partial<PluginManagerLike> = {}, answers: {
    remove?: ChangeFacts
    install?: (spec: string) => ChangeFacts
    updateBundle?: (name: string, version: string) => unknown
  } = {}): PluginManagerLike & { calls: string[] } {
    const calls: string[] = []
    const base: PluginManagerLike = {
      listBundles: async () => [installed],
      removeBundle: async (name) => { calls.push(`remove:${name}`); return answers.remove ?? { application: 'applied' } },
      installBundle: async (spec) => { calls.push(`install:${spec}`); return answers.install?.(spec) ?? { application: 'applied' } },
      ...overrides,
    }
    if (answers.updateBundle !== undefined) {
      base.updateBundle = async (name, version) => {
        calls.push(`updateBundle:${name}@${version}`)
        return answers.updateBundle?.(name, version)
      }
    }
    return Object.assign(base, { calls })
  }

  it('prefers the official updateBundle when the runtime has one', async () => {
    const manager = managerOf({}, {
      updateBundle: (name, version) => ({
        from: '0.13.0', to: version, step: 'install', result: { application: 'applied' },
      }),
    })
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(manager.calls).toEqual(['updateBundle:dsh-better-sidebar@0.14.0'])
    expect(outcome).toMatchObject({ ok: true, route: 'plugin-manager', step: 'install', from: '0.13.0', to: '0.14.0' })
  })

  it('reports the reinstallation the official endpoint performed after a failed target', async () => {
    const manager = managerOf({}, {
      updateBundle: (name, version) => ({
        from: '0.13.0',
        to: version,
        step: 'install',
        result: { application: 'failed', error: { code: 'operation-error', diagnostic: 'pnpm add exited 1' } },
        restore: { application: 'applied' },
      }),
    })
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('pnpm add exited 1')
    expect(outcome.restore).toEqual({ ok: true, application: 'applied' })
  })

  it('removes then installs exactly on a runtime without updateBundle', async () => {
    const manager = managerOf()
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(manager.calls).toEqual(['remove:dsh-better-sidebar', 'install:dsh-better-sidebar@0.14.0'])
    expect(outcome).toMatchObject({ ok: true, route: 'remove-and-install', step: 'install' })
  })

  it('installs the previous version again when the target fails', async () => {
    const manager = managerOf({}, {
      install: (spec) => (spec === 'dsh-better-sidebar@0.14.0'
        ? { application: 'failed', error: { code: 'incompatible-version', diagnostic: 'peer range rejects 0.14.0' } }
        : { application: 'applied' }),
    })
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(manager.calls).toEqual([
      'remove:dsh-better-sidebar',
      'install:dsh-better-sidebar@0.14.0',
      'install:^0.13.0',
    ])
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('peer range rejects 0.14.0')
    expect(outcome.restore).toEqual({ ok: true, application: 'applied' })
  })

  it('leaves the profile alone when the removal itself fails', async () => {
    const manager = managerOf({}, { remove: { application: 'failed', error: { code: 'bundle-in-use' } } })
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(manager.calls).toEqual(['remove:dsh-better-sidebar'])
    expect(outcome).toMatchObject({ ok: false, step: 'remove', reason: 'bundle-in-use' })
  })

  it('refuses a version that is not newer before touching the profile', async () => {
    const manager = managerOf()
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.13.0' })
    expect(manager.calls).toEqual([])
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('not newer')
  })

  it('refuses a bundle that carries plugin management', async () => {
    const manager = managerOf({ listBundles: async () => [{ ...installed, readOnlyReason: 'management-required' }] })
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(manager.calls).toEqual([])
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toContain('plugin management')
  })

  it('refuses a bundle the Host cannot read', async () => {
    const manager = managerOf({ listBundles: async () => [{ ...installed, error: { code: 'not-bundle' } }] })
    const outcome = await updatePlugin(manager, 'dsh-better-sidebar', { kind: 'version', version: '0.14.0' })
    expect(manager.calls).toEqual([])
    expect(outcome.ok).toBe(false)
    expect(outcome.reason).toBe('not-bundle')
  })
})

describe('PluginInfoService.updateTarget', () => {
  it('accepts a newer published registry version and rejects an unpublished or older one', async () => {
    const profileDir = await writeProfile()
    const fetcher: JsonFetcher = async () => ({
      'dist-tags': { latest: '0.14.0' },
      versions: { '0.13.0': {}, '0.14.0': {} },
    })
    const service = new PluginInfoService(CONFIG, fetcher)
    await expect(service.updateTarget(profileDir, 'dsh-better-sidebar', { version: '0.14.0' }))
      .resolves.toEqual({ kind: 'version', version: '0.14.0' })
    await expect(service.updateTarget(profileDir, 'dsh-better-sidebar', { version: '0.99.0' }))
      .rejects.toThrow(/not a published version/)
    await expect(service.updateTarget(profileDir, 'dsh-better-sidebar', { version: '0.13.0' }))
      .rejects.toThrow(/not newer/)
    await expect(service.updateTarget(profileDir, 'dsh-better-sidebar', {}))
      .rejects.toThrow(/version is required/)
  })

  it('rebuilds a release download URL for the newest GitHub release of the same repository', async () => {
    const profileDir = await writeProfile()
    const fetcher: JsonFetcher = async (url) => {
      if (url.endsWith('/releases/latest')) {
        return { tag_name: 'v2.0.4', prerelease: false, draft: false }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const service = new PluginInfoService(CONFIG, fetcher)
    const target = await service.updateTarget(profileDir, 'dsh-skill-mcp-panel', {})
    expect(target).toEqual({ kind: 'spec', spec: nextReleaseSpec, version: '2.0.4' })
  })

  it('rejects a release update that names another repository', async () => {
    const profileDir = await writeProfile()
    const fetcher: JsonFetcher = async (url) => {
      if (url.endsWith('/releases/latest')) {
        return { tag_name: 'v2.0.4', prerelease: false, draft: false }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const service = new PluginInfoService(CONFIG, fetcher)
    await expect(service.updateTarget(profileDir, 'dsh-skill-mcp-panel', {
      spec: nextReleaseSpec.replace('Fishquito7', 'someone-else'),
    })).rejects.toThrow(/must be a release download/)
  })

  it('refuses an update for a plugin installed from a local path', async () => {
    const profileDir = await writeProfile()
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-web',
      dependencies: { 'dsh-better-sidebar': 'file:./local' },
    }, null, 2))
    const service = new PluginInfoService(CONFIG, async () => { throw new Error('unexpected fetch') })
    await expect(service.updateTarget(profileDir, 'dsh-better-sidebar', { version: '0.14.0' }))
      .rejects.toThrow(/not installed from a registry or a GitHub release/)
  })

  it('refuses a plugin the profile does not list', async () => {
    const profileDir = await writeProfile()
    const service = new PluginInfoService(CONFIG, async () => { throw new Error('unexpected fetch') })
    await expect(service.updateTarget(profileDir, 'missing-plugin', { version: '1.0.0' }))
      .rejects.toThrow(/not a user-added plugin/)
  })
})
