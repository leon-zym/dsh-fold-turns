import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TurnFoldPlan } from '../src/client/fold-core.ts'
import { probeChatFlow } from '../src/client/host/chat-flow-v1.ts'
import { ChatFlowDomCoordinator } from '../src/client/host/dom-coordinator.ts'

const plan: TurnFoldPlan = {
  turn: 4,
  eligible: true,
  startUserKey: 'user',
  startCandidateKey: 'fold-start',
  closingKey: 'closing',
  endToggleKey: 'fold-end',
  tailKey: 'tail',
  hiddenKeys: ['process'],
  closingReasoningCount: 1,
  durationMs: 2_000,
}

interface Fixture {
  readonly flow: HTMLElement
  readonly top: HTMLButtonElement
  readonly bottom: HTMLButtonElement
  readonly process: HTMLElement
  readonly processControl: HTMLButtonElement
  readonly thinking: HTMLElement
  readonly end: HTMLElement
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

function fixture(includeProcess = true): Fixture {
  const scrollport = document.createElement('div')
  scrollport.dataset.conversationScroll = ''
  const flow = document.createElement('div')
  flow.dataset.chatFlow = ''
  scrollport.append(flow)
  document.body.append(scrollport)

  const user = row('user', 'user')
  const start = row('fold-start', 'fold-start')
  const top = document.createElement('button')
  start.append(top)
  const process = row('process', 'tool-call')
  const processControl = document.createElement('button')
  process.append(processControl)
  const end = row('fold-end', 'fold-end')
  const bottom = document.createElement('button')
  end.append(bottom)
  const closing = row('closing', 'assistant-step')
  const thinking = document.createElement('section')
  thinking.dataset.variant = 'think'
  closing.append(thinking)
  const tail = row('tail', 'turn-tail')
  flow.append(user, start)
  if (includeProcess) flow.append(process)
  flow.append(end, closing, tail)
  return { flow, top, bottom, process, processControl, thinking, end }
}

function row(key: string, kind: string): HTMLDivElement {
  const element = document.createElement('div')
  element.dataset.chatAnchorKey = key
  element.dataset.chatFlowKey = key
  element.dataset.chatFlowKind = kind
  return element
}

describe('ChatFlowDomCoordinator', () => {
  it('hides only exact process rows and closing Think without reparenting native rows', () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}

    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(view.process.parentElement).toBe(view.flow)
    expect(view.process.style.display).toBe('none')
    expect(view.thinking.style.display).toBe('none')
    expect(view.end.style.display).toBe('none')
    expect(view.process.getAttribute('inert')).toBe('')
    expect(view.process.getAttribute('aria-hidden')).toBe('true')

    coordinator.updateTop(owner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })
    expect(view.process.style.display).toBe('')
    expect(view.thinking.style.display).toBe('')
    expect(view.end.style.display).toBe('')
    coordinator.dispose()
  })

  it('moves focus to the top button before a bottom-triggered collapse', () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    const bottomOwner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })
    coordinator.mountBottom(bottomOwner, plan.turn, view.bottom)

    view.bottom.focus()
    coordinator.requestToggle(plan.turn, true, view.bottom, false)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(document.activeElement).toBe(view.top)
    expect(view.process.style.display).toBe('none')
    coordinator.dispose()
  })

  it('retries a live completion when React commits the final rows after the top toggle', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const originalObserver = window.MutationObserver
    Object.defineProperty(window, 'MutationObserver', { configurable: true, value: undefined })
    try {
      const view = fixture(false)
      const coordinator = new ChatFlowDomCoordinator()
      const owner = {}
      coordinator.mountTop(owner, view.top)

      coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'live' })
      expect(view.process.style.display).toBe('')

      view.flow.insertBefore(view.process, view.end)
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(view.process.style.display).toBe('none')
      expect(view.end.style.display).toBe('none')
      coordinator.dispose()
    } finally {
      Object.defineProperty(window, 'MutationObserver', { configurable: true, value: originalObserver })
    }
  })

  it('reapplies a collapsed turn when React replaces one direct process row', async () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    const replacement = row('process', 'tool-call')
    view.flow.replaceChild(replacement, view.process)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(replacement.style.display).toBe('none')
    expect(replacement.getAttribute('data-dsh-fold-hidden')).toBe('')
    coordinator.dispose()
  })

  it('keeps an initially incomplete history turn native after later DOM commits', async () => {
    const view = fixture(false)
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)

    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })
    view.flow.insertBefore(view.process, view.end)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(view.process.style.display).toBe('')
    expect(view.end.style.display).toBe('')
    coordinator.dispose()
  })

  it('does not overwrite a style changed by another owner during cleanup', () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    view.process.style.display = 'grid'
    coordinator.dispose()
    expect(view.process.style.display).toBe('grid')
  })

  it('reports a view-level failure when duplicate anchor keys invalidate ownership', () => {
    const view = fixture()
    view.flow.append(row('process', 'tool-call'))

    expect(probeChatFlow(view.top, plan)).toEqual({
      ok: false,
      scope: 'view',
      reason: 'duplicate-chat-anchor-key',
    })
  })
})
