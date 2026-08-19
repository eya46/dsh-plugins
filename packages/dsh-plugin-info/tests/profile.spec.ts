import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { classifySpec, listUserPlugins, parseGithubRepo, repositoryUrlOf } from '../src/profile.ts'
import { latestVersionOf, packumentUrl, recentVersions, resolveVersionLimit } from '../src/registry.ts'

/** Relative `file:` spec for the monorepo's local dsh-plugin-info package,
 * resolved from this test file's location so no absolute path leaks in. */
const localPluginFileSpec = `file:${join(import.meta.dirname, '..', '..', '..', 'packages', 'dsh-plugin-info')}`

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
