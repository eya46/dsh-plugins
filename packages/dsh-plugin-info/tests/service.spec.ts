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

async function writeProfile(
  files: Record<string, unknown>,
  dependencies: Record<string, string> = {
    'dsh-better-sidebar': '^0.13.0',
    '@eya46/dsh-plugin-info': 'file:./local',
  },
): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-plugin-info-'))
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web',
    dependencies,
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
    expect(listed.profileCli).toBe('web')
    expect(listed.plugins.map(item => item.name)).toEqual(['@eya46/dsh-plugin-info', 'dsh-better-sidebar'])
    const local = listed.plugins.find(item => item.name === '@eya46/dsh-plugin-info')
    const remote = listed.plugins.find(item => item.name === 'dsh-better-sidebar')
    expect(local?.source).toBe('file')
    expect(local?.hasUpdate).toBe(false)
    expect(local?.updateCommand).toBeUndefined()
    expect(remote?.hasUpdate).toBe(true)
    expect(remote?.latestVersion).toBe('0.14.0')
    expect(remote?.updateCommand).toBe('dsh plugin --profile web add dsh-better-sidebar@latest')

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

  const releaseSpec = 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.3/dsh-skill-mcp-panel-2.0.3.tgz'

  function releaseService(fetcher: JsonFetcher): PluginInfoService {
    return new PluginInfoService({
      registryUrl: 'https://registry.npmjs.org',
      defaultVersionLimit: 10,
      timeoutMs: 1000,
      cacheTtlMs: 60_000,
      allowScopes: [],
    }, fetcher)
  }

  it('detects updates for GitHub-release tarball installs from the spec URL alone', async () => {
    const profileDir = await writeProfile({
      'dsh-skill-mcp-panel': {
        name: 'dsh-skill-mcp-panel',
        version: '2.0.3',
        description: 'manage skills and MCP servers',
      },
    }, { 'dsh-skill-mcp-panel': releaseSpec })
    const fetcher: JsonFetcher = async (url) => {
      if (url === 'https://api.github.com/repos/Fishquito7/dsh-skill-mcp-panel/releases/latest') {
        return {
          tag_name: 'v2.0.4',
          prerelease: false,
          draft: false,
          html_url: 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/tag/v2.0.4',
          published_at: '2026-03-01T00:00:00.000Z',
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const listed = await releaseService(fetcher).listPlugins(profileDir)
    const panel = listed.plugins.find(item => item.name === 'dsh-skill-mcp-panel')
    expect(panel?.source).toBe('other')
    expect(panel?.hasUpdate).toBe(true)
    expect(panel?.latestVersion).toBe('2.0.4')
    expect(panel?.repository).toBe('https://github.com/Fishquito7/dsh-skill-mcp-panel')
    expect(panel?.updateCommand).toBe(
      'dsh plugin --profile web add '
      + '"https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.4/dsh-skill-mcp-panel-2.0.4.tgz"',
    )
  })

  it('marks an up-to-date release install without an update command', async () => {
    const profileDir = await writeProfile({
      'dsh-skill-mcp-panel': { name: 'dsh-skill-mcp-panel', version: '2.0.4' },
    }, { 'dsh-skill-mcp-panel': releaseSpec })
    const fetcher: JsonFetcher = async (url) => {
      if (url.endsWith('/releases/latest')) {
        return { tag_name: 'v2.0.4', prerelease: false, draft: false, published_at: '2026-03-01T00:00:00.000Z' }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const panel = (await releaseService(fetcher).listPlugins(profileDir)).plugins[0]
    expect(panel?.hasUpdate).toBe(false)
    expect(panel?.latestVersion).toBe('2.0.4')
    expect(panel?.updateCommand).toBeUndefined()
  })

  it('keeps release installs updateless when the repo has no releases', async () => {
    const profileDir = await writeProfile({
      'dsh-skill-mcp-panel': { name: 'dsh-skill-mcp-panel', version: '2.0.3' },
    }, { 'dsh-skill-mcp-panel': releaseSpec })
    const fetcher: JsonFetcher = async (url) => {
      throw new Error(`HTTP 404 Not Found: ${url}`)
    }
    const panel = (await releaseService(fetcher).listPlugins(profileDir)).plugins[0]
    expect(panel?.hasUpdate).toBe(false)
    expect(panel?.latestVersion).toBeUndefined()
    expect(panel?.error).toBeUndefined()
  })

  it('lists GitHub releases and serves notes for a release-tarball install', async () => {
    const profileDir = await writeProfile({
      // The installed manifest intentionally has NO repository field: the
      // notes lookup must fall back to the repo parsed from the spec URL.
      'dsh-skill-mcp-panel': { name: 'dsh-skill-mcp-panel', version: '2.0.3' },
    }, { 'dsh-skill-mcp-panel': releaseSpec })
    const fetcher: JsonFetcher = async (url) => {
      if (url === 'https://api.github.com/repos/Fishquito7/dsh-skill-mcp-panel/releases?per_page=10') {
        return [
          {
            tag_name: 'v2.0.4',
            prerelease: false,
            draft: false,
            published_at: '2026-03-01T00:00:00.000Z',
            html_url: 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/tag/v2.0.4',
          },
          {
            tag_name: 'v2.0.3',
            prerelease: false,
            draft: false,
            published_at: '2026-02-01T00:00:00.000Z',
            html_url: 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/tag/v2.0.3',
          },
          { tag_name: 'changelog', prerelease: false, draft: false, published_at: '2026-01-01T00:00:00.000Z' },
        ]
      }
      if (url.includes('/releases/tags/v2.0.3')) {
        return {
          name: 'v2.0.3',
          body: '- fix panel reload',
          html_url: 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/tag/v2.0.3',
          published_at: '2026-02-01T00:00:00.000Z',
        }
      }
      throw new Error(`unexpected fetch ${url}`)
    }
    const service = releaseService(fetcher)
    const versions = await service.listVersions(profileDir, 'dsh-skill-mcp-panel', 10)
    expect(versions.installedVersion).toBe('2.0.3')
    expect(versions.latestVersion).toBe('2.0.4')
    expect(versions.versions).toEqual([
      {
        version: '2.0.4',
        publishedAt: '2026-03-01T00:00:00.000Z',
        latest: true,
        installed: false,
      },
      {
        version: '2.0.3',
        publishedAt: '2026-02-01T00:00:00.000Z',
        latest: false,
        installed: true,
      },
    ])

    const notes = await service.versionNotes(profileDir, 'dsh-skill-mcp-panel', '2.0.3')
    expect(notes.source).toBe('github-release')
    expect(notes.body).toContain('panel reload')
  })
})
