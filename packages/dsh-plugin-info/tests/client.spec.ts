import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

/**
 * The browser half runs inside DSH's module loader, so this harness supplies
 * what it reads from the shell: `window.__ModuleLoader__`, a React whose hooks
 * keep state between renders, the shell's MarkdownText primitive, and the few
 * DOM globals the settings-icon patch touches. Rendering the panel repeatedly —
 * before and after the plugin list arrives, then after an upgrade — is what
 * exercises the upgrade control the page draws.
 */

type Element = { type: unknown, props: Record<string, unknown>, children: unknown[] }

/** The module the client bundle handed to the loader. */
interface ClientModule { apply: (ctx: unknown) => void }

/** The React the bundle receives, with the render controls this harness adds. */
interface FakeReact {
  __beginRender: () => void
  __resetMount: () => void
  __drainEffects: () => void
}

let clientModule: ClientModule | undefined
let fakeReact: FakeReact | undefined

/** Collect every element in a rendered tree, depth first. */
function walk(node: unknown, out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out)
    return out
  }
  if (typeof node !== 'object' || node === null) return out
  const element = node as Element
  if (!Array.isArray(element.children)) return out
  out.push(element)
  for (const child of element.children) walk(child, out)
  return out
}

/** All text under one element. */
function textOf(element: Element): string {
  const parts: string[] = []
  const visit = (node: unknown): void => {
    if (typeof node === 'string' || typeof node === 'number') parts.push(String(node))
    else if (Array.isArray(node)) for (const child of node) visit(child)
    else if (typeof node === 'object' && node !== null) {
      for (const child of (node as Element).children ?? []) visit(child)
    }
  }
  visit(element)
  return parts.join('')
}

/** Buttons with their visible label, in document order. */
function buttons(root: unknown): Array<{ label: string, props: Record<string, unknown> }> {
  return walk(root)
    .filter((element) => element.type === 'button')
    .map((element) => ({ label: textOf(element), props: element.props }))
}

/** Install the browser-half globals once and import the bundle. */
function bootGlobals(): void {
  if (clientModule !== undefined) return
  /** State cells of the panel currently mounted; a fresh mount starts empty. */
  let cells: unknown[] = []
  let cursor = 0
  /** Effects queued by the render in progress; the harness runs them after it. */
  let pending: Array<() => void> = []
  const React = {
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element {
      return { type, props: props ?? {}, children }
    },
    useState<T>(initial: T): [T, (next: T | ((prev: T) => T)) => void] {
      const index = cursor++
      if (!(index in cells)) cells[index] = initial
      const set = (next: T | ((prev: T) => T)): void => {
        cells[index] = typeof next === 'function' ? (next as (prev: T) => T)(cells[index] as T) : next
      }
      return [cells[index] as T, set]
    },
    useEffect(effect: () => void | (() => void)): void {
      pending.push(effect)
    },
    useCallback<T>(fn: T): T { return fn },
    /** The shell wraps MarkdownText in a class component that catches render failures. */
    Component: class {
      state: Record<string, unknown> = {}
      constructor(public props: Record<string, unknown>) {}
      render(): unknown { return null }
    },
    __beginRender: (): void => { cursor = 0 },
    __resetMount: (): void => { cells = []; pending = [] },
    __drainEffects: (): void => {
      const effects = pending
      pending = []
      for (const effect of effects) effect()
    },
  }
  fakeReact = React
  const loader = {
    load: (handoff: { id: string, factory: (require: (spec: string) => unknown) => Record<string, unknown> }) => {
      clientModule = handoff.factory((spec: string) => {
        if (spec === 'react') return React
        if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
          return { MarkdownText: (props: { text: string }) => ({ type: 'markdown', props, children: [props.text] }) }
        }
        throw new Error(`unexpected require(${spec})`)
      }) as unknown as ClientModule
    },
  }
  const g = globalThis as Record<string, unknown>
  g.window = { __ModuleLoader__: loader, setTimeout: (fn: () => void) => setTimeout(fn, 0) }
  g.document = {
    querySelector: () => ({ setAttribute: () => {}, textContent: '' }),
    querySelectorAll: () => [],
    createElement: () => ({ setAttribute: () => {}, textContent: '', appendChild: () => {} }),
    head: { appendChild: () => {} },
    body: {},
  }
  g.MutationObserver = class { observe(): void {} disconnect(): void {} }
  require('../src/client.ts')
}

/** Mount the panel on a fresh context and return a renderer for it. */
function mountPanel(): () => unknown {
  bootGlobals()
  const react = fakeReact as FakeReact
  react.__resetMount()
  let component: unknown
  clientModule?.apply({
    slots: {
      inject: (_key: string, register: () => void) => { register() },
      register: (_options: Record<string, unknown>, target: unknown) => { component = target },
    },
    effect: (body: () => void) => { body() },
    inject: () => undefined,
  })
  return () => {
    react.__beginRender()
    const tree = (component as () => unknown)()
    react.__drainEffects()
    return tree
  }
}

