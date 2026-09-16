import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { classifySpec, listUserPlugins, parseGithubReleaseSpec, parseGithubRepo, pluginUpdateCommand, profileCliName, releaseDownloadUrl, repositoryUrlOf } from '../src/profile.ts'
import { latestVersionOf, packumentUrl, recentVersions, resolveVersionLimit } from '../src/registry.ts'

/** Relative `file:` spec for the monorepo's local dsh-plugin-info package,
 * resolved from this test file's location so no absolute path leaks in. */
const localPluginFileSpec = `file:${join(import.meta.dirname, '..', '..', '..', 'packages', 'dsh-plugin-info')}`

describe('profileCliName', () => {
  it('strips the dsh-profile- prefix DSH writes on the manifest', () => {
    expect(profileCliName('dsh-profile-web', '/tmp/whatever')).toBe('web')
    expect(profileCliName('dsh-profile-tui', '/profiles/web')).toBe('tui')
  })

  it('falls back to the directory basename, then web', () => {
    expect(profileCliName(undefined, '/home/user/.dsh/profiles/web')).toBe('web')
    expect(profileCliName('', 'C:\\Users\\me\\.dsh\\profiles\\tui\\')).toBe('tui')
    expect(profileCliName('dsh-profile-', '.')).toBe('web')
  })

  it('splits both separator styles regardless of the host platform', () => {
    // `path.basename` follows the host platform's separator, so on POSIX a
    // Windows profile path used to come back whole from this call.
    expect(profileCliName(undefined, 'C:\\Users\\me\\.dsh\\profiles\\tui')).toBe('tui')
    expect(profileCliName(undefined, 'C:\\Users\\me\\.dsh\\profiles\\tui\\')).toBe('tui')
    expect(profileCliName(undefined, 'C:/Users/me/.dsh/profiles/tui')).toBe('tui')
    expect(profileCliName(undefined, '/home/user/.dsh/profiles/tui/')).toBe('tui')
  })

  it('falls back to web for dot, root, and empty directory names', () => {
    expect(profileCliName('', '.')).toBe('web')
    expect(profileCliName('', '..')).toBe('web')
    expect(profileCliName('', '/')).toBe('web')
    expect(profileCliName('', 'C:\\')).toBe('web')
    expect(profileCliName('', '')).toBe('web')
  })
})

describe('pluginUpdateCommand', () => {
  it('builds the pnpm-forwarded add @latest command', () => {
    expect(pluginUpdateCommand('web', 'dsh-better-sidebar'))
      .toBe('dsh plugin --profile web add dsh-better-sidebar@latest')
    expect(pluginUpdateCommand('web', '@eya46/dsh-plugin-info'))
      .toBe('dsh plugin --profile web add @eya46/dsh-plugin-info@latest')
  })
})

describe('classifySpec', () => {
  it('recognizes registry, file, link, and git specs', () => {
    expect(classifySpec('^0.13.0')).toBe('registry')
    expect(classifySpec(localPluginFileSpec)).toBe('file')
    expect(classifySpec('link:../plugin')).toBe('link')
    expect(classifySpec('github:omdsh-dev/dsh-at-file')).toBe('git')
  })
})

describe('listUserPlugins', () => {
  it('lists profile dependencies, not in-box bundles', () => {
    expect(listUserPlugins({
      dependencies: {
        'dsh-at-file': 'github:omdsh-dev/dsh-at-file',
        'dsh-web-ui': '^0.13.0',
      },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-web-ui'] } },
    })).toEqual([
      { name: 'dsh-at-file', spec: 'github:omdsh-dev/dsh-at-file', source: 'git' },
      { name: 'dsh-web-ui', spec: '^0.13.0', source: 'registry' },
    ])
  })
})

