import {
  createSnapshotStore,
  type ChatConversationViewNode,
  type ChatSnapshot,
  type ConversationSnapshot,
  type ObservableSnapshot,
  type SessionFace,
  type TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  type FoldClosingDto,
  type FoldNodeDto,
  type FoldTurnDto,
  planTurnFold,
  type TurnFoldPlan,
} from './fold-core.ts'

/** How a newly eligible plan should enter the current Chat view. */
export type FoldPresentation = 'initial' | 'live' | 'late'

/** Session-scoped observable consumed by both toggle renderers. */
export interface FoldModel {
  readonly plans: ReadonlyMap<number, TurnFoldPlan>
  readonly byStartKey: ReadonlyMap<string, TurnFoldPlan>
  readonly byEndKey: ReadonlyMap<string, TurnFoldPlan>
  readonly presentationByTurn: ReadonlyMap<number, FoldPresentation>
  readonly defaultExpandedByTurn: ReadonlyMap<number, true>
  readonly loadingOlder: boolean
}

interface TurnRecord {
  readonly status: string
  readonly end: object | undefined
}

/**
 * Cheap structural evidence checked on every Session notification.
 *
 * DSH may update a location's turn-tail or closing node data without replacing
 * the top-level Chat order/timeline arrays. These references and primitive
 * summaries let us catch that finalization pass without scanning every node
 * for ordinary streamed text updates.
 */
interface TurnEvidence {
  readonly status: string
  readonly start: object | undefined
  readonly end: object | undefined
  readonly tail: unknown
  readonly tailFinalSeq: number | undefined
  readonly tailBranchUnavailable: boolean | undefined
  readonly nodeCount: number
  readonly firstKey: string | undefined
  readonly lastKey: string | undefined
  readonly closingKey: string | undefined
  readonly closingNode: ChatConversationViewNode | undefined
  readonly closingData: unknown
  readonly closingFinalSeq: number | undefined
  readonly closingReasoningCount: number | undefined
}

const EMPTY_MODEL: FoldModel = {
  plans: new Map(),
  byStartKey: new Map(),
  byEndKey: new Map(),
  presentationByTurn: new Map(),
  defaultExpandedByTurn: new Map(),
  loadingOlder: false,
}

/**
 * Project one SessionFace into stable, O(1)-addressable fold plans.
 *
 * It avoids scanning Chat nodes while a streamed block changes. The public
 * Chat order and Turn timeline references change only for structural updates,
 * so ordinary content updates return before inspecting a turn's node keys.
 */
export class FoldModelController implements ObservableSnapshot<FoldModel> {
  private readonly store = createSnapshotStore<FoldModel>(EMPTY_MODEL)
  private readonly unsubscribe: () => void
  private lastOrder: readonly string[] | undefined
  private lastTimeline: object | undefined
  private lastOpenState: unknown
  private lastLoadingOlder: boolean | undefined
  private plans = new Map<number, TurnFoldPlan>()
  private presentations = new Map<number, FoldPresentation>()
  private records = new Map<number, TurnRecord>()
  private evidence = new Map<number, TurnEvidence>()
  private readonly lateDefaults = new Map<number, boolean>()
  private disposed = false
  private initial = true
  /** Public only for focused controller tests. */
  recomputeCount = 0

  /** @param session - publicly exposed per-session snapshot source. */
  constructor(private readonly session: SessionFace) {
    this.reconcile()
    this.initial = false
    this.unsubscribe = session.subscribe(() => { this.reconcile() })
  }

  getSnapshot(): FoldModel {
    return this.store.getSnapshot()
  }

  subscribe(fn: () => void): () => void {
    return this.store.subscribe(fn)
  }

  /**
   * End the temporary default-expanded state used for a late-paginated turn.
   *
   * Once a user operates that turn, its normal store state becomes the sole
   * source of truth for the rest of the page lifetime.
   * @param turn - affected turn number.
   */
  acknowledgeLateDefault(turn: number): void {
    if (this.lateDefaults.get(turn) === false) return
    this.lateDefaults.set(turn, false)
    this.publish(this.plans, this.presentations, this.getSnapshot().loadingOlder)
  }

