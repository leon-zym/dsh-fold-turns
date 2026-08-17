/**
 * Pure completed-turn folding rules.
 *
 * This module receives only normalized turn facts. It never reads a DOM node,
 * Session object, or renderer implementation, so compatibility changes stay
 * inside the DSH adapter.
 */

export type FoldFailureReason =
  | 'turn-not-closed'
  | 'turn-not-completed'
  | 'missing-boundary'
  | 'invalid-duration'
  | 'missing-closing'
  | 'branch-unavailable'
  | 'missing-closing-node'
  | 'ambiguous-closing-node'
  | 'invalid-closing'
  | 'missing-human-input'
  | 'missing-fold-start'
  | 'ambiguous-fold-start'
  | 'missing-fold-end'
  | 'ambiguous-fold-end'
  | 'invalid-order'
  | 'process-outside-boundary'
  | 'unknown-node-kind'
  | 'no-collapsible-content'

/** One host-normalized Chat node. */
export interface FoldNodeDto {
  readonly key: string
  readonly kind: string
  readonly anchorSeq: number
  /** Raw user-event seq saved by a fold-start candidate. */
  readonly sourceSeq?: number
  /** Final assistant-message seq saved by an assistant-step node. */
  readonly finalSeq?: number
  /** Number of rendered reasoning blocks in the closing assistant. */
  readonly reasoningCount?: number
}

/** Host-normalized closing-assistant evidence. */
export interface FoldClosingDto {
  readonly finalSeq: number
  readonly branchUnavailable: boolean
}

/** All facts FoldCore needs for one Turn. */
export interface FoldTurnDto {
  readonly turn: number
  readonly status: string
  readonly startTime?: number
  readonly endTime?: number
  readonly endReason?: string
  readonly nodes: readonly FoldNodeDto[]
  readonly closing?: FoldClosingDto
}

/** JSON-compatible plan consumed by renderers and the DOM adapter. */
export interface TurnFoldPlan {
  readonly turn: number
  readonly eligible: boolean
  readonly reason?: FoldFailureReason
  /** Latest normal user input, with a steering input used only as fallback. */
  readonly startInputKey?: string
  readonly startCandidateKey?: string
  readonly closingKey?: string
  readonly endToggleKey?: string
  readonly tailKey?: string
  readonly hiddenKeys: readonly string[]
  readonly closingReasoningCount: number
  readonly durationMs?: number
}

/** Live status for an open turn whose source message already has a top row. */
export interface RunningTurnFold {
  readonly turn: number
  readonly startCandidateKey: string
  readonly startedAt: number
}

type NodeDisposition = 'before-start' | 'start' | 'end' | 'closing' | 'tail' | 'visible' | 'hidden' | 'invalid'

const EMPTY_KEYS: readonly string[] = []