describe('parseGithubReleaseSpec', () => {
  const spec = 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.3/dsh-skill-mcp-panel-2.0.3.tgz'

  it('parses repository, tag, and asset out of the dependency spec', () => {
    expect(parseGithubReleaseSpec(spec)).toEqual({
      owner: 'Fishquito7',
      repo: 'dsh-skill-mcp-panel',
      tag: 'v2.0.3',
      asset: 'dsh-skill-mcp-panel-2.0.3.tgz',
    })
  })

  it('decodes encoded tags and assets', () => {
    expect(parseGithubReleaseSpec('https://github.com/o/r/releases/download/v1.0.0%2Ba/pkg-1.0.0%2Ba.tgz')).toEqual({
      owner: 'o',
      repo: 'r',
      tag: 'v1.0.0+a',
      asset: 'pkg-1.0.0+a.tgz',
    })
  })

  it('rejects non-release specs', () => {
    expect(parseGithubReleaseSpec('^0.13.0')).toBeUndefined()
    expect(parseGithubReleaseSpec('https://github.com/o/r/archive/refs/heads/main.tar.gz')).toBeUndefined()
    expect(parseGithubReleaseSpec('https://github.com/o/r')).toBeUndefined()
  })
})

describe('releaseDownloadUrl', () => {
  it('rewrites the tag and the version embedded in the asset name', () => {
    const spec = parseGithubReleaseSpec('https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.3/dsh-skill-mcp-panel-2.0.3.tgz')
    expect(spec).toBeDefined()
    expect(releaseDownloadUrl(spec!, 'v2.0.4', '2.0.4', '2.0.3'))
      .toBe('https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.4/dsh-skill-mcp-panel-2.0.4.tgz')
  })

  it('does not corrupt longer version numbers that contain the old one', () => {
    const spec = parseGithubReleaseSpec('https://github.com/o/r/releases/download/v2.0.3/panel-12.0.3.tgz')
    expect(spec).toBeDefined()
    expect(releaseDownloadUrl(spec!, 'v2.0.4', '2.0.4', '2.0.3'))
      .toBe('https://github.com/o/r/releases/download/v2.0.4/panel-12.0.3.tgz')
  })
})

describe('repository helpers', () => {
  it('normalizes GitHub repository fields', () => {
    expect(parseGithubRepo('git+https://github.com/omdsh-dev/dsh-at-file.git')).toEqual({
      owner: 'omdsh-dev',
      repo: 'dsh-at-file',
    })
    expect(parseGithubRepo('https://github.com/zhu1090093659/dsh-web-ui')).toEqual({
      owner: 'zhu1090093659',
      repo: 'dsh-web-ui',
    })
    expect(repositoryUrlOf({ url: 'git+https://github.com/omdsh-dev/DSH-better-sidebar.git' }))
      .toBe('https://github.com/omdsh-dev/DSH-better-sidebar')
    expect(repositoryUrlOf({ url: 'https://github.com/omdsh-dev/dsh-at-file' }))
      .toBe('https://github.com/omdsh-dev/dsh-at-file')
  })
})

describe('registry views', () => {
  it('encodes scoped names and lists newest versions first', () => {
    expect(packumentUrl('https://registry.npmjs.org/', '@eya46/dsh-plugin-info'))
      .toBe('https://registry.npmjs.org/@eya46%2fdsh-plugin-info')
    const rows = recentVersions({
      'dist-tags': { latest: '0.2.0' },
      versions: { '0.1.0': {}, '0.2.0': {}, '0.1.1': {} },
      time: {
        '0.1.0': '2026-01-01T00:00:00.000Z',
        '0.1.1': '2026-01-02T00:00:00.000Z',
        '0.2.0': '2026-01-03T00:00:00.000Z',
      },
    }, '0.1.1', 10)
    expect(rows.map(row => row.version)).toEqual(['0.2.0', '0.1.1', '0.1.0'])
    expect(rows[0]?.latest).toBe(true)
    expect(rows[1]?.installed).toBe(true)
    expect(latestVersionOf({ 'dist-tags': { latest: '0.2.0' } })).toBe('0.2.0')
    expect(resolveVersionLimit('10', 10)).toBe(10)
    expect(resolveVersionLimit(0, 10)).toBe(1)
  })
})
