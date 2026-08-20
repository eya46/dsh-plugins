/**
 * @eya46/dsh-plugin-info — browser half.
 *
 * A settings page listing plugins the current profile added, with update
 * marks and a per-plugin version drawer (default 10) that can open notes.
 *
 * @module @eya46/dsh-plugin-info/client
 */

interface ModuleLoader {
  load(handoff: { id: string, factory: (require: (spec: string) => unknown) => Record<string, unknown> }): void
}
interface DshWindow { __ModuleLoader__?: ModuleLoader }

interface MinimalReact {
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown
  useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: unknown[]): void
  useCallback<T>(fn: T, deps: unknown[]): T
}

/**
 * Subset of DSH's `MarkdownText` shared primitive. The real component is
 * GFM + KaTeX with unsafe HTML/protocols stripped; we only need the `text`
 * prop for rendering release-note bodies.
 */
type MarkdownTextComponent = (props: { text: string }) => unknown

interface SlotsService {
  inject(key: string, register: () => void): void
  register(options: Record<string, unknown>, component: unknown): void
}

/**
 * Minimal structural mirror of dsh-better-sidebar's client service — the
 * only method we call is `registerTab`. The plugin is an OPTIONAL soft
 * dependency: this plugin does not value-import it, does not list it in
 * peerDependencies, and reaches the service through `ctx.inject(...)` so
 * the whole registration block is inert when better-sidebar is absent.
 */
interface BetterSidebarServiceLike {
  registerTab(descriptor: Record<string, unknown>): () => void
}

interface ClientContext {
  slots: SlotsService
  /** Cordis fiber-lifetime effect: runs now, disposes on fiber unload. */
  effect(callback: () => (() => void) | void, label?: string): () => void
  /**
   * Cordis child-fiber spawn: waits until all named services are available
   * before running the callback. Used to register with better-sidebar only
   * when that plugin is loaded (optional soft dependency).
   */
  inject(deps: string[], apply: (ctx: ClientContext) => void): unknown
}

interface PluginRow {
  name: string
  description?: string
  spec: string
  source: string
  installedVersion?: string
  latestVersion?: string
  hasUpdate: boolean
  homepage?: string
  repository?: string
  error?: string
}

interface VersionRow {
  version: string
  publishedAt?: string
  latest: boolean
  installed: boolean
}

interface VersionNotes {
  name: string
  version: string
  source: 'github-release' | 'github-compare' | 'none'
  publishedAt?: string
  title?: string
  body?: string
  url?: string
  commits?: Array<{ sha: string, message: string, url?: string }>
}

