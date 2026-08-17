import type { TurnFoldPlan } from '../fold-core.ts'
import { CHAT_FLOW_ADAPTER } from '../../invariant.ts'
import { runFoldAnimation, type FoldAnimationHandle } from './animation.ts'
import { probeChatFlow, type ChatFlowRows } from './chat-flow-v1.ts'
import type { FoldDomCoordinator, FoldDomState } from './contract.ts'
import { captureScrollAnchor, restoreScrollAnchor } from './scroll.ts'

interface AttributeEntry {
  readonly previous: string | null
  written: string | null
}

interface StyleEntry {
  readonly previous: string
  readonly priority: string
  written: string
}

/** Restores an attribute only while its last value is still plugin-owned. */
class OwnershipLedger {
  private readonly attributes = new Map<HTMLElement, Map<string, AttributeEntry>>()
  private readonly styles = new Map<HTMLElement, Map<string, StyleEntry>>()

  attr(element: HTMLElement, name: string, value: string | null): void {
    let entries = this.attributes.get(element)
    if (entries === undefined) {
      entries = new Map()
      this.attributes.set(element, entries)
    }
    let entry = entries.get(name)
    if (entry === undefined) {
      entry = { previous: element.getAttribute(name), written: value }
      entries.set(name, entry)
    } else {
      entry.written = value
    }
    if (value === null) element.removeAttribute(name)
    else element.setAttribute(name, value)
  }

  style(element: HTMLElement, name: string, value: string | null): void {
    let entries = this.styles.get(element)
    if (entries === undefined) {
      entries = new Map()
      this.styles.set(element, entries)
    }
    let entry = entries.get(name)
    if (entry === undefined) {
      entry = {
        previous: element.style.getPropertyValue(name),
        priority: element.style.getPropertyPriority(name),
        written: value ?? '',
      }
      entries.set(name, entry)
    } else {
      entry.written = value ?? ''
    }
    if (value === null) element.style.removeProperty(name)
    else element.style.setProperty(name, value)
  }

  restore(element: HTMLElement): void {
    const attributes = this.attributes.get(element)
    if (attributes !== undefined) {
      for (const [name, entry] of attributes) {
        const current = element.getAttribute(name)
        if (current === entry.written) {
          if (entry.previous === null) element.removeAttribute(name)
          else element.setAttribute(name, entry.previous)
        }
      }
      this.attributes.delete(element)
    }
    const styles = this.styles.get(element)
    if (styles !== undefined) {
      for (const [name, entry] of styles) {
        if (element.style.getPropertyValue(name) === entry.written) {
          if (entry.previous === '') element.style.removeProperty(name)
          else element.style.setProperty(name, entry.previous, entry.priority)
        }
      }
      this.styles.delete(element)
    }
  }

  restoreAll(): void {
    for (const element of new Set([...this.attributes.keys(), ...this.styles.keys()])) this.restore(element)
  }
}

interface MountedTurn {
  readonly owner: object
  readonly button: HTMLButtonElement
  plan?: TurnFoldPlan
  state?: FoldDomState
  bottom?: HTMLButtonElement
  appliedExpanded?: boolean
  animation?: FoldAnimationHandle
  mapping?: TurnElements
  needsReconcile?: true
  settleTimer?: ReturnType<typeof setTimeout>
  settleAttempt: number
  animationEpoch: number
  pending?: { readonly expanded: boolean; readonly animate: boolean }
  blocked: boolean
}

/** Bounded post-completion passes for hosts without MutationObserver. */
const LIVE_SETTLE_DELAYS = [0, 24, 80, 180, 360, 700, 1_200] as const

interface TurnElements {
  readonly flow: HTMLElement
  readonly start: HTMLElement
  readonly end: HTMLElement
  readonly closing: HTMLElement
  readonly rows: readonly HTMLElement[]
  readonly thinking: readonly HTMLElement[]
}

