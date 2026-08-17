import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '..')

describe('prebuilt client bundle', () => {
  it('exposes its manifest for DSH client-module discovery', async () => {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      readonly exports?: Record<string, unknown>
    }

    expect(manifest.exports?.['./package.json']).toBe('./package.json')
  })

  it('registers one host-module factory and only requests approved shared externals', async () => {
    const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>')
    const staleStyle = dom.window.document.createElement('style')
    staleStyle.dataset.plugin = 'dsh-fold-turns'
    staleStyle.dataset.pluginCss = 'dsh-fold-turns/FoldToggle.module.css'
    staleStyle.textContent = 'stale-css'
    dom.window.document.head.append(staleStyle)
    const registrations: Array<{ readonly id: string; readonly factory: (require: (id: string) => unknown) => unknown }> = []
    const runtime = {
      createSnapshotStore: <T,>(initial: T) => ({
        getSnapshot: () => initial,
        subscribe: () => () => {},
        set: () => {},
      }),
      defineStore: () => ({}),
      isAppendSurfaceEvent: () => true,
    }
    const externals: Record<string, unknown> = {
      react: {
        memo: <T,>(component: T) => component,
        useCallback: <T,>(callback: T) => callback,
        useLayoutEffect: () => {},
        useRef: <T,>(value: T) => ({ current: value }),
      },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
      '@deepseek-ai/dsh-client-runtime/client': runtime,
      '@deepseek-ai/dsh-client-ui-primitives': { IconChevronDownOutline14: () => null },
    }
    const requested = new Set<string>()
    runInNewContext(source, {
      window: Object.assign(dom.window, {
        __ModuleLoader__: { load: (entry: { id: string; factory: (require: (id: string) => unknown) => unknown }) => registrations.push(entry) },
      }),
      document: dom.window.document,
      console,
      setTimeout,
      clearTimeout,
    }, { filename: 'client.js' })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.id).toBe('dsh-fold-turns')
    const exports = registrations[0]?.factory((id) => {
      requested.add(id)
      const value = externals[id]
      if (value === undefined) throw new Error(`unexpected browser external: ${id}`)
      return value
    }) as { readonly apply?: unknown; readonly inject?: unknown }

    expect(exports.apply).toEqual(expect.any(Function))
    expect(exports.inject).toEqual(['conversationEvents', 'slots', 'sessions', 'locale'])
    expect([...requested].sort()).toEqual(Object.keys(externals).sort())
    const styles = dom.window.document.querySelectorAll('style[data-plugin="dsh-fold-turns"]')
    expect(styles).toHaveLength(1)
    expect(styles[0]?.textContent).not.toBe('stale-css')
    expect(styles[0]?.textContent?.length).toBeGreaterThan(100)
  })

  it('declares every directly required DSH client package in the browser dependency graph', async () => {
    const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8')) as {
      readonly dsh?: { readonly client?: { readonly inject?: readonly string[] } }
    }
    const requiredDshPackages = [...source.matchAll(/require\("(@deepseek-ai\/dsh-client-[^"]+?)(?:\/client)?"\)/g)]
      .map(match => match[1])
    expect(manifest.dsh?.client?.inject).toEqual(expect.arrayContaining(requiredDshPackages))
  })

  it('keeps the Node loader placeholder importable from the package entry', async () => {
    const entry = await import(`${pathToFileURL(resolve(ROOT, 'lib/index.mjs')).href}?bundle-test`)
    expect(entry.name).toBe('dsh-fold-turns')
    expect(entry.apply).toEqual(expect.any(Function))
  })
})
