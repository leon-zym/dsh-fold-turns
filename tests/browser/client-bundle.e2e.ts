import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'

const ROOT = resolve(import.meta.dirname, '../..')

test('the published browser bundle boots against a real DOM and refreshes its CSS', async ({ page }) => {
  const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')
  await page.setContent(`<!doctype html><html><head>
    <style data-plugin="dsh-fold-turns" data-plugin-css="dsh-fold-turns/FoldToggle.module.css">stale-css</style>
  </head><body></body></html>`)
  await page.evaluate(() => {
    const registrations: unknown[] = []
    Object.assign(window, {
      __dshFoldTurnsRegistrations: registrations,
      __ModuleLoader__: { load: (entry: unknown) => registrations.push(entry) },
    })
  })

  await page.addScriptTag({ content: source })

  const result = await page.evaluate(() => {
    type Registration = { id: string; factory: (require: (id: string) => unknown) => Record<string, unknown> }
    const registrations = (window as unknown as { __dshFoldTurnsRegistrations: Registration[] }).__dshFoldTurnsRegistrations
    const requested: string[] = []
    const externals: Record<string, unknown> = {
      react: {
        memo: <T,>(component: T) => component,
        useCallback: <T,>(callback: T) => callback,
        useEffect: () => {},
        useLayoutEffect: () => {},
        useRef: <T,>(value: T) => ({ current: value }),
        useState: <T,>(value: T | (() => T)) => [typeof value === 'function' ? (value as () => T)() : value, () => {}],
      },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
      '@deepseek-ai/dsh-client-runtime/client': {
        createSnapshotStore: <T,>(initial: T) => ({
          getSnapshot: () => initial,
          subscribe: () => () => {},
          set: () => {},
        }),
        defineStore: () => ({}),
        isAppendSurfaceEvent: () => true,
      },
      '@deepseek-ai/dsh-client-ui-primitives': { IconChevronDownOutline14: () => null },
    }
    const registration = registrations[0]
    const exports = registration?.factory((id) => {
      requested.push(id)
      if (!(id in externals)) throw new Error(`unexpected browser external: ${id}`)
      return externals[id]
    })
    const styles = [...document.querySelectorAll<HTMLStyleElement>('style[data-plugin="dsh-fold-turns"]')]
    return {
      id: registration?.id,
      registrationCount: registrations.length,
      hasApply: typeof exports?.apply === 'function',
      requested: requested.sort(),
      styleCount: styles.length,
      styleText: styles[0]?.textContent ?? '',
    }
  })

  expect(result).toMatchObject({
    id: 'dsh-fold-turns',
    registrationCount: 1,
    hasApply: true,
    requested: [
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-primitives',
      'react',
      'react/jsx-runtime',
    ],
    styleCount: 1,
  })
  expect(result.styleText).not.toBe('stale-css')
  expect(result.styleText.length).toBeGreaterThan(100)
})

test('an old HMR epoch cannot remove the style owned by the new module', async ({ page }) => {
  const source = await readFile(resolve(ROOT, 'lib/client.js'), 'utf8')
  await page.setContent('<!doctype html><html><head></head><body></body></html>')
  await page.evaluate(() => {
    const registrations: unknown[] = []
    Object.assign(window, {
      __dshFoldTurnsRegistrations: registrations,
      __ModuleLoader__: { load: (entry: unknown) => registrations.push(entry) },
    })
  })
  await page.addScriptTag({ content: source })
  await page.addScriptTag({ content: source })

  const counts = await page.evaluate(() => {
    type Registration = { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } }
    const registrations = (window as unknown as { __dshFoldTurnsRegistrations: Registration[] }).__dshFoldTurnsRegistrations
    const externals: Record<string, unknown> = {
      react: {
        memo: <T,>(component: T) => component,
        useCallback: <T,>(callback: T) => callback,
        useEffect: () => {},
        useLayoutEffect: () => {},
        useRef: <T,>(value: T) => ({ current: value }),
        useState: <T,>(value: T) => [value, () => {}],
      },
      'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
      '@deepseek-ai/dsh-client-runtime/client': {
        createSnapshotStore: <T,>(initial: T) => ({ getSnapshot: () => initial, subscribe: () => () => {}, set: () => {} }),
        defineStore: () => ({}),
        isAppendSurfaceEvent: () => true,
      },
      '@deepseek-ai/dsh-client-ui-primitives': { IconChevronDownOutline14: () => null },
    }
    const load = (registration: Registration) => registration.factory(id => externals[id])
    const applyAndGetStyleDisposer = (exports: { apply: (ctx: unknown) => void }) => {
      let dispose = () => {}
      exports.apply({
        conversationEvents: { register: () => {} },
        locale: { register: () => () => {} },
        slots: { inject: () => {} },
        effect: (effect: () => unknown, label: string) => {
          const cleanup = effect()
          if (label === 'dsh-fold-turns: client styles' && typeof cleanup === 'function') dispose = cleanup as () => void
        },
      })
      return dispose
    }

    const disposeOld = applyAndGetStyleDisposer(load(registrations[0]))
    const disposeNew = applyAndGetStyleDisposer(load(registrations[1]))
    const before = document.querySelectorAll('style[data-plugin="dsh-fold-turns"]').length
    disposeOld()
    const afterOldDispose = document.querySelectorAll('style[data-plugin="dsh-fold-turns"]').length
    disposeNew()
    const afterNewDispose = document.querySelectorAll('style[data-plugin="dsh-fold-turns"]').length
    return { before, afterOldDispose, afterNewDispose }
  })

  expect(counts).toEqual({ before: 1, afterOldDispose: 1, afterNewDispose: 0 })
})