  /** Stop listening to the session and release model references. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.plans.clear()
    this.presentations.clear()
    this.records.clear()
    this.evidence.clear()
    this.lateDefaults.clear()
    this.store.set(EMPTY_MODEL)
  }

  private reconcile(): void {
    if (this.disposed) return
    const snapshot = this.session.getSnapshot()
    const chat = snapshot.chat
    const evidenceChanged = this.hasEvidenceChanged(chat)
    if (!this.initial
      && chat.order === this.lastOrder
      && chat.timeline === this.lastTimeline
      && snapshot.openState === this.lastOpenState
      && snapshot.loadingOlder === this.lastLoadingOlder
      && !evidenceChanged) return

    const pagingWasActive = this.lastLoadingOlder === true
    this.lastOrder = chat.order
    this.lastTimeline = chat.timeline
    this.lastOpenState = snapshot.openState
    this.lastLoadingOlder = snapshot.loadingOlder
    this.recomputeCount += 1

    const nextPlans = new Map<number, TurnFoldPlan>()
    const nextPresentations = new Map<number, FoldPresentation>()
    const nextRecords = new Map<number, TurnRecord>()
    const loadingOlder = snapshot.loadingOlder
    for (const turnNumber of chat.timeline.turnOrder) {
      const turn = chat.timeline.turns.get(turnNumber)
      if (turn === undefined) continue
      const plan = planTurnFold(projectTurn(chat, turn))
      nextPlans.set(turnNumber, plan)
      const record: TurnRecord = { status: turn.status, end: turn.end }
      nextRecords.set(turnNumber, record)
      if (!plan.eligible) continue
      nextPresentations.set(turnNumber, this.presentationFor(turnNumber, record, loadingOlder || pagingWasActive))
    }

    this.plans = nextPlans
    this.presentations = nextPresentations
    this.records = nextRecords
    this.evidence = this.collectEvidence(chat, nextPlans)
    this.publish(nextPlans, nextPresentations, loadingOlder)
  }

  private hasEvidenceChanged(chat: ChatSnapshot): boolean {
    let count = 0
    for (const turnNumber of chat.timeline.turnOrder) {
      const turn = chat.timeline.turns.get(turnNumber)
      if (turn === undefined) continue
      count += 1
      if (!sameEvidence(this.evidence.get(turnNumber), evidenceFor(chat, turn, this.plans.get(turnNumber)))) return true
    }
    return count !== this.evidence.size
  }

  private collectEvidence(chat: ChatSnapshot, plans: ReadonlyMap<number, TurnFoldPlan>): Map<number, TurnEvidence> {
    const evidence = new Map<number, TurnEvidence>()
    for (const turnNumber of chat.timeline.turnOrder) {
      const turn = chat.timeline.turns.get(turnNumber)
      if (turn !== undefined) evidence.set(turnNumber, evidenceFor(chat, turn, plans.get(turnNumber)))
    }
    return evidence
  }

  private presentationFor(turn: number, record: TurnRecord, loadingOlder: boolean): FoldPresentation {
    const previous = this.plans.get(turn)
    const previousPresentation = this.presentations.get(turn)
    if (previous?.eligible === true && previousPresentation !== undefined) return previousPresentation
    if (this.initial) return 'initial'
    const prior = this.records.get(turn)
    if (prior?.status === 'open' && record.status === 'closed' && !loadingOlder) return 'live'
    if (prior === undefined && !loadingOlder) return 'live'
    return 'late'
  }

  private publish(
    plans: ReadonlyMap<number, TurnFoldPlan>,
    presentations: ReadonlyMap<number, FoldPresentation>,
    loadingOlder: boolean,
  ): void {
    const byStartKey = new Map<string, TurnFoldPlan>()
    const byEndKey = new Map<string, TurnFoldPlan>()
    const defaultExpandedByTurn = new Map<number, true>()
    for (const [turn, plan] of plans) {
      if (!plan.eligible || plan.startCandidateKey === undefined || plan.endToggleKey === undefined) continue
      byStartKey.set(plan.startCandidateKey, plan)
      byEndKey.set(plan.endToggleKey, plan)
      if (presentations.get(turn) === 'late' && this.lateDefaults.get(turn) !== false) {
        defaultExpandedByTurn.set(turn, true)
      }
    }
    this.store.set({
      plans: new Map(plans),
      byStartKey,
      byEndKey,
      presentationByTurn: new Map(presentations),
      defaultExpandedByTurn,
      loadingOlder,
    })
  }
}

function evidenceFor(chat: ChatSnapshot, turn: TurnLocation, plan: TurnFoldPlan | undefined): TurnEvidence {
  const keys = chat.locations.getTurn(turn.turn)
  const tail = turn.data.get('turn-tail')
  const parsedTail = readTurnTail(tail)
  const closingKey = plan?.closingKey
  const closingNode = closingKey === undefined ? undefined : chat.nodes.get(closingKey)
  const closing = closingNode === undefined ? undefined : projectNode(closingNode)
  return {
    status: turn.status,
    start: turn.start,
    end: turn.end,
    tail,
    tailFinalSeq: parsedTail?.finalSeq,
    tailBranchUnavailable: parsedTail?.branchUnavailable,
    nodeCount: keys.length,
    firstKey: keys[0],
    lastKey: keys.at(-1),
    closingKey,
    closingNode,
    closingData: closingNode?.data,
    closingFinalSeq: closing?.finalSeq,
    closingReasoningCount: closing?.reasoningCount,
  }
}

function sameEvidence(left: TurnEvidence | undefined, right: TurnEvidence): boolean {
  return left !== undefined
    && left.status === right.status
    && left.start === right.start
    && left.end === right.end
    && left.tail === right.tail
    && left.tailFinalSeq === right.tailFinalSeq
    && left.tailBranchUnavailable === right.tailBranchUnavailable
    && left.nodeCount === right.nodeCount
    && left.firstKey === right.firstKey
    && left.lastKey === right.lastKey
    && left.closingKey === right.closingKey
    && left.closingNode === right.closingNode
    && left.closingData === right.closingData
    && left.closingFinalSeq === right.closingFinalSeq
    && left.closingReasoningCount === right.closingReasoningCount
}

/** Project only one turn's ordered nodes into FoldCore's host-neutral DTO. */
export function projectTurn(chat: ChatSnapshot, turn: TurnLocation): FoldTurnDto {
  const nodes = chat.locations.getTurn(turn.turn).map((key): FoldNodeDto => {
    const raw = chat.nodes.get(key)
    return raw === undefined ? {
      key,
      kind: '__missing-node__',
      anchorSeq: Number.NaN,
    } : projectNode(raw)
  })
  const tail = readTurnTail(turn.data.get('turn-tail'))
  const closing: FoldClosingDto | undefined = tail === undefined ? undefined : {
    finalSeq: tail.finalSeq,
    branchUnavailable: tail.branchUnavailable,
  }
  return {
    turn: turn.turn,
    status: turn.status,
    ...(turn.start === undefined ? {} : { startTime: turn.start.time }),
    ...(turn.end === undefined ? {} : { endTime: turn.end.time, endReason: turn.end.data.reason.kind }),
    nodes,
    ...(closing === undefined ? {} : { closing }),
  }
}

function projectNode(raw: ChatConversationViewNode): FoldNodeDto {
  const data = raw.data
  const base: FoldNodeDto = { key: raw.key, kind: raw.kind, anchorSeq: raw.anchorSeq }
  if (raw.kind === 'fold-start') {
    const sourceSeq = numberField(data, 'sourceSeq')
    return sourceSeq === undefined ? base : { ...base, sourceSeq }
  }
  if (raw.kind !== 'assistant-step') return base
  const finalSeq = nestedNumber(data, 'finalNode', 'seq')
  const blocks = objectField(data, 'blocks')
  const reasoningCount = Array.isArray(blocks)
    ? blocks.filter(block => stringField(block, 'kind') === 'reasoning').length
    : undefined
  return {
    ...base,
    ...(finalSeq === undefined ? {} : { finalSeq }),
    ...(reasoningCount === undefined ? {} : { reasoningCount }),
  }
}

function readTurnTail(value: unknown): { finalSeq: number; branchUnavailable: boolean } | undefined {
  const closing = objectField(value, 'closing')
  const finalSeq = nestedNumber(closing, 'finalNode', 'seq')
  const branchUnavailable = booleanField(value, 'branchUnavailable')
  if (finalSeq === undefined || branchUnavailable === undefined) return undefined
  return { finalSeq, branchUnavailable }
}

function objectField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'object' && candidate !== null ? candidate as Record<string, unknown> : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : undefined
}

function nestedNumber(value: unknown, parent: string, key: string): number | undefined {
  return numberField(objectField(value, parent), key)
}

function booleanField(value: unknown, key: string): boolean | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'boolean' ? candidate : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || !Object.hasOwn(value, key)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' ? candidate : undefined
}
