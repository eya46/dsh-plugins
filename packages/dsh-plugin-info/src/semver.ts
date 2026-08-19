/** Loose semver pieces used only to decide whether latest is newer. */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

/** Strip a leading `v` and build metadata. */
export function normalizeVersion(input: string): string {
  const trimmed = input.trim()
  const withoutBuild = trimmed.split('+')[0] ?? trimmed
  return withoutBuild.startsWith('v') || withoutBuild.startsWith('V')
    ? withoutBuild.slice(1)
    : withoutBuild
}

/** Parse `1.2.3`, `1.2.3-rc.1`, or `v1.2.3`. Returns undefined when not numeric. */
export function parseVersion(input: string): ParsedVersion | undefined {
  const normalized = normalizeVersion(input)
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalized)
  if (match === null) return undefined
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return undefined
  const prerelease = match[4] === undefined || match[4].length === 0
    ? []
    : match[4].split('.')
  return { major, minor, patch, prerelease }
}

function compareIdentifier(left: string, right: string): number {
  const leftNum = /^\d+$/.test(left) ? Number(left) : undefined
  const rightNum = /^\d+$/.test(right) ? Number(right) : undefined
  if (leftNum !== undefined && rightNum !== undefined) return leftNum - rightNum
  if (leftNum !== undefined) return -1
  if (rightNum !== undefined) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Compare two parsed versions. Negative when `left` is older. */
export function compareParsed(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const count = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < count; index += 1) {
    const leftPart = left.prerelease[index]
    const rightPart = right.prerelease[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const delta = compareIdentifier(leftPart, rightPart)
    if (delta !== 0) return delta
  }
  return 0
}

/** Compare two version strings. Unparseable values compare as equal (0). */
export function compareVersions(left: string, right: string): number {
  const parsedLeft = parseVersion(left)
  const parsedRight = parseVersion(right)
  if (parsedLeft === undefined || parsedRight === undefined) return 0
  return compareParsed(parsedLeft, parsedRight)
}

/** True when `latest` is a newer published version than `installed`. */
export function hasNewerVersion(installed: string | undefined, latest: string | undefined): boolean {
  if (installed === undefined || latest === undefined) return false
  if (normalizeVersion(installed) === normalizeVersion(latest)) return false
  const parsedInstalled = parseVersion(installed)
  const parsedLatest = parseVersion(latest)
  if (parsedInstalled === undefined || parsedLatest === undefined) {
    return normalizeVersion(installed) !== normalizeVersion(latest)
  }
  return compareParsed(parsedLatest, parsedInstalled) > 0
}
