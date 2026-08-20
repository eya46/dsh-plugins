import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'
import { PluginInfoService } from '../src/service.ts'
import type { JsonFetcher } from '../src/service.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function writeProfile(files: Record<string, unknown>): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plugin-info-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies: {
      'dsh-better-sidebar': '^0.13.0',
      '@eya46/dsh-plugin-info': 'file:./local',
    },
  }, null, 2))
  for (const [name, manifest] of Object.entries(files)) {
    const dir = join(root, 'node_modules', ...name.split('/'))
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  }
  return root
}

describe('PluginInfoService', () => {
  it('does not apply a scope allow-list by default', () => {
    expect(Config({}).allowScopes).toEqual([])
  })

  it('lists user plugins and marks a registry update', async () => {
    const profileDir = await writeProfile({
      'dsh-better-sidebar': {
        name: 'dsh-better-sidebar',
        version: '0.13.0',
        description: 'sidebar',
        repository: { url: 'git+https://github.com/omdsh-dev/DSH-better-sidebar.git' },
      },
      '@eya46/dsh-plugin-info': {
        name: '@eya46/dsh-plugin-info',
        version: '0.1.0',
        description: 'plugin info tools',
      },
    })
    const fetcher: JsonFetcher = async (url) => {
      if (url.includes('dsh-better-sidebar') && url.includes('registry')) {
        return {
          name: 'dsh-better-sidebar',
          description: 'sidebar',
          'dist-tags': { latest: '0.14.0' },
          versions: { '0.13.0': {}, '0.14.0': {} },
          time: {
            '0.13.0': '2026-01-01T00:00:00.000Z',
            '0.14.0': '2026-02-01T00:00:00.000Z',
          },
          repository: { url: 'git+https://github.com/omdsh-dev/DSH-better-sidebar.git' },
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const service = new PluginInfoService({
      registryUrl: 'https://registry.npmjs.org',
      defaultVersionLimit: 10,
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      allowScopes: [],
    }, fetcher)
    const listed = await service.listPlugins(profileDir)
    expect(listed.plugins.map(item => item.name)).toEqual(['@eya46/dsh-plugin-info', 'dsh-better-sidebar'])
    const local = listed.plugins.find(item => item.name === '@eya46/dsh-plugin-info')
    const remote = listed.plugins.find(item => item.name === 'dsh-better-sidebar')
    expect(local?.source).toBe('file')
    expect(local?.hasUpdate).toBe(false)
    expect(remote?.hasUpdate).toBe(true)
    expect(remote?.latestVersion).toBe('0.14.0')

    const versions = await service.listVersions(profileDir, 'dsh-better-sidebar', 10)
    expect(versions.versions).toHaveLength(2)
    expect(versions.versions[0]?.version).toBe('0.14.0')
  })

  it('prefers a GitHub release body for version notes', async () => {
    const profileDir = await writeProfile({
      'dsh-better-sidebar': {
        name: 'dsh-better-sidebar',
        version: '0.13.0',
        repository: { url: 'https://github.com/omdsh-dev/DSH-better-sidebar.git' },
      },
      '@eya46/dsh-plugin-info': {
        name: '@eya46/dsh-plugin-info',
        version: '0.1.0',
      },
    })
    const fetcher: JsonFetcher = async (url) => {
      if (url.includes('registry.npmjs.org/dsh-better-sidebar')) {
        return {
          'dist-tags': { latest: '0.14.0' },
          versions: { '0.13.0': {}, '0.14.0': {} },
          time: {
            '0.13.0': '2026-01-01T00:00:00.000Z',
            '0.14.0': '2026-02-01T00:00:00.000Z',
          },
          repository: { url: 'https://github.com/omdsh-dev/DSH-better-sidebar.git' },
        }
      }
      if (url.includes('/releases/tags/v0.14.0') || url.includes('/releases/tags/0.14.0')) {
        return {
          name: 'v0.14.0',
          body: '- add explorer tab',
          html_url: 'https://github.com/omdsh-dev/DSH-better-sidebar/releases/tag/v0.14.0',
          published_at: '2026-02-01T00:00:00.000Z',
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const service = new PluginInfoService({
      registryUrl: 'https://registry.npmjs.org',
      defaultVersionLimit: 10,
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      allowScopes: [],
    }, fetcher)
    const notes = await service.versionNotes(profileDir, 'dsh-better-sidebar', '0.14.0')
    expect(notes.source).toBe('github-release')
    expect(notes.body).toContain('explorer')
  })

  it('hides plugins outside allowScopes and rejects their version/notes lookups', async () => {
    const profileDir = await writeProfile({
      'dsh-better-sidebar': {
        name: 'dsh-better-sidebar',
        version: '0.13.0',
        repository: { url: 'git+https://github.com/omdsh-dev/DSH-better-sidebar.git' },
      },
      '@eya46/dsh-plugin-info': {
        name: '@eya46/dsh-plugin-info',
        version: '0.1.0',
        description: 'plugin info tools',
      },
    })
    const fetcher: JsonFetcher = async () => {
      throw new Error('unexpected fetch')
    }
    const service = new PluginInfoService({
      registryUrl: 'https://registry.npmjs.org',
      defaultVersionLimit: 10,
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      allowScopes: ['@eya46/'],
    }, fetcher)
    const listed = await service.listPlugins(profileDir)
    expect(listed.plugins.map(item => item.name)).toEqual(['@eya46/dsh-plugin-info'])
    await expect(service.listVersions(profileDir, 'dsh-better-sidebar', 10)).rejects.toThrow(/allowScopes/)
    await expect(service.versionNotes(profileDir, 'dsh-better-sidebar', '0.13.0')).rejects.toThrow(/allowScopes/)
  })
})