/**
 * DOM-only `chat-flow-v1` adapter.
 *
 * It changes only exact plugin-owned attributes and inline animation styles.
 * Native ChatNodeSeat nodes remain in their React-owned parent throughout.
 */
export class ChatFlowDomCoordinator implements FoldDomCoordinator {
  private readonly turns = new Map<number, MountedTurn>()
  private readonly owners = new Map<object, number>()
  private readonly topButtons = new Map<object, HTMLButtonElement>()
  private readonly bottomOwners = new Map<object, number>()
  private readonly bottomButtons = new Map<object, { readonly turn: number; readonly button: HTMLButtonElement }>()
  private readonly ledger = new OwnershipLedger()
  private readonly flowObservers = new Map<HTMLElement, MutationObserver>()
  private readonly scheduledFlows = new Set<HTMLElement>()
  private disabled = false
  private diagnosticWritten = false

  mountTop(owner: object, button: HTMLButtonElement): void {
    if (this.disabled) return
    this.topButtons.set(owner, button)
  }

  updateTop(owner: object, plan: TurnFoldPlan, state: FoldDomState): void {
    if (this.disabled || !plan.eligible) return
    const previousTurn = this.owners.get(owner)
    if (previousTurn !== undefined && Number.isFinite(previousTurn) && previousTurn !== plan.turn) {
      const old = this.turns.get(previousTurn)
      if (old !== undefined) this.restoreTurn(previousTurn, old)
      this.turns.delete(previousTurn)
    }
    let mounted = this.turns.get(plan.turn)
    if (mounted === undefined || mounted.owner !== owner) {
      const button = this.topButtons.get(owner)
      if (button === undefined) return
      mounted = { owner, button, animationEpoch: 0, settleAttempt: 0, blocked: false }
      this.turns.set(plan.turn, mounted)
    }
    this.owners.set(owner, plan.turn)
    for (const bottom of this.bottomButtons.values()) {
      if (bottom.turn === plan.turn) mounted.bottom = bottom.button
    }
    mounted.plan = plan
    mounted.state = state
    if (mounted.blocked) return
    this.reconcileTurn(plan.turn, mounted)
  }

  unmountTop(owner: object): void {
    const turn = this.owners.get(owner)
    this.owners.delete(owner)
    this.topButtons.delete(owner)
    if (turn === undefined) return
    const mounted = this.turns.get(turn)
    if (mounted === undefined || mounted.owner !== owner) return
    this.restoreTurn(turn, mounted)
    this.turns.delete(turn)
  }

  mountBottom(owner: object, turn: number, button: HTMLButtonElement): void {
    if (this.disabled) return
    this.bottomOwners.set(owner, turn)
    this.bottomButtons.set(owner, { turn, button })
    const mounted = this.turns.get(turn)
    if (mounted === undefined) return
    mounted.bottom = button
  }

  unmountBottom(owner: object): void {
    const turn = this.bottomOwners.get(owner)
    this.bottomOwners.delete(owner)
    this.bottomButtons.delete(owner)
    if (turn === undefined) return
    const mounted = this.turns.get(turn)
    if (mounted !== undefined) delete mounted.bottom
  }

  requestToggle(turn: number, expanded: boolean, trigger: HTMLButtonElement, animate: boolean): void {
    const mounted = this.turns.get(turn)
    if (mounted === undefined) return
    if (expanded && mounted.bottom === trigger) mounted.button.focus({ preventScroll: true })
    mounted.pending = { expanded: !expanded, animate }
  }

  dispose(): void {
    for (const [turn, mounted] of this.turns) this.restoreTurn(turn, mounted)
    for (const observer of this.flowObservers.values()) observer.disconnect()
    this.flowObservers.clear()
    this.scheduledFlows.clear()
    this.turns.clear()
    this.owners.clear()
    this.topButtons.clear()
    this.bottomOwners.clear()
    this.bottomButtons.clear()
    this.ledger.restoreAll()
  }

