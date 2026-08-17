import type { TurnFoldPlan } from '../fold-core.ts'

/** Direct ChatNodeSeat rows mapped by their public anchor key. */
export interface ChatFlowRows {
  readonly flow: HTMLElement
  readonly rows: ReadonlyMap<string, HTMLElement>
}

export type ChatFlowProbe =
  | { readonly ok: true; readonly value: ChatFlowRows }
  | { readonly ok: false; readonly scope: 'turn' | 'view'; readonly reason: string }

/**
 * Probe the currently rendered `chat-flow-v1` DOM contract.
 *
 * The adapter only walks direct ChatNodeSeat children and compares dataset
 * values directly. It never infers turn membership from sibling positions.
 */
export function probeChatFlow(button: HTMLButtonElement, plan: TurnFoldPlan): ChatFlowProbe {
  const flow = button.closest('[data-chat-flow]')
  if (!(flow instanceof HTMLElement)) return { ok: false, scope: 'turn', reason: 'missing-chat-flow' }
  if (!(flow.closest('[data-conversation-scroll]') instanceof HTMLElement)) {
    return { ok: false, scope: 'view', reason: 'missing-conversation-scroll' }
  }
  const rows = new Map<string, HTMLElement>()
  for (const child of flow.children) {
    if (!(child instanceof HTMLElement)) continue
    const key = child.dataset.chatAnchorKey
    if (key === undefined) continue
    if (child.parentElement !== flow) return { ok: false, scope: 'view', reason: 'non-direct-chat-row' }
    if (child.dataset.chatFlowKey !== key || child.dataset.chatFlowKind === undefined) {
      return { ok: false, scope: 'view', reason: 'incomplete-chat-row-dataset' }
    }
    if (rows.has(key)) return { ok: false, scope: 'view', reason: 'duplicate-chat-anchor-key' }
    rows.set(key, child)
  }
  const required = [
    plan.startUserKey,
    plan.startCandidateKey,
    ...plan.hiddenKeys,
    plan.endToggleKey,
    plan.closingKey,
    plan.tailKey,
  ].filter((key): key is string => key !== undefined)
  if (required.some(key => !rows.has(key))) return { ok: false, scope: 'turn', reason: 'missing-target-row' }
  const uniqueRequired = new Set(required)
  if (uniqueRequired.size !== required.length) return { ok: false, scope: 'turn', reason: 'duplicate-plan-key' }
  if (plan.startUserKey === undefined || plan.startCandidateKey === undefined
    || plan.endToggleKey === undefined || plan.closingKey === undefined) {
    return { ok: false, scope: 'turn', reason: 'incomplete-plan' }
  }
  const userAt = indexOf(flow, rows.get(plan.startUserKey))
  const startAt = indexOf(flow, rows.get(plan.startCandidateKey))
  const endAt = indexOf(flow, rows.get(plan.endToggleKey))
  const closingAt = indexOf(flow, rows.get(plan.closingKey))
  if (userAt < 0 || startAt < 0 || endAt < 0 || closingAt < 0 || !(userAt < startAt && startAt < endAt && endAt < closingAt)) {
    return { ok: false, scope: 'turn', reason: 'invalid-target-order' }
  }
  if (plan.hiddenKeys.some(key => {
    const index = indexOf(flow, rows.get(key))
    return index <= startAt || index >= endAt
  })) return { ok: false, scope: 'turn', reason: 'hidden-row-outside-toggle-range' }
  if (plan.tailKey !== undefined && indexOf(flow, rows.get(plan.tailKey)) <= closingAt) {
    return { ok: false, scope: 'turn', reason: 'turn-tail-before-closing' }
  }
  return { ok: true, value: { flow, rows } }
}

function indexOf(flow: HTMLElement, row: HTMLElement | undefined): number {
  if (row === undefined) return -1
  return Array.prototype.indexOf.call(flow.children, row) as number
}
