import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TurnFoldPlan } from '../src/client/fold-core.ts'
import { probeChatFlow } from '../src/client/host/chat-flow-v1.ts'
import { ChatFlowDomCoordinator } from '../src/client/host/dom-coordinator.ts'

const plan: TurnFoldPlan = {
  turn: 4,
  eligible: true,
  startInputKey: 'user',
  startCandidateKey: 'fold-start',
  closingKey: 'closing',
  endToggleKey: 'fold-end',
  tailKey: 'tail',
  hiddenKeys: ['process'],
  closingReasoningCount: 1,
  durationMs: 2_000,
}

interface Fixture {
  readonly scrollport: HTMLElement
  readonly flow: HTMLElement
  readonly start: HTMLElement
  readonly top: HTMLButtonElement
  readonly bottom: HTMLButtonElement
  readonly process: HTMLElement
  readonly processControl: HTMLButtonElement
  readonly thinking: HTMLElement
  readonly finalContent: HTMLElement
  readonly end: HTMLElement
  readonly closing: HTMLElement
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
  closing.style.display = 'flex'
  closing.style.flexDirection = 'column'
  closing.style.rowGap = '16px'
  const thinking = document.createElement('section')
  thinking.dataset.variant = 'think'
  const finalContent = document.createElement('p')
  finalContent.textContent = 'final answer'
  closing.append(thinking, finalContent)
  const tail = row('tail', 'turn-tail')
  flow.append(user, start)
  if (includeProcess) flow.append(process)
  flow.append(closing, end, tail)
  flow.style.rowGap = '16px'
  return { scrollport, flow, start, top, bottom, process, processControl, thinking, finalContent, end, closing }
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
    expect(view.thinking.parentElement).toBe(view.closing)
    coordinator.dispose()
  })

  it('keeps the expanded visual, DOM, tab, and reading order aligned', () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })

    expect(view.thinking.parentElement).toBe(view.closing)
    expect(view.closing.nextElementSibling).toBe(view.end)
    expect(view.thinking.style.transform).toBe('')
    expect(view.end.style.transform).toBe('')
    coordinator.dispose()
  })

  it('publishes blocked capability when a stable turn cannot be mapped', () => {
    const view = fixture(false)
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)

    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('blocked')
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
    coordinator.requestToggle(plan.turn, true, view.bottom)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(document.activeElement).toBe(view.top)
    expect(view.process.style.display).toBe('none')
    coordinator.dispose()
  })

  it('removes nested Think and the lower row in the same collapse commit', () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    const bottomOwner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })
    coordinator.mountBottom(bottomOwner, plan.turn, view.bottom)

    coordinator.requestToggle(plan.turn, true, view.bottom)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(view.process.style.display).toBe('none')
    expect(view.thinking.style.display).toBe('none')
    expect(view.end.style.display).toBe('none')
    expect(view.thinking.style.transform).toBe('')
    expect(view.end.style.transform).toBe('')
    coordinator.dispose()
  })

  it('keeps the clicked edge fixed while collapsing', () => {
    const rectangle = (top: number) => ({ top, right: 0, bottom: top + 20, left: 0, width: 0, height: 20, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

    const topView = fixture()
    Object.defineProperties(topView.scrollport, {
      scrollHeight: { configurable: true, value: 2_000 },
      clientHeight: { configurable: true, value: 500 },
    })
    topView.scrollport.getBoundingClientRect = () => rectangle(0)
    topView.start.getBoundingClientRect = () => rectangle(80)
    topView.closing.getBoundingClientRect = () => rectangle(topView.process.style.display === 'none' ? 120 : 320)
    topView.scrollport.scrollTop = 400
    const topCoordinator = new ChatFlowDomCoordinator()
    const topOwner = {}
    topCoordinator.mountTop(topOwner, topView.top)
    topCoordinator.updateTop(topOwner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })
    topCoordinator.requestToggle(plan.turn, true, topView.top)
    topCoordinator.updateTop(topOwner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })
    expect(topView.scrollport.scrollTop).toBe(400)
    topCoordinator.dispose()

    const bottomView = fixture()
    Object.defineProperties(bottomView.scrollport, {
      scrollHeight: { configurable: true, value: 2_000 },
      clientHeight: { configurable: true, value: 500 },
    })
    bottomView.scrollport.getBoundingClientRect = () => rectangle(0)
    bottomView.start.getBoundingClientRect = () => rectangle(80)
    bottomView.closing.getBoundingClientRect = () => rectangle(
      bottomView.process.style.display === 'none' ? 120 : bottomView.end.dataset.reactedEmpty === '' ? 280 : 320,
    )
    bottomView.finalContent.getBoundingClientRect = () => rectangle(
      bottomView.process.style.display === 'none' ? 120 : 320,
    )
    bottomView.scrollport.scrollTop = 400
    const bottomCoordinator = new ChatFlowDomCoordinator()
    const bottomOwner = {}
    const bottomToggleOwner = {}
    bottomCoordinator.mountTop(bottomOwner, bottomView.top)
    bottomCoordinator.updateTop(bottomOwner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })
    bottomCoordinator.mountBottom(bottomToggleOwner, plan.turn, bottomView.bottom)
    bottomCoordinator.requestToggle(plan.turn, true, bottomView.bottom)
    bottomView.end.dataset.reactedEmpty = ''
    bottomCoordinator.updateTop(bottomOwner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })
    expect(bottomView.scrollport.scrollTop).toBe(200)
    bottomCoordinator.dispose()
  })

  it('fails open when the host has no lifecycle observer for a late live commit', () => {
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

      view.flow.insertBefore(view.process, view.closing)

      expect(view.process.style.display).toBe('')
      expect(view.end.style.display).toBe('')
      expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('blocked')
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
    expect(view.process.style.display).toBe('')
    expect(view.process.getAttribute('data-dsh-fold-hidden')).toBeNull()
    coordinator.dispose()
  })

  it('waits across a two-commit replacement after restoring the old mapping', async () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    view.process.remove()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('checking')
    expect(view.process.style.display).toBe('')
    expect(view.end.style.display).toBe('')

    const replacement = row('process', 'tool-call')
    view.flow.insertBefore(replacement, view.closing)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('available')
    expect(replacement.style.display).toBe('none')
    coordinator.dispose()
  })

  it('waits across a three-stage replacement with an incomplete middle commit', async () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    view.process.remove()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('checking')

    const replacement = row('process', 'tool-call')
    view.thinking.remove()
    view.flow.insertBefore(replacement, view.closing)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('checking')
    expect(replacement.style.display).toBe('')
    expect(view.end.style.display).toBe('')

    view.closing.prepend(view.thinking)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('available')
    expect(replacement.style.display).toBe('none')
    expect(view.thinking.style.display).toBe('none')
    coordinator.dispose()
  })

  it('reconciles a late nested Think commit from the flow lifecycle observer', async () => {
    const view = fixture()
    view.thinking.remove()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)

    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'live' })
    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('checking')

    view.closing.prepend(view.thinking)
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('available')
    expect(view.thinking.style.display).toBe('none')
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

  it('does not overwrite a same-value style with a newer priority', () => {
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    view.process.style.setProperty('display', 'none', 'important')
    coordinator.dispose()

    expect(view.process.style.getPropertyValue('display')).toBe('none')
    expect(view.process.style.getPropertyPriority('display')).toBe('important')
  })

  it('disconnects an unused flow observer when its top row unmounts', () => {
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect')
    const view = fixture()
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    coordinator.unmountTop(owner)

    expect(disconnect).toHaveBeenCalledOnce()
    coordinator.dispose()
    disconnect.mockRestore()
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

  it('blocks the capability and restores native rows on a view-level failure', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = fixture()
    view.flow.append(row('process', 'tool-call'))
    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)

    coordinator.updateTop(owner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(coordinator.getSnapshot().byTurn.get(plan.turn)).toBe('blocked')
    expect(view.process.style.display).toBe('')
    expect(warning).toHaveBeenCalledOnce()
    coordinator.dispose()
    warning.mockRestore()
  })

  it('blocks later turns without native writes after a view-level disable and releases their capability', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe')
    const invalid = fixture()
    invalid.flow.append(row('process', 'tool-call'))
    const coordinator = new ChatFlowDomCoordinator()
    const invalidOwner = {}
    coordinator.mountTop(invalidOwner, invalid.top)
    coordinator.updateTop(invalidOwner, plan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    const next = fixture()
    const nextOwner = {}
    const nextPlan = { ...plan, turn: plan.turn + 1 }
    coordinator.mountTop(nextOwner, next.top)
    coordinator.updateTop(nextOwner, nextPlan, { expanded: false, loadingOlder: false, presentation: 'initial' })

    expect(coordinator.getSnapshot().byTurn.get(nextPlan.turn)).toBe('blocked')
    expect(next.process.style.display).toBe('')
    expect(next.process.getAttribute('data-dsh-fold-hidden')).toBeNull()
    expect(next.process.getAttribute('aria-hidden')).toBeNull()
    expect(next.thinking.style.display).toBe('')
    expect(next.end.style.display).toBe('')
    expect(observe).not.toHaveBeenCalled()

    coordinator.unmountTop(nextOwner)
    coordinator.unmountTop(invalidOwner)
    expect(coordinator.getSnapshot().byTurn.size).toBe(0)
    coordinator.dispose()
    observe.mockRestore()
    warning.mockRestore()
  })
})
