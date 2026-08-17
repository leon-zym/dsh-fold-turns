import {
  createSnapshotStore,
  type ChatConversationViewNode,
  type ChatSnapshot,
  type ObservableSnapshot,
  type SessionFace,
  type TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  planRunningTurnFold,
  planTurnFold,
  type RunningTurnFold,
  type TurnFoldPlan,
} from './fold-core.ts'
import { projectNode, projectTurn, readTurnTail } from './host/snapshot-projector.ts'

/** How a newly eligible plan should enter the current Chat view. */
export type FoldPresentation = 'initial' | 'live' | 'late'

/** Session-scoped observable consumed by both toggle renderers. */
export interface FoldModel {
  readonly plans: ReadonlyMap<number, TurnFoldPlan>
  readonly byStartKey: ReadonlyMap<string, TurnFoldPlan>
  readonly byEndKey: ReadonlyMap<string, TurnFoldPlan>
  readonly runningByStartKey: ReadonlyMap<string, RunningTurnFold>
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
 * summaries let us catch the two tail turns' finalization passes without
 * scanning every historical turn for ordinary streamed text updates.
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
  runningByStartKey: new Map(),
  presentationByTurn: new Map(),
  defaultExpandedByTurn: new Map(),
  loadingOlder: false,
}

/** Current live turn plus its immediately preceding, possibly settling turn. */
const EVIDENCE_TAIL_SIZE = 2

/**
 * Project one SessionFace into stable, O(1)-addressable fold plans.
 *
 * It limits same-structure notification checks to two tail turns. The public
 * Chat order and Turn timeline references still trigger a full structural
 * recompute when older history or node membership changes.
 */
export class FoldModelController implements ObservableSnapshot<FoldModel> {
  private readonly store = createSnapshotStore<FoldModel>(EMPTY_MODEL)
  private readonly unsubscribe: () => void
  private lastOrder: readonly string[] | undefined
  private lastTimeline: object | undefined
  private lastOpenState: unknown
  private lastLoadingOlder: boolean | undefined
  private plans = new Map<number, TurnFoldPlan>()
  private running = new Map<string, RunningTurnFold>()
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
    this.publish(this.plans, this.presentations, this.running, this.getSnapshot().loadingOlder)
  }

  /** Stop listening to the session and release model references. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribe()
    this.plans.clear()
    this.running.clear()
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
    const nextRunning = new Map<string, RunningTurnFold>()
    const nextPresentations = new Map<number, FoldPresentation>()
    const nextRecords = new Map<number, TurnRecord>()
    const loadingOlder = snapshot.loadingOlder
    for (const turnNumber of chat.timeline.turnOrder) {
      const turn = chat.timeline.turns.get(turnNumber)
      if (turn === undefined) continue
      const projectedTurn = projectTurn(chat, turn)
      const plan = planTurnFold(projectedTurn)
      nextPlans.set(turnNumber, plan)
      const running = planRunningTurnFold(projectedTurn)
      if (running !== undefined) nextRunning.set(running.startCandidateKey, running)
      const record: TurnRecord = { status: turn.status, end: turn.end }
      nextRecords.set(turnNumber, record)
      if (!plan.eligible) continue
      nextPresentations.set(turnNumber, this.presentationFor(turnNumber, record, loadingOlder || pagingWasActive))
    }

    this.plans = nextPlans
    this.running = nextRunning
    this.presentations = nextPresentations
    this.records = nextRecords
    this.evidence = collectEvidence(chat, nextPlans)
    this.publish(nextPlans, nextPresentations, nextRunning, loadingOlder)
  }

  private hasEvidenceChanged(chat: ChatSnapshot): boolean {
    const turnNumbers = evidenceTurnNumbers(chat)
    if (turnNumbers.length !== this.evidence.size) return true
    for (const turnNumber of turnNumbers) {
      const turn = chat.timeline.turns.get(turnNumber)
      if (turn === undefined) return true
      if (!sameEvidence(this.evidence.get(turnNumber), evidenceFor(chat, turn, this.plans.get(turnNumber)))) return true
    }
    return false
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
    running: ReadonlyMap<string, RunningTurnFold>,
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
      runningByStartKey: new Map(running),
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
  const closingKey = plan?.closingKey ?? closingKeyFor(chat, keys, parsedTail?.finalSeq)
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

function collectEvidence(
  chat: ChatSnapshot,
  plans: ReadonlyMap<number, TurnFoldPlan>,
): Map<number, TurnEvidence> {
  const evidence = new Map<number, TurnEvidence>()
  for (const turnNumber of evidenceTurnNumbers(chat)) {
    const turn = chat.timeline.turns.get(turnNumber)
    if (turn !== undefined) evidence.set(turnNumber, evidenceFor(chat, turn, plans.get(turnNumber)))
  }
  return evidence
}

function evidenceTurnNumbers(chat: ChatSnapshot): readonly number[] {
  return chat.timeline.turnOrder.slice(-EVIDENCE_TAIL_SIZE)
}

function closingKeyFor(chat: ChatSnapshot, keys: readonly string[], finalSeq: number | undefined): string | undefined {
  if (finalSeq === undefined) return undefined
  const candidates = keys.filter((key) => {
    const node = chat.nodes.get(key)
    if (node === undefined || node.kind !== 'assistant-step') return false
    return projectNode(node).finalSeq === finalSeq
  })
  return candidates.length === 1 ? candidates[0] : undefined
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
