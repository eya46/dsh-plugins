/**
 * Profile plugin upgrades.
 *
 * DSH's own plugin manager grew `updateBundle` in 0.2.2-alpha.2; older
 * runtimes (0.2.1-rc.5 and earlier, including the current Desktop release)
 * expose only `removeBundle` and `installBundle`. This module asks for the
 * official endpoint first and otherwise performs the same sequence the
 * official endpoint performs internally — remove the installed version so its
 * plugins stop, install the target exactly, and put the removed version back
 * when the target fails — through the manager's public calls, so every step
 * keeps the profile write lock, the pnpm runner and the compatibility
 * preflight of the official manager.
 */

import { compareVersions, normalizeVersion, parseVersion } from './semver.ts'

/** The bundle fields an update reads from `pluginManager.listBundles`. */
export interface BundleFacts {
  name: string
  version?: string
  installed?: boolean
  removable?: boolean
  enabled?: boolean
  /** The spec `pnpm add` accepts for a profile-installed dependency. */
  source?: string
  readOnlyReason?: string
  error?: { code?: string, diagnostic?: string }
}

/** The fields of one manager change an update reports. */
export interface ChangeFacts {
  application?: string
  error?: { code?: string, diagnostic?: string }
  packageResult?: { output?: string, exitCode?: number, logPath?: string }
  version?: string
}

/** The subset of DSH's `pluginManager` service an update calls. */
export interface PluginManagerLike {
  listBundles(): Promise<BundleFacts[]>
  removeBundle(name: string): Promise<ChangeFacts>
  installBundle(spec: string, options?: Record<string, unknown>): Promise<ChangeFacts>
  /** Present from DSH 0.2.2-alpha.2; absent on older runtimes. */
  updateBundle?(name: string, version: string, options?: Record<string, unknown>): Promise<unknown>
}

/** The step an update stopped at. */
export type UpdateStep = 'check' | 'remove' | 'install' | 'restore'

/** Which manager surface performed the update. */
export type UpdateRoute = 'plugin-manager' | 'remove-and-install'

/** What one update did, as the settings page reports it. */
export interface UpdateOutcome {
  name: string
  /** The version installed before the update, when the bundle declares one. */
  from?: string
  /** The version or spec the update installed. */
  to: string
  step: UpdateStep
  ok: boolean
  /** The manager's own application verdict for the last step. */
  application?: string
  /** The manager's diagnostic, or this module's refusal, in its own words. */
  reason?: string
  /** The manager's pnpm diagnostics for the last step, when it produced any. */
  output?: string
  /** The log file the manager wrote the run's full output to. */
  logPath?: string
  /** The reinstallation of the previous version after a failed target install. */
  restore?: { ok: boolean, application?: string, reason?: string }
  route: UpdateRoute
}

/** A registry target: the package's own name at an exact newer version. */
export interface VersionTarget {
  kind: 'version'
  version: string
}

/** A release target: the tarball URL of a newer GitHub release of the same repository. */
export interface SpecTarget {
  kind: 'spec'
  spec: string
  version?: string
}

/** What the update should install. */
export type UpdateTarget = VersionTarget | SpecTarget

/** The outcome of a manager change: whether it took effect and how. */
function settled(change: ChangeFacts): boolean {
  return change.application === 'applied'
    || change.application === 'restart-required'
    || change.application === 'overridden'
}

/** The manager's words for one change, preferring its diagnostic over its pnpm output. */
function reasonOf(change: ChangeFacts): string | undefined {
  const diagnostic = change.error?.diagnostic
  if (typeof diagnostic === 'string' && diagnostic.length > 0) return diagnostic
  const code = change.error?.code
  if (typeof code === 'string' && code.length > 0) return code
  const output = change.packageResult?.output
  if (typeof output === 'string' && output.trim().length > 0) return output.trim()
  return undefined
}

/** One step's report, folded into the outcome. */
function report(outcome: UpdateOutcome, step: UpdateStep, change: ChangeFacts): UpdateOutcome {
  const reason = reasonOf(change)
  const output = change.packageResult?.output
  const logPath = change.packageResult?.logPath
  return {
    ...outcome,
    step,
    ok: settled(change),
    ...typeof change.application === 'string' ? { application: change.application } : {},
    ...reason === undefined ? {} : { reason },
    ...typeof output === 'string' && output.length > 0 ? { output } : {},
    ...typeof logPath === 'string' && logPath.length > 0 ? { logPath } : {},
  }
}

/** A refusal that changes nothing. */
function refused(name: string, to: string, route: UpdateRoute, reason: string, from?: string): UpdateOutcome {
  return {
    name, to, step: 'check', ok: false, reason, route,
    ...from === undefined ? {} : { from },
  }
}