  private reconcileTurn(turn: number, mounted: MountedTurn): void {
    const plan = mounted.plan
    const state = mounted.state
    if (plan === undefined || state === undefined) return
    const probed = probeChatFlow(mounted.button, plan)
    if (!probed.ok) {
      if (probed.scope === 'view') this.disable(probed.reason)
      else {
        if (state.presentation === 'live') {
          this.scheduleLiveSettle(turn, mounted)
          this.watchFlowFor(mounted)
          return
        }
        mounted.blocked = true
        this.restoreTurn(turn, mounted)
      }
      return
    }
    const elements = elementsFor(probed.value, plan)
    if (elements === undefined || elements.thinking.length !== plan.closingReasoningCount) {
      if (state.presentation === 'live') {
        this.scheduleLiveSettle(turn, mounted)
        this.watchFlowFor(mounted)
        return
      }
      mounted.blocked = true
      this.restoreTurn(turn, mounted)
      return
    }
    const mappingChanged = !sameElements(mounted.mapping, elements)
    mounted.mapping = elements
    const desiredExpanded = state.expanded
    const firstApply = mounted.appliedExpanded === undefined
    const pending = mounted.pending
    delete mounted.pending
    // ChatView owns the same scrollport while it prepends history.  Leave
    // existing rows exactly as they were and let a newly mounted row fail open
    // until that transaction settles; the controller will mark it as a late,
    // default-expanded plan on the next stable snapshot.
    if (state.loadingOlder) {
      if (firstApply) {
        this.showStable(elements)
        mounted.appliedExpanded = true
      }
      return
    }
    if (state.presentation === 'live' && !desiredExpanded) this.scheduleLiveSettle(turn, mounted)
    else if (desiredExpanded) this.clearLiveSettle(mounted)
    if (!desiredExpanded) this.watchFlow(elements.flow)
    if (mounted.animation !== undefined) {
      if (mappingChanged) mounted.needsReconcile = true
      return
    }
    if (firstApply) {
      if (desiredExpanded) this.showStable(elements)
      else if (state.presentation === 'live' && !state.loadingOlder) this.animate(elements, mounted, false, true)
      else this.hideStable(elements, mounted.button)
      mounted.appliedExpanded = desiredExpanded
      return
    }
    if (mounted.appliedExpanded === desiredExpanded) {
      if (!mappingChanged) return
      if (desiredExpanded) this.showStable(elements)
      else this.hideStable(elements, mounted.button)
      return
    }
    mounted.appliedExpanded = desiredExpanded
    const animate = pending?.expanded === desiredExpanded && pending.animate && !state.loadingOlder
    if (animate) this.animate(elements, mounted, desiredExpanded, true)
    else if (desiredExpanded) this.showStable(elements)
    else this.hideStable(elements, mounted.button)
  }

