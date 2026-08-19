/**
 * `@eya46/dsh-plugin-info` lists plugins the current profile added, marks
 * available registry updates, and exposes recent version notes.
 * @module @eya46/dsh-plugin-info
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { requestUrl, sendJson } from './http.ts'
import { fetchJson, PluginInfoService, profileDirFromBaseUrl } from './service.ts'
import { resolveVersionLimit } from './registry.ts'
import type { PluginConfig } from './types.ts'

export { classifySpec, listUserPlugins, parseGithubRepo, repositoryUrlOf } from './profile.ts'
export { hasNewerVersion, parseVersion } from './semver.ts'
export { latestVersionOf, packumentUrl, recentVersions, resolveVersionLimit } from './registry.ts'
export { fetchJson, PluginInfoService, profileDirFromBaseUrl } from './service.ts'
export type {
  InstalledPackage,
  Packument,
  PluginConfig,
  PluginSource,
  PluginSummary,
  PluginVersionRow,
  ProfileManifest,
  VersionNotes,
} from './types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'dsh-plugin-info'

/** Default version window shown by the settings page. */
export const DEFAULT_VERSION_LIMIT = 10

/** Cordis plugin configuration. */
export interface Config extends PluginConfig {}

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  registryUrl: z.string().default('https://registry.npmjs.org'),
  defaultVersionLimit: z.number().step(1).min(1).max(50).default(DEFAULT_VERSION_LIMIT),
  timeoutMs: z.number().step(1).min(1000).default(15_000),
  cacheTtlMs: z.number().step(1).min(0).default(5 * 60_000),
  allowScopes: z.array(z.string()).default(['@eya46/']),
})

/**
 * Register the plugin-info HTTP API when a web server is present.
 * @param ctx - Cordis context; `webServer` is optional so headless boots stay inert.
 * @param config - registry and cache knobs.
 */
export function apply(ctx: Context, config: Config): void {
  const service = new PluginInfoService(config, fetchJson)
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => {
      const disposers = [
        sctx.webServer.register({
          kind: 'exact',
          path: '/plugin-info/api/plugins',
          handler: async (_req, res) => {
            try {
              sendJson(res, 200, await service.listPlugins(profileDirFromBaseUrl(sctx.baseUrl)))
            } catch (error) {
              sendError(res, error)
            }
          },
        }),
        sctx.webServer.register({
          kind: 'exact',
          path: '/plugin-info/api/versions',
          handler: async (req, res) => {
            try {
              const url = requestUrl(req)
              const name = url.searchParams.get('name') ?? ''
              if (name.length === 0) {
                sendJson(res, 400, { ok: false, reason: 'name is required' })
                return
              }
              const limit = resolveVersionLimit(url.searchParams.get('limit'), config.defaultVersionLimit)
              sendJson(res, 200, await service.listVersions(profileDirFromBaseUrl(sctx.baseUrl), name, limit))
            } catch (error) {
              sendError(res, error)
            }
          },
        }),
        sctx.webServer.register({
          kind: 'exact',
          path: '/plugin-info/api/notes',
          handler: async (req, res) => {
            try {
              const url = requestUrl(req)
              const name = url.searchParams.get('name') ?? ''
              const version = url.searchParams.get('version') ?? ''
              if (name.length === 0 || version.length === 0) {
                sendJson(res, 400, { ok: false, reason: 'name and version are required' })
                return
              }
              sendJson(res, 200, await service.versionNotes(profileDirFromBaseUrl(sctx.baseUrl), name, version))
            } catch (error) {
              sendError(res, error)
            }
          },
        }),
      ]
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-plugin-info.web-api')
  })
}

function sendError(res: import('node:http').ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, 500, { ok: false, reason: 'error', message })
}
