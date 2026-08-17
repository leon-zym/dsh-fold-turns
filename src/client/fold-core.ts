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
  | 'missing-user'
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
  readonly startUserKey?: string
  readonly startCandidateKey?: string
  readonly closingKey?: string
  readonly endToggleKey?: string
  readonly tailKey?: string
  readonly hiddenKeys: readonly string[]
  readonly closingReasoningCount: number
  readonly durationMs?: number
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

  const ordinaryUsers = turn.nodes.filter(node => node.kind === 'user' && finite(node.anchorSeq))
  const startUser = ordinaryUsers.reduce<FoldNodeDto | undefined>(
    (latest, candidate) => latest === undefined || candidate.anchorSeq > latest.anchorSeq ? candidate : latest,
    undefined,
  )
  if (startUser === undefined) return fail(turn.turn, 'missing-user')

  const startCandidates = turn.nodes.filter(node => node.kind === 'fold-start' && node.sourceSeq === startUser.anchorSeq)
  if (startCandidates.length === 0) return fail(turn.turn, 'missing-fold-start')
  if (startCandidates.length !== 1) return fail(turn.turn, 'ambiguous-fold-start')
  const startCandidate = startCandidates[0]
  if (startCandidate === undefined) return fail(turn.turn, 'missing-fold-start')

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

  const startUserAt = nodeIndex(turn.nodes, startUser.key)
  const startAt = nodeIndex(turn.nodes, startCandidate.key)
  const endAt = nodeIndex(turn.nodes, endCandidate.key)
  const closingAt = nodeIndex(turn.nodes, closingNode.key)
  if (startUserAt < 0 || startAt < 0 || endAt < 0 || closingAt < 0 || !(startUserAt < startAt && startAt < endAt && endAt < closingAt)) {
    return fail(turn.turn, 'invalid-order')
  }

  const dispositions = new Map<string, NodeDisposition>()
  for (let index = 0; index < turn.nodes.length; index += 1) {
    const node = turn.nodes[index]
    if (node === undefined) return fail(turn.turn, 'unknown-node-kind')
    if (index <= startUserAt) {
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
      if (index <= closingAt) return fail(turn.turn, 'invalid-order')
      dispositions.set(node.key, 'tail')
      continue
    }

    const disposition = classifyNode(node.kind, index, startUserAt, closingAt)
    if (disposition === 'invalid') return fail(turn.turn, 'unknown-node-kind')
    if (disposition === 'hidden' && !(index > startAt && index < endAt)) {
      return fail(turn.turn, 'process-outside-boundary')
    }
    if (disposition === 'visible' && index > endAt && index < closingAt) {
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
    startUserKey: startUser.key,
    startCandidateKey: startCandidate.key,
    closingKey: closingNode.key,
    endToggleKey: endCandidate.key,
    ...(tail === undefined ? {} : { tailKey: tail.key }),
    hiddenKeys,
    closingReasoningCount: closingNode.reasoningCount,
    durationMs,
  }
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