  private animate(elements: TurnElements, mounted: MountedTurn, expanding: boolean, enabled: boolean): void {
    mounted.animation?.cancel()
    delete mounted.animation
    const epoch = mounted.animationEpoch + 1
    mounted.animationEpoch = epoch
    const anchorElement = expanding ? elements.start : elements.closing
    const anchor = captureScrollAnchor(elements.flow, anchorElement)
    const animated = [...elements.rows, ...elements.thinking]
    if (expanding) this.showStable(elements)
    if (!expanding) this.moveFocusOutOf(animated, mounted.button)
    const metrics = animated.map(element => ({
      element,
      height: Math.max(0, element.getBoundingClientRect().height),
      gap: element.parentElement === elements.flow ? flexGap(elements.flow) : 0,
    }))
    let finished = false
    const animation = runFoldAnimation({
      start: () => {
        for (const metric of metrics) {
          if (!expanding) this.hideA11y(metric.element)
          this.ledger.style(metric.element, 'overflow', 'hidden')
          this.ledger.style(metric.element, 'transition-property', 'height, opacity, margin-block-end')
          this.ledger.style(metric.element, 'transition-duration', '180ms, 160ms, 180ms')
          this.ledger.style(metric.element, 'transition-timing-function', 'cubic-bezier(0.16, 1, 0.3, 1)')
          this.ledger.style(metric.element, 'height', `${expanding ? 0 : metric.height}px`)
          this.ledger.style(metric.element, 'opacity', expanding ? '0' : '1')
          if (metric.gap > 0) this.ledger.style(metric.element, 'margin-block-end', expanding ? `${-metric.gap}px` : '0px')
        }
      },
      frame: () => {
        if (mounted.animationEpoch !== epoch) return
        for (const metric of metrics) {
          this.ledger.style(metric.element, 'height', `${expanding ? metric.height : 0}px`)
          this.ledger.style(metric.element, 'opacity', expanding ? '1' : '0')
          if (metric.gap > 0) this.ledger.style(metric.element, 'margin-block-end', expanding ? '0px' : `${-metric.gap}px`)
        }
        restoreScrollAnchor(anchor)
      },
      finish: () => {
        if (mounted.animationEpoch !== epoch) return
        finished = true
        delete mounted.animation
        if (expanding) this.showStable(elements)
        else this.hideStable(elements, mounted.button)
        restoreScrollAnchor(anchor)
        if (mounted.needsReconcile) {
          delete mounted.needsReconcile
          const activeTurn = mounted.plan?.turn
          if (activeTurn !== undefined && this.turns.get(activeTurn) === mounted) this.reconcileTurn(activeTurn, mounted)
        }
      },
    }, enabled)
    if (!finished) mounted.animation = animation
  }

  private hideStable(elements: TurnElements, button: HTMLButtonElement): void {
    this.moveFocusOutOf([...elements.rows, ...elements.thinking], button)
    for (const row of elements.rows) this.hideElement(row, 'data-dsh-fold-hidden')
    for (const think of elements.thinking) this.hideElement(think, 'data-dsh-fold-reasoning-hidden')
    this.hideElement(elements.end, 'data-dsh-fold-end-hidden')
  }

  private showStable(elements: TurnElements): void {
    for (const row of elements.rows) this.ledger.restore(row)
    for (const think of elements.thinking) this.ledger.restore(think)
    this.ledger.restore(elements.end)
  }

  private hideElement(element: HTMLElement, marker: string): void {
    this.ledger.attr(element, marker, '')
    this.hideA11y(element)
    this.ledger.style(element, 'display', 'none')
  }

  private hideA11y(element: HTMLElement): void {
    this.ledger.attr(element, 'inert', '')
    this.ledger.attr(element, 'aria-hidden', 'true')
  }

  private moveFocusOutOf(elements: readonly HTMLElement[], button: HTMLButtonElement): void {
    const focused = document.activeElement
    if (focused === null || !elements.some(element => element === focused || element.contains(focused))) return
    button.focus({ preventScroll: true })
  }

  private restoreTurn(_turn: number, mounted: MountedTurn): void {
    const mapped = mounted.mapping
    this.clearLiveSettle(mounted)
    mounted.animation?.cancel()
    delete mounted.animation
    delete mounted.mapping
    delete mounted.needsReconcile
    mounted.animationEpoch += 1
    if (mapped !== undefined) {
      for (const element of [...mapped.rows, ...mapped.thinking, mapped.end]) this.ledger.restore(element)
      return
    }
    const plan = mounted.plan
    if (plan !== undefined) {
      const probed = probeChatFlow(mounted.button, plan)
      if (probed.ok) {
        const elements = elementsFor(probed.value, plan)
        if (elements !== undefined) {
          for (const element of [...elements.rows, ...elements.thinking, elements.end]) this.ledger.restore(element)
        }
      }
    }
  }

  private disable(reason: string): void {
    if (this.disabled) return
    this.disabled = true
    this.dispose()
    if (!this.diagnosticWritten) {
      this.diagnosticWritten = true
      console.warn(`[dsh-fold-turns] ${CHAT_FLOW_ADAPTER} disabled: ${reason}`)
    }
  }