;(() => {
  const loader = (window as unknown as DshWindow).__ModuleLoader__
  if (loader === undefined) return
  loader.load({
    id: '@eya46/dsh-plugin-info',
    factory: (require: (spec: string) => unknown) => {
    const API = '/plugin-info/api'
    const CSS_TEXT = [
      '.dpi-section { display: flex; flex-direction: column; gap: 12px; max-width: 720px; color: var(--dsw-alias-label-primary); }',
      '.dpi-title { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }',
      '.dpi-intro { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-tertiary); }',
      '.dpi-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }',
      '.dpi-secondaryButton, .dpi-rowButton { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 36px; padding: 0 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 18px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; cursor: pointer; }',
      '.dpi-rowButton { height: 28px; padding: 0 10px; font-size: 12px; line-height: 18px; }',
      '.dpi-secondaryButton:hover:not(:disabled), .dpi-rowButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover-solid); }',
      '.dpi-secondaryButton:disabled, .dpi-rowButton:disabled { opacity: 0.4; cursor: default; }',
      '.dpi-secondaryButton:focus-visible, .dpi-rowButton:focus-visible, .dpi-head:focus-visible, .dpi-version:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--dsw-alias-border-l3); }',
      '.dpi-status { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }',
      '.dpi-banner { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); }',
      '.dpi-empty { color: var(--dsw-alias-label-tertiary); font-size: 14px; line-height: 22px; }',
      '.dpi-cards { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 10px; }',
      '.dpi-card { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; overflow: hidden; }',
      '.dpi-head { box-sizing: border-box; width: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border: none; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }',
      '.dpi-head:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }',
      '.dpi-name { font-size: 14px; line-height: 22px; font-weight: 500; }',
      '.dpi-tag { border: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); border-radius: 4px; padding: 1px 6px; font-size: 11px; line-height: 16px; }',
      '.dpi-tag[data-tone="ok"] { color: var(--dsw-alias-state-success-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 40%, transparent); }',
      '.dpi-tag[data-tone="warn"] { color: var(--dsw-alias-state-warn-label); border-color: color-mix(in srgb, var(--dsw-alias-state-warn-label) 40%, transparent); }',
      '.dpi-body { display: flex; flex-direction: column; gap: 10px; padding: 0 14px 14px; }',
      '.dpi-meta { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); }',
      '.dpi-id { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }',
      '.dpi-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }',
      '.dpi-versions { display: flex; flex-direction: column; gap: 6px; }',
      '.dpi-version { box-sizing: border-box; width: 100%; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }',
      '.dpi-version:hover { background: var(--dsw-alias-interactive-bg-hover-solid); }',
      '.dpi-version[data-open="1"] { background: var(--dsw-alias-interactive-bg-hover-solid); }',
      '.dpi-notes { display: flex; flex-direction: column; gap: 6px; padding: 8px 2px 2px; }',
      '.dpi-commits { margin: 0; padding-left: 18px; font-size: 13px; line-height: 20px; }',
      '.dpi-link { color: inherit; text-underline-offset: 3px; }',
      '.dpi-copyTag { box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-secondary); background: transparent; border-radius: 4px; padding: 1px 6px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; cursor: pointer; }',
      '.dpi-copyTag:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l2); }',
      // Sidebar tab wrapper: the panel sits in a narrow right-side column
      // (default 420px), where PluginInfoPanel's 720px max-width and
      // non-scrolling body would overflow. Force full width + own scroll.
      '.dpi-sidebar { box-sizing: border-box; width: 100%; height: 100%; overflow-y: auto; overflow-x: hidden; padding: 12px 14px 16px; background: var(--dsw-alias-bg-base); }',
      '.dpi-sidebar .dpi-section { max-width: none; gap: 10px; }',
      '.dpi-sidebar .dpi-card .dpi-head { padding: 10px 12px; }',
      '.dpi-sidebar .dpi-card .dpi-body { padding: 0 12px 12px; }',
      '.dpi-sidebar .dpi-actions { gap: 6px; }',
      '.dpi-sidebar .dpi-rowButton { height: 26px; padding: 0 8px; }',
    ].join('\n')
    const React = require('react') as MinimalReact
    // Reuse DSH's shared untrusted-Markdown renderer instead of rolling our
    // own — it ships in the web shell's static module table and handles GFM,
    // math, code fences, and sanitization (raw HTML / unsafe URLs stripped).
    const uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives') as {
      MarkdownText: MarkdownTextComponent
    }
    const MarkdownText = uiPrimitives.MarkdownText
    const h = React.createElement.bind(React)

    const ensureStyles = (): void => {
      if (document.querySelector('style[data-plugin="@eya46/dsh-plugin-info"]') !== null) return
      const el = document.createElement('style')
      el.setAttribute('data-plugin', '@eya46/dsh-plugin-info')
      el.textContent = CSS_TEXT
      document.head.appendChild(el)
    }

    // The settings shell hardcodes nav glyphs by section id and falls back to a
    // gear for unknown ids, so our section cannot get its own icon through the
    // registry. We patch the nav button's SVG in place with the official Cordis
    // plugin glyph (same geometry as primitives' IconCordisPluginOutline14).
    // React re-renders the nav (tab switches, ledger changes) and rewrites the
    // SVG back to the gear, so a one-shot patch is not enough — instead of
    // polling, apply() observes the DOM and re-patches on change only.
    const CORDIS_PLUGIN_GLYPH =
      '<path fill="currentColor" d="M3.03426 5.66661L1.70084 7.00003L3.0315 8.33069L2.14762 9.21457L-0.0669245 7.00003L2.15038 4.78273L3.03426 5.66661ZM7 14.067L4.77924 11.8462L5.66313 10.9623L7 12.2992L8.33342 10.9658L9.2173 11.8496L7 14.067ZM11.8489 9.21803L10.965 8.33414L12.2992 7.00003L10.9623 5.66316L11.8462 4.77927L14.0669 7.00003L11.8489 9.21803ZM8.33066 3.03153L7 1.70087L5.66589 3.03498L4.782 2.1511L7 -0.0668945L9.21454 2.14765L8.33066 3.03153Z"/>'
      + '<rect x="5.98535" y="5.98535" width="2.02942" height="2.02942" fill="currentColor"/>'

    const patchSettingsIcon = (): void => {
      if (typeof document === 'undefined') return
      for (const button of Array.from(document.querySelectorAll('button'))) {
        const labels = Array.from(button.querySelectorAll('span'))
        if (!labels.some((label) => label.textContent === '插件信息')) continue
        const svg = button.querySelector('svg')
        if (svg === null || svg.getAttribute('data-dpi-icon') === '1') continue
        svg.setAttribute('data-dpi-icon', '1')
        svg.setAttribute('viewBox', '0 0 14 14')
        svg.setAttribute('width', '16')
        svg.setAttribute('height', '16')
        svg.innerHTML = CORDIS_PLUGIN_GLYPH
      }
    }

    /** Event-driven re-patch: coalesces mutation bursts into one microtask scan. */
    const watchSettingsNav = (): (() => void) => {
      let pending = false
      const schedule = (): void => {
        if (pending) return
        pending = true
        queueMicrotask(() => {
          pending = false
          patchSettingsIcon()
        })
      }
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
      patchSettingsIcon()
      return () => observer.disconnect()
    }

    const sourceLabel = (source: string): string => {
      if (source === 'registry') return 'npm'
      if (source === 'file') return '本地'
      if (source === 'link') return 'link'
      if (source === 'git') return 'git'
      return source
    }

    const formatTime = (value: string | undefined): string => {
      if (value === undefined) return ''
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return value
      return date.toISOString().slice(0, 10)
    }

    const PluginInfoPanel = (): unknown => {
      const [rows, setRows] = React.useState<PluginRow[] | null>(null)
      const [error, setError] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [open, setOpen] = React.useState<Record<string, boolean>>({})
      const [versions, setVersions] = React.useState<Record<string, VersionRow[]>>({})
      const [versionError, setVersionError] = React.useState<Record<string, string>>({})
      const [selected, setSelected] = React.useState<Record<string, string>>({})
      const [notes, setNotes] = React.useState<Record<string, VersionNotes>>({})
      const [notesBusy, setNotesBusy] = React.useState('')
      const [copied, setCopied] = React.useState<Record<string, boolean>>({})

      const copyName = React.useCallback((name: string) => {
        const write = (): Promise<void> => {
          if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
            return navigator.clipboard.writeText(name)
          }
          return Promise.reject(new Error('clipboard unavailable'))
        }
        write()
          .then(() => {
            setCopied((prev) => ({ ...prev, [name]: true }))
            window.setTimeout(() => setCopied((prev) => ({ ...prev, [name]: false })), 1200)
          })
          .catch(() => {})
      }, [])

      const load = React.useCallback(() => {
        setBusy(true)
        fetch(API + '/plugins')
          .then((response) => response.json() as Promise<{ plugins?: PluginRow[], message?: string }>)
          .then((data) => {
            if (!Array.isArray(data.plugins)) throw new Error(data.message ?? 'unexpected response')
            setRows(data.plugins)
            setError('')
          })
          .catch((caught) => setError(String(caught)))
          .finally(() => setBusy(false))
      }, [])

      React.useEffect(() => {
        ensureStyles()
        load()
      }, [load])

      const loadVersions = React.useCallback((name: string) => {
        setVersionError((prev) => ({ ...prev, [name]: '' }))
        fetch(API + '/versions?name=' + encodeURIComponent(name) + '&limit=10')
          .then((response) => response.json() as Promise<{ versions?: VersionRow[], message?: string }>)
          .then((data) => {
            if (!Array.isArray(data.versions)) throw new Error(data.message ?? 'unexpected response')
            setVersions((prev) => ({ ...prev, [name]: data.versions ?? [] }))
          })
          .catch((caught) => setVersionError((prev) => ({ ...prev, [name]: String(caught) })))
      }, [])

      const togglePlugin = React.useCallback((name: string) => {
        setOpen((prev) => {
          const nextOpen = prev[name] !== true
          if (nextOpen && versions[name] === undefined) loadVersions(name)
          return { ...prev, [name]: nextOpen }
        })
      }, [loadVersions, versions])

      const openNotes = React.useCallback((name: string, version: string) => {
        const key = name + '@' + version
        setSelected((prev) => ({ ...prev, [name]: prev[name] === version ? '' : version }))
        if (notes[key] !== undefined) return
        setNotesBusy(key)
        fetch(API + '/notes?name=' + encodeURIComponent(name) + '&version=' + encodeURIComponent(version))
          .then((response) => response.json() as Promise<VersionNotes & { message?: string }>)
          .then((data) => {
            if (typeof data.version !== 'string') throw new Error(data.message ?? 'unexpected response')
            setNotes((prev) => ({ ...prev, [key]: data }))
          })
          .catch((caught) => {
            setNotes((prev) => ({
              ...prev,
              [key]: { name, version, source: 'none', body: String(caught) },
            }))
          })
          .finally(() => setNotesBusy(''))
      }, [notes])

      if (rows === null) {
        return h('div', { className: 'dpi-section' }, h('div', { className: 'dpi-empty' }, '正在加载插件列表…'))
      }

      const updateCount = rows.filter((row) => row.hasUpdate).length
      const children: unknown[] = [
        h('h2', { key: 'title', className: 'dpi-title' }, '插件信息'),
        h('p', { key: 'intro', className: 'dpi-intro' }, '当前 Profile 里用户添加的插件（不含随发行版内置的 bundle）。展开后默认看最近 10 个版本，点版本可看更新说明。'),
        h('div', { key: 'toolbar', className: 'dpi-toolbar' },
          h('button', { className: 'dpi-secondaryButton', disabled: busy, onClick: () => { load() } }, busy ? '刷新中…' : '刷新'),
          h('span', { className: 'dpi-status' }, '共 ' + rows.length + ' 个插件' + (updateCount > 0 ? ' · ' + updateCount + ' 个可更新' : '')),
        ),
      ]
      if (error !== '') children.push(h('p', { key: 'err', className: 'dpi-banner' }, '加载失败：' + error))
      if (rows.length === 0) children.push(h('div', { key: 'empty', className: 'dpi-empty' }, '这个 Profile 还没有用户添加的插件。'))

      const cards: unknown[] = []
      for (const plugin of rows) {
        const expanded = open[plugin.name] === true
        const head: unknown[] = [
          h('span', { key: 'name', className: 'dpi-name' }, plugin.name),
          h('span', { key: 'src', className: 'dpi-tag' }, sourceLabel(plugin.source)),
        ]
        if (plugin.installedVersion !== undefined) {
          head.push(h('span', { key: 'ver', className: 'dpi-tag' }, plugin.installedVersion))
        }
        if (plugin.hasUpdate && plugin.latestVersion !== undefined) {
          head.push(h('span', { key: 'up', className: 'dpi-tag', 'data-tone': 'warn' }, '可更新 ' + plugin.latestVersion))
        } else if (plugin.source === 'registry' && plugin.latestVersion !== undefined) {
          head.push(h('span', { key: 'ok', className: 'dpi-tag', 'data-tone': 'ok' }, '已是最新'))
        }
        const body: unknown[] = []
        if (expanded) {
          if (plugin.description !== undefined) body.push(h('p', { key: 'desc', className: 'dpi-meta' }, plugin.description))
          body.push(h('p', { key: 'spec', className: 'dpi-meta' },
            '依赖：',
            h('span', { className: 'dpi-id' }, plugin.spec),
            plugin.latestVersion === undefined ? null : ' · 最新 ' + plugin.latestVersion,
          ))
          if (plugin.error !== undefined) body.push(h('p', { key: 'perr', className: 'dpi-banner' }, plugin.error))
          const links: unknown[] = [
            h('button', {
              key: 'copy',
              className: 'dpi-copyTag',
              title: '复制包名',
              onClick: () => { copyName(plugin.name) },
            }, copied[plugin.name] === true ? '已复制' : plugin.name),
            h('button', {
              key: 'vers',
              className: 'dpi-rowButton',
              onClick: () => { loadVersions(plugin.name) },
            }, versions[plugin.name] === undefined ? '加载版本' : '重新加载版本'),
          ]
          if (plugin.homepage !== undefined) {
            links.push(h('a', { key: 'home', className: 'dpi-rowButton dpi-link', href: plugin.homepage, target: '_blank', rel: 'noreferrer' }, '主页'))
          }
          if (plugin.repository !== undefined) {
            links.push(h('a', { key: 'repo', className: 'dpi-rowButton dpi-link', href: plugin.repository, target: '_blank', rel: 'noreferrer' }, '仓库'))
          }
          body.push(h('div', { key: 'actions', className: 'dpi-actions' }, ...links))
          const pluginVersions = versions[plugin.name]
          const loadError = versionError[plugin.name]
          if (loadError !== undefined && loadError !== '') {
            body.push(h('p', { key: 'verr', className: 'dpi-banner' }, loadError))
          } else if (pluginVersions === undefined) {
            body.push(h('p', { key: 'vload', className: 'dpi-meta' }, '正在加载最近 10 个版本…'))
          } else if (pluginVersions.length === 0) {
            body.push(h('p', { key: 'vempty', className: 'dpi-meta' }, plugin.source === 'registry' ? '注册表没有版本记录。' : '本地 / git 安装没有更多历史版本。'))
          } else {
            const versionNodes = pluginVersions.map((row) => {
              const key = plugin.name + '@' + row.version
              const isOpen = selected[plugin.name] === row.version
              const note = notes[key]
              const tags: unknown[] = [h('span', { key: 'v', className: 'dpi-id' }, row.version)]
              if (row.installed) tags.push(h('span', { key: 'i', className: 'dpi-tag' }, '当前'))
              if (row.latest) tags.push(h('span', { key: 'l', className: 'dpi-tag', 'data-tone': 'ok' }, 'latest'))
              if (row.publishedAt !== undefined) tags.push(h('span', { key: 't', className: 'dpi-meta' }, formatTime(row.publishedAt)))
              const noteChildren: unknown[] = []
              if (isOpen) {
                if (notesBusy === key && note === undefined) {
                  noteChildren.push(h('p', { key: 'nload', className: 'dpi-meta' }, '正在加载更新说明…'))
                } else if (note === undefined) {
                  noteChildren.push(h('p', { key: 'nmiss', className: 'dpi-meta' }, '没有更新说明。'))
                } else if (note.source === 'github-release') {
                  if (note.title !== undefined) noteChildren.push(h('p', { key: 'nt', className: 'dpi-meta' }, note.title))
                  if (note.body !== undefined && note.body !== '') {
                    noteChildren.push(h(MarkdownText, { key: 'nb', text: note.body }))
                  }
                  if (note.url !== undefined) {
                    noteChildren.push(h('a', { key: 'nu', className: 'dpi-link', href: note.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 查看 Release'))
                  }
                } else if (note.source === 'github-compare' && note.commits !== undefined) {
                  noteChildren.push(h('ul', { key: 'nc', className: 'dpi-commits' },
                    ...note.commits.map((commit) => h('li', { key: commit.sha },
                      h('span', { className: 'dpi-id' }, commit.sha),
                      ' ',
                      commit.message,
                    )),
                  ))
                  if (note.url !== undefined) {
                    noteChildren.push(h('a', { key: 'ncu', className: 'dpi-link', href: note.url, target: '_blank', rel: 'noreferrer' }, '在 GitHub 比较'))
                  }
                } else {
                  const fallback = note.body ?? '这个版本没有找到 GitHub Release 或提交说明。'
                  // Error payloads and the "none" source are plain text; keep
                  // them literal rather than feeding them through Markdown.
                  noteChildren.push(h('p', { key: 'nnone', className: 'dpi-meta' }, fallback))
                }
              }
              return h('div', { key: row.version },
                h('button', {
                  className: 'dpi-version',
                  'data-open': isOpen ? '1' : '0',
                  onClick: () => { openNotes(plugin.name, row.version) },
                }, ...tags),
                isOpen ? h('div', { className: 'dpi-notes' }, ...noteChildren) : null,
              )
            })
            body.push(h('div', { key: 'versions', className: 'dpi-versions' }, ...versionNodes))
          }
        }
        cards.push(h('li', { key: plugin.name, className: 'dpi-card' },
          h('button', {
            className: 'dpi-head',
            'aria-expanded': expanded,
            onClick: () => { togglePlugin(plugin.name) },
          }, ...head),
          expanded ? h('div', { className: 'dpi-body' }, ...body) : null,
        ))
      }
      children.push(h('ul', { key: 'cards', className: 'dpi-cards' }, ...cards))
      return h('div', { className: 'dpi-section' }, ...children)
    }

    /**
     * Sidebar-tab wrapper: same content as the settings panel, but hosted in
     * the narrow right-side better-sidebar pane where it must manage its own
     * vertical scroll and drop the 720px max-width.
     */
    const PluginInfoSidebarPanel = (): unknown => {
      return h('div', { className: 'dpi-sidebar' }, h(PluginInfoPanel, null))
    }

    /** Small Cordis-plugin outline glyph (same geometry as the settings
     *  nav uses, suitable for the sidebar's 16px tab icon slot). */
    const PluginIcon = (size: number): unknown => {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 14 14',
        fill: 'none',
        'aria-hidden': true,
      },
        h('path', {
          fill: 'currentColor',
          d: 'M3.03426 5.66661L1.70084 7.00003L3.0315 8.33069L2.14762 9.21457L-0.0669245 7.00003L2.15038 4.78273L3.03426 5.66661ZM7 14.067L4.77924 11.8462L5.66313 10.9623L7 12.2992L8.33342 10.9658L9.2173 11.8496L7 14.067ZM11.8489 9.21803L10.965 8.33414L12.2992 7.00003L10.9623 5.66316L11.8462 4.77927L14.0669 7.00003L11.8489 9.21803ZM8.33066 3.03153L7 1.70087L5.66589 3.03498L4.782 2.1511L7 -0.0668945L9.21454 2.14765L8.33066 3.03153Z',
        }),
        h('rect', { x: 5.98535, y: 5.98535, width: 2.02942, height: 2.02942, fill: 'currentColor' }),
      )
    }

    /**
     * Register the sidebar tab ONLY when dsh-better-sidebar is present. The
     * child fiber waits for the `betterSidebar` service; if that plugin is
     * not installed the callback never runs and the rest of this plugin is
     * unaffected. The disposer returned by registerTab is attached to the
     * child fiber, so disabling/HMR of either side cleans up cleanly.
     */
    const registerSidebarTab = (ctx: ClientContext): void => {
      ctx.inject(['betterSidebar'], ((sctx: ClientContext) => {
        const service = (sctx as unknown as { betterSidebar: BetterSidebarServiceLike }).betterSidebar
        sctx.effect(() => service.registerTab({
          id: '@eya46/dsh-plugin-info',
          title: '插件信息',
          icon: (size: number) => PluginIcon(size),
          order: 90,
          single: true,
          component: PluginInfoSidebarPanel,
        }), '@eya46/dsh-plugin-info: better-sidebar tab')
      }) as (ctx: ClientContext) => void)
    }

    return {
      name: 'dsh-plugin-info',
      inject: ['slots'],
      apply(ctx: ClientContext) {
        ctx.effect(watchSettingsNav, '@eya46/dsh-plugin-info: settings nav icon patch')
        ctx.slots.inject('settings.section', () => {
          ctx.slots.register(
            { name: 'settings.section', id: 'plugin-info', order: 16, label: '插件信息' },
            PluginInfoPanel,
          )
        })
        // Optional injection into dsh-better-sidebar: no-op when that
        // plugin is absent from the profile.
        registerSidebarTab(ctx)
      },
    }
    },
  })
})()