function fail(turn: number, reason: FoldFailureReason): TurnFoldPlan {
  return {
    turn,
    eligible: false,
    reason,
    hiddenKeys: EMPTY_KEYS,
    closingReasoningCount: 0,
  }
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nodeIndex(nodes: readonly FoldNodeDto[], key: string): number {
  return nodes.findIndex(node => node.key === key)
}

function once(nodes: readonly FoldNodeDto[]): FoldNodeDto | undefined {
  return nodes.length === 1 ? nodes[0] : undefined
}

/**
 * Compute the foldable portion of one normalized Turn.
 *
 * @param turn - immutable host projection for one turn.
 * @returns an eligible folding plan or a precise fail-open reason.
 */
export function planTurnFold(turn: FoldTurnDto): TurnFoldPlan {
  if (turn.status !== 'closed') return fail(turn.turn, 'turn-not-closed')
  if (turn.endReason !== 'completed') return fail(turn.turn, 'turn-not-completed')
  if (!finite(turn.startTime) || !finite(turn.endTime)) return fail(turn.turn, 'missing-boundary')
  const durationMs = turn.endTime - turn.startTime
  if (!Number.isFinite(durationMs) || durationMs < 0) return fail(turn.turn, 'invalid-duration')

  const closing = turn.closing
  if (closing === undefined) return fail(turn.turn, 'missing-closing')
  if (closing.branchUnavailable) return fail(turn.turn, 'branch-unavailable')
  if (!finite(closing.finalSeq)) return fail(turn.turn, 'invalid-closing')

  const humanStart = latestHumanStart(turn.nodes)
  if (humanStart === 'missing-human-input') return fail(turn.turn, humanStart)
  if (humanStart === 'missing-fold-start' || humanStart === 'ambiguous-fold-start') return fail(turn.turn, humanStart)
  const { input: startInput, candidate: startCandidate } = humanStart

  const closingCandidates = turn.nodes.filter(node => node.kind === 'assistant-step' && node.finalSeq === closing.finalSeq)
  if (closingCandidates.length === 0) return fail(turn.turn, 'missing-closing-node')
  if (closingCandidates.length !== 1) return fail(turn.turn, 'ambiguous-closing-node')
  const closingNode = closingCandidates[0]
  if (closingNode === undefined) return fail(turn.turn, 'missing-closing-node')
  if (closingNode.reasoningCount === undefined || !Number.isSafeInteger(closingNode.reasoningCount) || closingNode.reasoningCount < 0) {
    return fail(turn.turn, 'invalid-closing')
  }

  const endCandidates = turn.nodes.filter(node => node.kind === 'fold-end')
  if (endCandidates.length === 0) return fail(turn.turn, 'missing-fold-end')
  if (endCandidates.length !== 1) return fail(turn.turn, 'ambiguous-fold-end')
  const endCandidate = endCandidates[0]
  if (endCandidate === undefined) return fail(turn.turn, 'missing-fold-end')

  const startInputAt = nodeIndex(turn.nodes, startInput.key)
  const startAt = nodeIndex(turn.nodes, startCandidate.key)
  const endAt = nodeIndex(turn.nodes, endCandidate.key)
  const closingAt = nodeIndex(turn.nodes, closingNode.key)
  if (startInputAt < 0 || startAt < 0 || endAt < 0 || closingAt < 0 || !(startInputAt < startAt && startAt < closingAt && closingAt < endAt)) {
    return fail(turn.turn, 'invalid-order')
  }

  const dispositions = new Map<string, NodeDisposition>()
  for (let index = 0; index < turn.nodes.length; index += 1) {
    const node = turn.nodes[index]
    if (node === undefined) return fail(turn.turn, 'unknown-node-kind')
    if (index <= startInputAt) {
      if (!knownBeforeStart(node.kind)) return fail(turn.turn, 'unknown-node-kind')
      dispositions.set(node.key, 'before-start')
      continue
    }
    if (node.key === startCandidate.key) {
      dispositions.set(node.key, 'start')
      continue
    }
    if (node.key === endCandidate.key) {
      dispositions.set(node.key, 'end')
      continue
    }
    if (node.key === closingNode.key) {
      dispositions.set(node.key, 'closing')
      continue
    }
    if (node.kind === 'turn-tail') {
      if (index <= endAt) return fail(turn.turn, 'invalid-order')
      dispositions.set(node.key, 'tail')
      continue
    }

    const disposition = classifyNode(node.kind, index, startInputAt, closingAt)
    if (disposition === 'invalid') return fail(turn.turn, 'unknown-node-kind')
    if (disposition === 'hidden' && !(index > startAt && index < closingAt)) {
      return fail(turn.turn, 'process-outside-boundary')
    }
    if (disposition === 'visible' && index > closingAt && index < endAt) {
      return fail(turn.turn, 'invalid-order')
    }
    dispositions.set(node.key, disposition)
  }

  const hiddenKeys = turn.nodes
    .filter(node => dispositions.get(node.key) === 'hidden')
    .map(node => node.key)
  if (hiddenKeys.length === 0 && closingNode.reasoningCount === 0) return fail(turn.turn, 'no-collapsible-content')

  const tail = once(turn.nodes.filter(node => node.kind === 'turn-tail'))
  return {
    turn: turn.turn,
    eligible: true,
    startInputKey: startInput.key,
    startCandidateKey: startCandidate.key,
    closingKey: closingNode.key,
    endToggleKey: endCandidate.key,
    ...(tail === undefined ? {} : { tailKey: tail.key }),
    hiddenKeys,
    closingReasoningCount: closingNode.reasoningCount,
    durationMs,
  }
}

/**
 * Identify an open turn whose source message can immediately show a status
 * row. A matching fold-start candidate is required so unrelated steering
 * context never produces a control.
 */
export function planRunningTurnFold(turn: FoldTurnDto): RunningTurnFold | undefined {
  if (turn.status !== 'open' || !finite(turn.startTime)) return undefined
  const humanStart = latestHumanStart(turn.nodes)
  if (typeof humanStart === 'string') return undefined
  return {
    turn: turn.turn,
    startCandidateKey: humanStart.candidate.key,
    startedAt: turn.startTime,
  }
}

type HumanStartResult = { readonly input: FoldNodeDto; readonly candidate: FoldNodeDto }
  | 'missing-human-input'
  | 'missing-fold-start'
  | 'ambiguous-fold-start'

/**
 * Prefer the latest regular user node that owns a start row. If a turn has no
 * regular user node because DSH classified its human message as `steering`,
 * use the latest matching steering node instead. Other steering stays visible
 * inside the turn rather than redefining the fold boundary.
 */
function latestHumanStart(nodes: readonly FoldNodeDto[]): HumanStartResult {
  const humanInputs = nodes.filter(node => (node.kind === 'user' || node.kind === 'steering') && finite(node.anchorSeq))
  if (humanInputs.length === 0) return 'missing-human-input'
  const latestOf = (inputs: readonly FoldNodeDto[]) => [...inputs]
    .sort((left, right) => left.anchorSeq - right.anchorSeq)
    .at(-1)
  const users = humanInputs.filter(input => input.kind === 'user')
  const input = latestOf(users) ?? latestOf(humanInputs.filter(candidate => candidate.kind === 'steering'
    && nodes.some(node => node.kind === 'fold-start' && node.sourceSeq === candidate.anchorSeq)))
  if (input === undefined) return 'missing-human-input'
  const candidates = nodes.filter(node => node.kind === 'fold-start' && node.sourceSeq === input.anchorSeq)
  if (candidates.length === 0) return 'missing-fold-start'
  if (candidates.length !== 1) return 'ambiguous-fold-start'
  const candidate = candidates[0]
  if (candidate === undefined) return 'missing-fold-start'
  return { input, candidate }
}

function knownBeforeStart(kind: string): boolean {
  return kind === 'user'
    || kind === 'steering'
    || kind === 'context'
    || kind === 'fold-start'
    || kind === 'assistant-step'
    || kind === 'tool-call'
    || kind === 'command'
    || kind === 'manual-compaction'
    || kind === 'compaction'
    || kind === 'model-retry'
    || kind === 'workflow-run'
    || kind === 'command-input'
    || kind === 'turn-tail'
    || kind === 'fold-end'
}

function classifyNode(kind: string, index: number, startAt: number, closingAt: number): NodeDisposition {
  if (kind === 'fold-start' || kind === 'fold-end' || kind === 'turn-tail') return 'visible'
  if (kind === 'user' || kind === 'steering' || kind === 'command-input') return 'visible'
  if (kind === 'assistant-step' || kind === 'tool-call' || kind === 'context' || kind === 'command'
    || kind === 'manual-compaction' || kind === 'compaction' || kind === 'model-retry' || kind === 'workflow-run') {
    return index > startAt && index < closingAt ? 'hidden' : 'invalid'
  }
  return 'invalid'
}