  /**
   * Keep a completed turn aligned with React's direct ChatNodeSeat commits.
   * The observer is intentionally scoped to the flow's direct children: it
   * catches row insertion/replacement without scanning on streamed text edits.
   */
  private watchFlowFor(mounted: MountedTurn): boolean {
    const flow = mounted.button.closest('[data-chat-flow]')
    if (!(flow instanceof HTMLElement)) return false
    return this.watchFlow(flow)
  }

  private watchFlow(flow: HTMLElement): boolean {
    if (this.flowObservers.has(flow)) return true
    const Observer = flow.ownerDocument.defaultView?.MutationObserver
    if (Observer === undefined) return false
    const observer = new Observer(() => { this.scheduleFlowReconcile(flow) })
    this.flowObservers.set(flow, observer)
    observer.observe(flow, { childList: true })
    return true
  }

  private scheduleFlowReconcile(flow: HTMLElement): void {
    if (this.scheduledFlows.has(flow)) return
    this.scheduledFlows.add(flow)
    queueMicrotask(() => {
      this.scheduledFlows.delete(flow)
      if (this.disabled) return
      for (const [turn, mounted] of this.turns) {
        const state = mounted.state
        if (mounted.blocked || state === undefined || state.expanded || state.loadingOlder) continue
        if (mounted.button.closest('[data-chat-flow]') !== flow) continue
        if (mounted.animation !== undefined) {
          mounted.needsReconcile = true
          continue
        }
        this.reconcileTurn(turn, mounted)
      }
    })
  }

  private scheduleLiveSettle(turn: number, mounted: MountedTurn): void {
    if (mounted.settleTimer !== undefined || mounted.settleAttempt >= LIVE_SETTLE_DELAYS.length) return
    const delay = LIVE_SETTLE_DELAYS[mounted.settleAttempt]
    mounted.settleAttempt += 1
    mounted.settleTimer = setTimeout(() => {
      delete mounted.settleTimer
      if (this.disabled || mounted.blocked || this.turns.get(turn) !== mounted) return
      this.reconcileTurn(turn, mounted)
      this.scheduleLiveSettle(turn, mounted)
    }, delay)
  }

  private clearLiveSettle(mounted: MountedTurn): void {
    if (mounted.settleTimer !== undefined) clearTimeout(mounted.settleTimer)
    delete mounted.settleTimer
    mounted.settleAttempt = LIVE_SETTLE_DELAYS.length
  }
}

function elementsFor(rows: ChatFlowRows, plan: TurnFoldPlan): TurnElements | undefined {
  if (plan.startCandidateKey === undefined || plan.endToggleKey === undefined || plan.closingKey === undefined) return undefined
  const start = rows.rows.get(plan.startCandidateKey)
  const end = rows.rows.get(plan.endToggleKey)
  const closing = rows.rows.get(plan.closingKey)
  const hidden = plan.hiddenKeys.map(key => rows.rows.get(key))
  if (start === undefined || end === undefined || closing === undefined || hidden.some(row => row === undefined)) return undefined
  return {
    flow: rows.flow,
    start,
    end,
    closing,
    rows: hidden as HTMLElement[],
    thinking: Array.from(closing.querySelectorAll<HTMLElement>('[data-variant="think"]')),
  }
}

function sameElements(left: TurnElements | undefined, right: TurnElements): boolean {
  return left !== undefined
    && left.flow === right.flow
    && left.start === right.start
    && left.end === right.end
    && left.closing === right.closing
    && sameElementList(left.rows, right.rows)
    && sameElementList(left.thinking, right.thinking)
}

function sameElementList(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index])
}

function flexGap(flow: HTMLElement): number {
  const gap = Number.parseFloat(getComputedStyle(flow).rowGap)
  return Number.isFinite(gap) ? gap : 0
}
