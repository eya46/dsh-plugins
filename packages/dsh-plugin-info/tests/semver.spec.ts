import { describe, expect, it } from 'vitest'
import { compareVersions, hasNewerVersion, parseVersion } from '../src/semver.ts'

describe('parseVersion', () => {
  it('accepts a leading v and prerelease', () => {
    expect(parseVersion('v1.2.3-rc.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['rc', '1'],
    })
  })

  it('rejects a non-semver string', () => {
    expect(parseVersion('workspace:*')).toBeUndefined()
  })
})

describe('compareVersions', () => {
  it('orders release after prerelease', () => {
    expect(compareVersions('1.0.0-rc.1', '1.0.0')).toBeLessThan(0)
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0)
  })
})

describe('hasNewerVersion', () => {
  it('marks a newer latest as an update', () => {
    expect(hasNewerVersion('0.13.0', '0.14.1')).toBe(true)
    expect(hasNewerVersion('0.3.0', '0.3.0')).toBe(false)
    expect(hasNewerVersion('0.3.0', 'v0.3.0')).toBe(false)
  })

  it('does not claim an update when either side is missing', () => {
    expect(hasNewerVersion(undefined, '1.0.0')).toBe(false)
    expect(hasNewerVersion('1.0.0', undefined)).toBe(false)
  })
})
