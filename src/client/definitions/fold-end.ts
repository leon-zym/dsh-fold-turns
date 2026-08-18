import type {
  ConversationLocation, ConversationNodeContext, ConversationNodeDefinition, TurnLocation,
} from '@deepseek-ai/dsh-client-runtime/client'
import { FOLD_END_KIND } from '../../invariant.ts'
import { readTurnTail } from '../host/snapshot-projector.ts'
import { foldChatNode } from './common.ts'
import type { FoldEndData } from './types.ts'

/** Relative anchor reserved for a plugin-owned row immediately before the closing assistant. */
const END_BEFORE_CLOSING = 0.001

interface FoldEndState {
  readonly turn: number
  readonly endSeq?: number
}

/**
 * Add one stable candidate immediately before the turn-tail's closing assistant.
 *
 * Location data is materialized before view nodes, so the native turn-tail data
 * is available while a completed turn is assembled. Missing data remains a
 * hidden candidate and makes FoldCore keep the turn fail-open.
 */
export const foldEndDefinition: ConversationNodeDefinition<FoldEndState> = {
  kind: FOLD_END_KIND,
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'turn/end') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('fold-end requires turn/start')
    return { turn: match.event.data.turn }
  },
  update: (context, match) => match.event.type === 'turn/end'
    ? { ...context.state, endSeq: match.event.seq }
    : context.state,
  publication: match => match.event.type === 'turn/end' ? 'immediate' : 'none',
  buildViewNode: (context) => {
    const state = context.state
    if (state?.endSeq === undefined) return null
    const turn = turnLocation(context)
    const tail = turn === undefined ? undefined : readTurnTail(turn.data.get('turn-tail'))
    const closingSeq = tail?.finalSeq
    const data: FoldEndData = { turn: state.turn }
    return foldChatNode(
      context,
      FOLD_END_KIND,
      closingSeq === undefined ? state.endSeq : closingSeq - END_BEFORE_CLOSING,
      data,
      closingSeq === undefined ? 'hidden' : 'visible',
    )
  },
}

function turnLocation(context: ConversationNodeContext<FoldEndState>): TurnLocation | undefined {
  const location: ConversationLocation | undefined = context.start?.location ?? context.matches[0]?.location
  return location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined
}
