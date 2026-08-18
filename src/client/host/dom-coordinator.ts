import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnFoldPlan } from '../fold-core.ts'
import { CHAT_FLOW_ADAPTER } from '../../invariant.ts'
import { probeChatFlow, type ChatFlowRows } from './chat-flow-v1.ts'
import type { FoldDomCapability, FoldDomCoordinator, FoldDomModel, FoldDomState } from './contract.ts'
import { captureScrollAnchor, restoreScrollAnchor, type ScrollAnchor } from './scroll.ts'

interface AttributeEntry {
  readonly previous: string | null
  written: string | null
}

interface StyleEntry {
  readonly previous: string
  readonly priority: string
  written: string
  writtenPriority: string
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
        writtenPriority: '',
      }
      entries.set(name, entry)
    } else {
      entry.written = value ?? ''
      entry.writtenPriority = ''
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
        if (element.style.getPropertyValue(name) === entry.written
          && element.style.getPropertyPriority(name) === entry.writtenPriority) {
          if (entry.previous === '') element.style.removeProperty(name)
          else element.style.setProperty(name, entry.previous, entry.priority)
        }
      }
      this.styles.delete(element)
    }
  }

  /** Restore one plugin-owned inline style without disturbing other writes. */
  restoreStyle(element: HTMLElement, name: string): void {
    const entries = this.styles.get(element)
    const entry = entries?.get(name)
    if (entry === undefined || entries === undefined) return
    if (element.style.getPropertyValue(name) === entry.written
      && element.style.getPropertyPriority(name) === entry.writtenPriority) {
      if (entry.previous === '') element.style.removeProperty(name)
      else element.style.setProperty(name, entry.previous, entry.priority)
    }
    entries.delete(name)
    if (entries.size === 0) this.styles.delete(element)
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
  mapping?: TurnElements
  layoutObserver?: ResizeObserver
  pending?: { readonly anchor: ToggleAnchor; readonly scrollAnchor?: ScrollAnchor }
  blocked: boolean
}

type ToggleAnchor = 'top' | 'bottom'

interface TurnElements {
  readonly flow: HTMLElement
  readonly start: HTMLElement
  readonly end: HTMLElement
  readonly closing: HTMLElement
  readonly lowerAnchor?: HTMLElement
  readonly rows: readonly HTMLElement[]
  readonly thinking: readonly HTMLElement[]
}

interface ClosingLayout {
  readonly thinking: readonly HTMLElement[]
  readonly lowerAnchor: HTMLElement
}

/**
 * DOM-only `chat-flow-v1` adapter.
 *
 * It changes only exact plugin-owned attributes plus inline visibility and
 * positioning styles.
 * Native ChatNodeSeat nodes remain in their React-owned parent throughout.
 */
export class ChatFlowDomCoordinator implements FoldDomCoordinator {
  private readonly capabilityStore = createSnapshotStore<FoldDomModel>({ byTurn: new Map() })
  private readonly turns = new Map<number, MountedTurn>()
  private readonly owners = new Map<object, number>()
  private readonly topButtons = new Map<object, HTMLButtonElement>()
  private readonly bottomOwners = new Map<object, number>()
  private readonly bottomButtons = new Map<object, { readonly turn: number; readonly button: HTMLButtonElement }>()
  private readonly ledger = new OwnershipLedger()
  private readonly flowObservers = new Map<HTMLElement, MutationObserver>()
  private readonly scheduledFlows = new Set<HTMLElement>()
  private disabled = false
  private disposed = false
  private diagnosticWritten = false

  getSnapshot(): FoldDomModel {
    return this.capabilityStore.getSnapshot()
  }

  subscribe(fn: () => void): () => void {
    return this.capabilityStore.subscribe(fn)
  }

  mountTop(owner: object, button: HTMLButtonElement): void {
    if (this.disposed) return
    this.topButtons.set(owner, button)
  }

