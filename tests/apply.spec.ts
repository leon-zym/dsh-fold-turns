import { describe, expect, it, vi } from 'vitest'

const { disposeStyles } = vi.hoisted(() => ({ disposeStyles: vi.fn() }))
vi.mock('../src/client/components/FoldToggle.module.css', () => ({ default: {}, disposeStyles }))

import { apply } from '../src/client/apply.ts'

function emptySnapshot() {
  return {
    chat: {
      order: [],
      timeline: { turnOrder: [], turns: new Map() },
      locations: { getTurn: () => [] },
      nodes: new Map(),
    },
    openState: undefined,
    loadingOlder: false,
  }
}

describe('client apply lifecycle', () => {
  it('binds fold resources to the session scope and does not reuse a pruned identity', () => {
    const rootDisposers: Array<() => void> = []
    const sessionDisposers: Array<() => void> = []
    const registrations: Array<{ inject: (sessionId: string) => any }> = []
    const firstUnsubscribe = vi.fn()
    const secondUnsubscribe = vi.fn()
    const bindingFor = (unsubscribe: () => void) => ({
      sessionId: 'session-1',
      session: { getSnapshot: emptySnapshot, subscribe: () => unsubscribe },
      ctx: {
        effect: (callback: () => (() => void)) => {
          const dispose = callback()
          sessionDisposers.push(dispose)
          return dispose
        },
      },
    })
    let binding = bindingFor(firstUnsubscribe)
    const ctx = {
      conversationEvents: { register: vi.fn() },
      locale: { register: () => vi.fn() },
      sessions: { binding: () => binding },
      effect: (callback: () => void | (() => void)) => {
        const dispose = callback()
        if (typeof dispose === 'function') rootDisposers.push(dispose)
        return typeof dispose === 'function' ? dispose : () => {}
      },
      slots: {
        inject: (_key: string, callback: () => (() => void)) => {
          const dispose = callback()
          rootDisposers.push(dispose)
          return dispose
        },
        register: (registration: { inject: (sessionId: string) => any }) => {
          registrations.push(registration)
          return vi.fn()
        },
      },
    }
    apply(ctx as never)

    const first = registrations[0]?.inject('session-1')
    const firstPeer = registrations[1]?.inject('session-1')
    expect(first.hooks.foldModel).toBe(firstPeer.hooks.foldModel)
    expect(first.coordinator).toBe(firstPeer.coordinator)
    expect(sessionDisposers).toHaveLength(1)

    const disposeFirstSession = sessionDisposers.shift()
    disposeFirstSession?.()
    expect(firstUnsubscribe).toHaveBeenCalledOnce()

    binding = bindingFor(secondUnsubscribe)
    const second = registrations[0]?.inject('session-1')
    expect(second.hooks.foldModel).not.toBe(first.hooks.foldModel)
    expect(second.coordinator).not.toBe(first.coordinator)

    disposeFirstSession?.()
    const secondPeer = registrations[1]?.inject('session-1')
    expect(secondPeer.hooks.foldModel).toBe(second.hooks.foldModel)
    expect(secondPeer.coordinator).toBe(second.coordinator)

    for (const dispose of rootDisposers.reverse()) dispose()
    expect(firstUnsubscribe).toHaveBeenCalledOnce()
    expect(secondUnsubscribe).toHaveBeenCalledOnce()
  })

  it('calls the evaluated CSS module ownership disposer on root disposal', () => {
    disposeStyles.mockClear()
    const rootDisposers: Array<() => void> = []
    const other = document.createElement('style')
    other.dataset.plugin = 'another-plugin'
    document.head.append(other)
    const ctx = {
      conversationEvents: { register: vi.fn() },
      locale: { register: () => vi.fn() },
      sessions: { binding: vi.fn() },
      effect: (callback: () => void | (() => void)) => {
        const dispose = callback()
        if (typeof dispose === 'function') rootDisposers.push(dispose)
        return typeof dispose === 'function' ? dispose : () => {}
      },
      slots: {
        inject: (_key: string, callback: () => (() => void)) => {
          const dispose = callback()
          rootDisposers.push(dispose)
          return dispose
        },
        register: () => vi.fn(),
      },
    }
    apply(ctx as never)

    for (const dispose of rootDisposers.reverse()) dispose()

    expect(disposeStyles).toHaveBeenCalledOnce()
    expect(document.head.querySelector('style[data-plugin="another-plugin"]')).toBe(other)
    other.remove()
  })
})