/** Read the official `updateBundle` answer into this module's outcome. */
function fromOfficialAnswer(name: string, to: string, from: string, raw: unknown): UpdateOutcome {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  const result = typeof record.result === 'object' && record.result !== null ? record.result as ChangeFacts : {}
  const step = record.step === 'remove' ? 'remove' : record.step === 'install' ? 'install' : 'check'
  const outcome = report({ name, from, to, step: 'check', ok: false, route: 'plugin-manager' }, step, result)
  const restore = record.restore
  if (typeof restore !== 'object' || restore === null) return outcome
  const restoreFacts = restore as ChangeFacts
  const restoreReason = reasonOf(restoreFacts)
  return {
    ...outcome,
    restore: {
      ok: settled(restoreFacts),
      ...typeof restoreFacts.application === 'string' ? { application: restoreFacts.application } : {},
      ...restoreReason === undefined ? {} : { reason: restoreReason },
    },
  }
}

/**
 * Upgrade one profile plugin to a newer version.
 * @param manager - the running Host's `pluginManager` service.
 * @param name - installed profile dependency name.
 * @param target - the version or release spec to install.
 * @returns the step the update stopped at, whether it took effect, and the manager's own diagnostics.
 */
export async function updatePlugin(
  manager: PluginManagerLike,
  name: string,
  target: UpdateTarget,
): Promise<UpdateOutcome> {
  const to = target.kind === 'version' ? target.version : (target.version ?? target.spec)
  const bundle = (await manager.listBundles()).find((item) => item.name === name)
  if (bundle === undefined) return refused(name, to, 'remove-and-install', `${name} is not a bundle of this profile`)
  if (bundle.error !== undefined) {
    const reason = bundle.error.diagnostic ?? bundle.error.code ?? 'the Host cannot read this bundle'
    return refused(name, to, 'remove-and-install', reason, bundle.version)
  }
  const from = bundle.version
  if (bundle.readOnlyReason !== undefined) {
    return refused(name, to, 'remove-and-install', `${name} carries plugin management and cannot be replaced`, from)
  }
  if (target.kind === 'version') {
    if (from === undefined || parseVersion(from) === undefined) {
      return refused(name, to, 'remove-and-install', `${name} declares no semantic version`, from)
    }
    if (compareVersions(target.version, from) <= 0) {
      return refused(name, to, 'remove-and-install', `${target.version} is not newer than the installed ${from}`, from)
    }
    if (manager.updateBundle !== undefined) {
      const raw = await manager.updateBundle(name, target.version, {})
      return fromOfficialAnswer(name, target.version, from, raw)
    }
  }
  if (bundle.removable !== true) {
    return refused(name, to, 'remove-and-install', `${name} cannot be removed, so it cannot be replaced`, from)
  }
  const spec = target.kind === 'version' ? `${name}@${target.version}` : target.spec
  const options = { saveExact: target.kind === 'version', enabled: bundle.enabled ?? true }
  const base: UpdateOutcome = { name, to, step: 'check', ok: false, route: 'remove-and-install', ...from === undefined ? {} : { from } }
  const removal = await manager.removeBundle(name)
  if (!settled(removal)) return report(base, 'remove', removal)
  const installation = await manager.installBundle(spec, options)
  const outcome = report(base, 'install', installation)
  if (outcome.ok) return outcome
  // The installed version went away before the target could replace it, so it goes back from where it came.
  const restoreSpec = bundle.source ?? (from === undefined ? undefined : `${name}@${from}`)
  if (restoreSpec === undefined) return outcome
  const restored = await manager.installBundle(restoreSpec, { ...options, saveExact: target.kind === 'version' })
  const restoreReason = reasonOf(restored)
  return {
    ...outcome,
    restore: {
      ok: settled(restored),
      ...typeof restored.application === 'string' ? { application: restored.application } : {},
      ...restoreReason === undefined ? {} : { reason: restoreReason },
    },
  }
}

/**
 * Whether a release spec names the same repository as the installed one, so a
 * tarball URL supplied by a caller cannot install another publisher's package.
 * @param installed - the profile's saved dependency spec.
 * @param candidate - the spec an update would install.
 * @returns true when both are GitHub release downloads of one repository.
 */
export function sameReleaseRepository(installed: string, candidate: string): boolean {
  const left = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/releases\/download\/[^/\s]+\/[^/\s]+$/i.exec(installed.trim())
  const right = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/releases\/download\/[^/\s]+\/[^/\s]+$/i.exec(candidate.trim())
  if (left === null || right === null) return false
  return left[1]?.toLowerCase() === right[1]?.toLowerCase() && left[2]?.toLowerCase() === right[2]?.toLowerCase()
}

/** Normalize a version for comparison, keeping a tag's leading `v` out of the answer. */
export function comparableVersion(version: string): string {
  return normalizeVersion(version)
}