  updateTop(owner: object, plan: TurnFoldPlan, state: FoldDomState): void {
    if (this.disposed || !plan.eligible) return
    if (this.disabled) {
      if (!this.topButtons.has(owner)) return
      const previousTurn = this.owners.get(owner)
      this.owners.set(owner, plan.turn)
      if (previousTurn !== undefined && previousTurn !== plan.turn) this.removeCapabilityIfUnowned(previousTurn)
      this.setCapability(plan.turn, 'blocked')
      return
    }
    const previousTurn = this.owners.get(owner)
    if (previousTurn !== undefined && Number.isFinite(previousTurn) && previousTurn !== plan.turn) {
      const old = this.turns.get(previousTurn)
      if (old !== undefined) this.restoreTurn(previousTurn, old)
      this.turns.delete(previousTurn)
      this.removeCapability(previousTurn)
      this.pruneFlowObservers()
    }
    let mounted = this.turns.get(plan.turn)
    if (mounted === undefined || mounted.owner !== owner) {
      const button = this.topButtons.get(owner)
      if (button === undefined) return
      mounted = { owner, button, blocked: false }
      this.turns.set(plan.turn, mounted)
      this.setCapability(plan.turn, 'checking')
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
    if (mounted === undefined) {
      this.removeCapabilityIfUnowned(turn)
      return
    }
    if (mounted.owner !== owner) return
    this.restoreTurn(turn, mounted)
    this.turns.delete(turn)
    this.removeCapability(turn)
    this.pruneFlowObservers()
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

  requestToggle(turn: number, expanded: boolean, trigger: HTMLButtonElement): void {
    const mounted = this.turns.get(turn)
    if (mounted === undefined) return
    const anchor: ToggleAnchor = mounted.bottom === trigger ? 'bottom' : 'top'
    if (expanded && anchor === 'bottom') mounted.button.focus({ preventScroll: true })
    const elements = mounted.mapping
    const scrollAnchor = elements === undefined ? undefined : captureScrollAnchor(elements.flow, this.anchorElement(elements, anchor))
    mounted.pending = scrollAnchor === undefined ? { anchor } : { anchor, scrollAnchor }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.disabled = true
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
    this.capabilityStore.set({ byTurn: new Map() })
  }

  private reconcileTurn(turn: number, mounted: MountedTurn): void {
    const plan = mounted.plan
    const state = mounted.state
    if (plan === undefined || state === undefined) return
    const probed = probeChatFlow(mounted.button, plan)
    if (!probed.ok) {
      if (probed.scope === 'view') this.disable(probed.reason)
      else if (this.shouldWaitForHost(turn, mounted, state)) this.waitForHost(turn, mounted)
      else this.blockTurn(turn, mounted)
      return
    }
    const elements = elementsFor(probed.value, plan)
    if (elements === undefined || elements.thinking.length !== plan.closingReasoningCount) {
      if (this.shouldWaitForHost(turn, mounted, state)) this.waitForHost(turn, mounted)
      else this.blockTurn(turn, mounted)
      return
    }
    const mappingChanged = !sameElements(mounted.mapping, elements)
    if (mappingChanged && mounted.mapping !== undefined) {
      this.clearClosingLayout(mounted, mounted.mapping)
      this.restoreElements(mounted.mapping)
    }
    mounted.mapping = elements
    const desiredExpanded = state.expanded
    const firstApply = mounted.appliedExpanded === undefined
    const pending = mounted.pending
    delete mounted.pending
    const anchor = pending?.anchor ?? 'top'
    const scrollAnchor = pending?.scrollAnchor
    // ChatView owns the same scrollport while it prepends history.  Leave
    // existing rows exactly as they were and let a newly mounted row fail open
    // until that transaction settles; the controller will mark it as a late,
    // default-expanded plan on the next stable snapshot.
    if (state.loadingOlder) {
      if (firstApply) {
        this.showStable(turn, elements, mounted)
        mounted.appliedExpanded = true
      }
      this.setCapability(turn, 'available')
      this.pruneFlowObservers()
      return
    }
    if (!desiredExpanded && !this.watchFlow(elements.flow)) {
      this.blockTurn(turn, mounted)
      return
    }
    if (firstApply) {
      if (desiredExpanded) this.showStable(turn, elements, mounted)
      else this.collapseStable(elements, mounted, mounted.button, anchor, scrollAnchor)
      mounted.appliedExpanded = desiredExpanded
      this.setCapability(turn, 'available')
      this.pruneFlowObservers()
      return
    }
    if (mounted.appliedExpanded === desiredExpanded) {
      if (mappingChanged) {
        if (desiredExpanded) this.showStable(turn, elements, mounted)
        else this.collapseStable(elements, mounted, mounted.button, anchor, scrollAnchor)
      }
      this.setCapability(turn, 'available')
      this.pruneFlowObservers()
      return
    }
    mounted.appliedExpanded = desiredExpanded
    if (desiredExpanded) this.expandStable(turn, elements, mounted, anchor, scrollAnchor)
    else this.collapseStable(elements, mounted, mounted.button, anchor, scrollAnchor)
    this.setCapability(turn, 'available')
    this.pruneFlowObservers()
  }

  /** Preserve the clicked edge while removing all collapsed content at once. */
  private collapseStable(
    elements: TurnElements,
    mounted: MountedTurn,
    button: HTMLButtonElement,
    edge: ToggleAnchor,
    priorAnchor: ScrollAnchor | undefined,
  ): void {
    this.clearClosingLayout(mounted, elements)
    const scrollAnchor = priorAnchor ?? captureScrollAnchor(elements.flow, this.anchorElement(elements, edge))
    this.hideStable(elements, button)
    restoreScrollAnchor(scrollAnchor)
  }

  /** Expansion is only reachable from the top row, but is safe for either edge. */
  private expandStable(
    turn: number,
    elements: TurnElements,
    mounted: MountedTurn,
    edge: ToggleAnchor,
    priorAnchor: ScrollAnchor | undefined,
  ): void {
    const anchor = priorAnchor ?? captureScrollAnchor(elements.flow, this.anchorElement(elements, edge))
    this.showStable(turn, elements, mounted)
    restoreScrollAnchor(anchor)
  }

  private anchorElement(elements: TurnElements, edge: ToggleAnchor): HTMLElement {
    return edge === 'bottom' ? elements.lowerAnchor ?? elements.closing : elements.start
  }

  private hideStable(elements: TurnElements, button: HTMLButtonElement): void {
    this.moveFocusOutOf([...elements.rows, ...elements.thinking], button)
    for (const row of elements.rows) this.hideElement(row, 'data-dsh-fold-hidden')
    for (const think of elements.thinking) this.hideElement(think, 'data-dsh-fold-reasoning-hidden')
    this.hideElement(elements.end, 'data-dsh-fold-end-hidden')
  }

  private showStable(turn: number, elements: TurnElements, mounted: MountedTurn): void {
    this.clearClosingLayout(mounted, elements)
    for (const row of elements.rows) this.ledger.restore(row)
    for (const think of elements.thinking) this.ledger.restore(think)
    this.ledger.restore(elements.end)
    this.arrangeClosing(elements)
    this.watchClosingLayout(turn, mounted, elements)
  }

  /** Swap the visual slots of the lower row and closing Think without reparenting. */
  private arrangeClosing(elements: TurnElements): void {
    const layout = closingLayoutFor(elements)
    if (layout === undefined) return
    const endHeight = Math.max(0, elements.end.getBoundingClientRect().height)
    const first = layout.thinking[0]
    const last = layout.thinking.at(-1)
    if (first === undefined || last === undefined) return
    const thinkingHeight = Math.max(0, last.getBoundingClientRect().bottom - first.getBoundingClientRect().top)
    const flowGap = rowGap(elements.flow)
    const bodyGap = rowGap(first.parentElement)
    const thinkOffset = -(endHeight + flowGap)
    const endOffset = thinkingHeight + bodyGap
    for (const think of layout.thinking) this.ledger.style(think, 'transform', `translateY(${thinkOffset}px)`)
    this.ledger.style(elements.end, 'transform', `translateY(${endOffset}px)`)
  }

  private watchClosingLayout(turn: number, mounted: MountedTurn, elements: TurnElements): void {
    const layout = closingLayoutFor(elements)
    const Observer = elements.flow.ownerDocument.defaultView?.ResizeObserver
    if (layout === undefined || Observer === undefined) return
    mounted.layoutObserver?.disconnect()
    const observer = new Observer(() => {
      const state = mounted.state
      if (this.disabled || this.turns.get(turn) !== mounted || mounted.mapping !== elements
        || state?.expanded !== true || state.loadingOlder) return
      this.arrangeClosing(elements)
    })
    mounted.layoutObserver = observer
    observer.observe(elements.end)
    for (const think of layout.thinking) observer.observe(think)
  }

  private clearClosingLayout(mounted: MountedTurn, elements: TurnElements | undefined): void {
    mounted.layoutObserver?.disconnect()
    delete mounted.layoutObserver
    if (elements === undefined) return
    this.ledger.restoreStyle(elements.end, 'transform')
    for (const think of elements.thinking) this.ledger.restoreStyle(think, 'transform')
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
    const focused = button.ownerDocument.activeElement
    if (focused === null || !elements.some(element => element === focused || element.contains(focused))) return
    button.focus({ preventScroll: true })
  }

  private restoreTurn(_turn: number, mounted: MountedTurn): void {
    const mapped = mounted.mapping
    this.clearClosingLayout(mounted, mapped)
    delete mounted.mapping
    if (mapped !== undefined) this.restoreElements(mapped)
  }

  private disable(reason: string): void {
    if (this.disabled) return
    this.disabled = true
    const capabilities = new Map(this.getSnapshot().byTurn)
    for (const [turn, mounted] of this.turns) {
      capabilities.set(turn, 'blocked')
      this.restoreTurn(turn, mounted)
    }
    this.capabilityStore.set({ byTurn: capabilities })
    for (const observer of this.flowObservers.values()) observer.disconnect()
    this.flowObservers.clear()
    this.scheduledFlows.clear()
    this.turns.clear()
    this.bottomOwners.clear()
    this.bottomButtons.clear()
    this.ledger.restoreAll()
    if (!this.diagnosticWritten) {
      this.diagnosticWritten = true
      console.warn(`[dsh-fold-turns] ${CHAT_FLOW_ADAPTER} disabled: ${reason}`)
    }
  }

  /**
   * Keep a completed turn aligned with React's direct ChatNodeSeat commits.
   * Direct child mutations always reconcile row ownership. While a turn is
   * checking, subtree child commits also reconcile late native Think content.
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
    const observer = new Observer((records) => {
      if (records.some(record => record.target === flow) || this.hasCheckingTurn(flow)) {
        this.scheduleFlowReconcile(flow)
      }
    })
    this.flowObservers.set(flow, observer)
    observer.observe(flow, { childList: true, subtree: true })
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
        this.reconcileTurn(turn, mounted)
      }
    })
  }

  private waitForHost(turn: number, mounted: MountedTurn): void {
    this.restoreTurn(turn, mounted)
    this.setCapability(turn, 'checking')
    if (!this.watchFlowFor(mounted)) this.blockTurn(turn, mounted)
  }

  private shouldWaitForHost(turn: number, mounted: MountedTurn, state: FoldDomState): boolean {
    return state.presentation === 'live'
      || mounted.mapping !== undefined
      || (mounted.appliedExpanded !== undefined && this.getSnapshot().byTurn.get(turn) === 'checking')
  }

  private blockTurn(turn: number, mounted: MountedTurn): void {
    mounted.blocked = true
    this.restoreTurn(turn, mounted)
    this.setCapability(turn, 'blocked')
    this.pruneFlowObservers()
  }

  private restoreElements(elements: TurnElements): void {
    for (const element of [...elements.rows, ...elements.thinking, elements.end]) this.ledger.restore(element)
  }

  private setCapability(turn: number, capability: FoldDomCapability): void {
    const current = this.getSnapshot().byTurn
    if (current.get(turn) === capability) return
    const byTurn = new Map(current)
    byTurn.set(turn, capability)
    this.capabilityStore.set({ byTurn })
  }

  private removeCapability(turn: number): void {
    const current = this.getSnapshot().byTurn
    if (!current.has(turn)) return
    const byTurn = new Map(current)
    byTurn.delete(turn)
    this.capabilityStore.set({ byTurn })
  }

  private removeCapabilityIfUnowned(turn: number): void {
    for (const ownedTurn of this.owners.values()) {
      if (ownedTurn === turn) return
    }
    this.removeCapability(turn)
  }

  private hasCheckingTurn(flow: HTMLElement): boolean {
    for (const [turn, mounted] of this.turns) {
      if (this.getSnapshot().byTurn.get(turn) !== 'checking') continue
      if (mounted.button.closest('[data-chat-flow]') === flow) return true
    }
    return false
  }

  private pruneFlowObservers(): void {
    const needed = new Set<HTMLElement>()
    for (const mounted of this.turns.values()) {
      if (mounted.blocked || mounted.state?.expanded !== false) continue
      const flow = mounted.button.closest('[data-chat-flow]')
      if (flow instanceof HTMLElement) needed.add(flow)
    }
    for (const [flow, observer] of this.flowObservers) {
      if (needed.has(flow)) continue
      observer.disconnect()
      this.flowObservers.delete(flow)
      this.scheduledFlows.delete(flow)
    }
  }
}

function elementsFor(rows: ChatFlowRows, plan: TurnFoldPlan): TurnElements | undefined {
  if (plan.startCandidateKey === undefined || plan.endToggleKey === undefined || plan.closingKey === undefined) return undefined
  const start = rows.rows.get(plan.startCandidateKey)
  const end = rows.rows.get(plan.endToggleKey)
  const closing = rows.rows.get(plan.closingKey)
  const hidden = plan.hiddenKeys.map(key => rows.rows.get(key))
  if (start === undefined || end === undefined || closing === undefined || hidden.some(row => row === undefined)) return undefined
  const thinking = Array.from(closing.querySelectorAll<HTMLElement>('[data-variant="think"]'))
  const provisional: TurnElements = { flow: rows.flow, start, end, closing, rows: hidden as HTMLElement[], thinking }
  const lowerAnchor = closingLayoutFor(provisional)?.lowerAnchor
  return {
    flow: rows.flow,
    start,
    end,
    closing,
    rows: hidden as HTMLElement[],
    thinking,
    ...(lowerAnchor === undefined ? {} : { lowerAnchor }),
  }
}

/** Return a splittable closing layout only when Think is the leading content. */
function closingLayoutFor(elements: TurnElements): ClosingLayout | undefined {
  const first = elements.thinking[0]
  const parent = first?.parentElement
  if (first === undefined || parent === null || parent === undefined) return undefined
  const children = Array.from(parent.children).filter((child): child is HTMLElement => child instanceof HTMLElement)
  if (children.length <= elements.thinking.length) return undefined
  const leadingThinking = children.slice(0, elements.thinking.length)
  if (!leadingThinking.every((child, index) => child === elements.thinking[index])) return undefined
  const lowerAnchor = children[elements.thinking.length]
  if (lowerAnchor === undefined) return undefined
  return { thinking: leadingThinking, lowerAnchor }
}

function rowGap(element: Element | null): number {
  if (!(element instanceof HTMLElement)) return 0
  const gap = Number.parseFloat(getComputedStyle(element).rowGap || element.style.rowGap)
  return Number.isFinite(gap) ? gap : 0
}

function sameElements(left: TurnElements | undefined, right: TurnElements): boolean {
  return left !== undefined
    && left.flow === right.flow
    && left.start === right.start
    && left.end === right.end
    && left.closing === right.closing
    && left.lowerAnchor === right.lowerAnchor
    && sameElementList(left.rows, right.rows)
    && sameElementList(left.thinking, right.thinking)
}

function sameElementList(left: readonly HTMLElement[], right: readonly HTMLElement[]): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index])
}