const PLUGINS = {
  profile: 'dsh-profile-web',
  profileCli: 'web',
  plugins: [
    {
      name: 'dsh-better-sidebar',
      spec: '^0.13.0',
      source: 'registry',
      installedVersion: '0.13.0',
      latestVersion: '0.14.0',
      hasUpdate: true,
      updateCommand: 'dsh plugin --profile web add dsh-better-sidebar@latest',
    },
    {
      name: 'dsh-skill-mcp-panel',
      spec: 'https://github.com/Fishquito7/dsh-skill-mcp-panel/releases/download/v2.0.3/dsh-skill-mcp-panel-2.0.3.tgz',
      source: 'other',
      installedVersion: '2.0.3',
      latestVersion: '2.0.4',
      hasUpdate: true,
      updateCommand: 'dsh plugin --profile web add "https://github.com/…/v2.0.4/dsh-skill-mcp-panel-2.0.4.tgz"',
    },
    {
      name: 'local-plugin',
      spec: 'file:./local',
      source: 'file',
      installedVersion: '1.0.0',
      hasUpdate: false,
    },
  ],
}

/** Serve the read API and record every POST the page sends. */
function stubFetch(posts: Array<{ url: string, body: unknown }>, update: unknown): void {
  const g = globalThis as Record<string, unknown>
  g.fetch = async (input: string, init?: { method?: string, body?: string }) => {
    const url = String(input)
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(init.body ?? 'null') })
      return { json: async () => update }
    }
    if (url.includes('/plugins')) return { json: async () => PLUGINS }
    if (url.includes('/versions')) {
      return {
        json: async () => ({
          versions: [
            { version: '0.14.0', latest: true, installed: false },
            { version: '0.13.0', latest: false, installed: true },
          ],
        }),
      }
    }
    return { json: async () => ({ name: 'x', version: '1.0.0', source: 'none' }) }
  }
}

/** Let the pending list request settle before the next render reads its state. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Render, wait for the list, expand every card, and render once more. */
async function mountExpanded(): Promise<{ render: () => unknown, tree: unknown }> {
  const render = mountPanel()
  render()
  await settle()
  const list = render()
  for (const button of buttons(list)) {
    if (button.props.className === 'dpi-head') (button.props.onClick as () => void)()
  }
  await settle()
  return { render, tree: render() }
}

describe('plugin-info settings page', () => {
  it('draws an upgrade control for updatable plugins and posts the exact version', async () => {
    const posts: Array<{ url: string, body: unknown }> = []
    stubFetch(posts, {
      name: 'dsh-better-sidebar', from: '0.13.0', to: '0.14.0', step: 'install', ok: true,
      application: 'restart-required', route: 'remove-and-install',
    })
    const { render, tree } = await mountExpanded()
    expect(textOf(walk(tree)[0] as Element)).not.toContain('正在加载插件列表')

    const all = buttons(tree)
    // The card header carries a compact upgrade control; the expanded body carries a labelled one.
    const compact = all.find((button) => button.props.className === 'dpi-updateCopy')
    expect(compact).toBeDefined()
    expect(compact?.label).toBe('升级')
    const labelled = all.filter((button) => button.props.className === 'dpi-rowButton dpi-primaryButton')
    expect(labelled.length).toBe(2)
    expect(labelled[0]?.label).toBe('升级到 0.14.0')
    expect(labelled[0]?.props.title).toBe('升级到 0.14.0')
    // A local file install has nothing to compare against, so it gets no upgrade control.
    expect(all.filter((button) => button.props.className === 'dpi-updateCopy').length).toBe(2)

    await (labelled[0]?.props.onClick as () => void)(); await settle(); await settle()
    expect(posts).toEqual([{ url: '/plugin-info/api/update', body: { name: 'dsh-better-sidebar', version: '0.14.0' } }])

    const after = render()
    expect(textOf(walk(after)[0] as Element)).toContain('升级成功：0.13.0 → 0.14.0（卸载后重装），重启后生效')
  })

  it('reports a failed upgrade with its step, reason, and the restored version', async () => {
    const posts: Array<{ url: string, body: unknown }> = []
    stubFetch(posts, {
      name: 'dsh-better-sidebar', from: '0.13.0', to: '0.14.0', step: 'install', ok: false,
      reason: 'peer range rejects 0.14.0', route: 'remove-and-install', restore: { ok: true, application: 'applied' },
    })
    const { render, tree } = await mountExpanded()
    const labelled = buttons(tree).filter((button) => button.props.className === 'dpi-rowButton dpi-primaryButton')
    await (labelled[0]?.props.onClick as () => void)(); await settle(); await settle()
    const after = render()
    expect(textOf(walk(after)[0] as Element))
      .toContain('升级失败：0.13.0 → 0.14.0（卸载后重装）（停在「安装新版本」）：peer range rejects 0.14.0；已恢复 0.13.0')
  })

  it('reports a refused request that never reached the manager', async () => {
    const posts: Array<{ url: string, body: unknown }> = []
    const g = globalThis as Record<string, unknown>
    g.fetch = async (input: string, init?: { method?: string, body?: string }) => {
      const url = String(input)
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(init.body ?? 'null') })
        return { json: async () => ({ ok: false, reason: 'error', message: '0.99.0 is not a published version' }) }
      }
      if (url.includes('/plugins')) return { json: async () => PLUGINS }
      return { json: async () => ({ versions: [] }) }
    }
    const { render, tree } = await mountExpanded()
    const labelled = buttons(tree).filter((button) => button.props.className === 'dpi-rowButton dpi-primaryButton')
    await (labelled[0]?.props.onClick as () => void)(); await settle(); await settle()
    const after = render()
    expect(textOf(walk(after)[0] as Element)).toContain('升级请求失败：0.99.0 is not a published version')
  })
})

