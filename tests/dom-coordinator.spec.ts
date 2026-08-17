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
  flow.append(end, closing, tail)
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

  it('visually places closing Think before the lower row without reparenting it', () => {
    const view = fixture()
    const rectangle = (top: number, height: number) => ({
      top,
      right: 0,
      bottom: top + height,
      left: 0,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect
    view.end.getBoundingClientRect = () => rectangle(100, 40)
    view.thinking.getBoundingClientRect = () => rectangle(156, 24)

    const coordinator = new ChatFlowDomCoordinator()
    const owner = {}
    coordinator.mountTop(owner, view.top)
    coordinator.updateTop(owner, plan, { expanded: true, loadingOlder: false, presentation: 'initial' })

    expect(view.thinking.parentElement).toBe(view.closing)
    expect(view.thinking.style.transform).toBe('translateY(-56px)')
    expect(view.end.style.transform).toBe('translateY(40px)')
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
