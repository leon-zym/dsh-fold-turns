import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import { FOLD_START_KIND } from '../../invariant.ts'
import { foldChatNode } from './common.ts'
import type { FoldStartData } from './types.ts'

/** Relative anchor reserved for a plugin-owned row immediately after its source message. */
const START_AFTER_USER = 0.001

/**
 * Add one stable candidate after each ordinary user-source message.
 *
 * The native message Definition decides later whether that message is a
 * `user` or `steering` node. FoldCore only activates the candidate paired
 * with the final ordinary user in its turn.
 */
export const foldStartDefinition: ConversationNodeDefinition<FoldStartData> = {
  kind: FOLD_START_KIND,
  target: 'chat',
  match: event => event.type === 'user/message'
    && isAppendSurfaceEvent(event)
    && event.data.source.kind === 'user'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'user/message') throw new Error('fold-start requires user/message')
    return { messageId: String(match.event.data.id), sourceSeq: match.event.seq }
  },
  update: context => context.state,
  buildViewNode: context => context.state === undefined
    ? null
    : foldChatNode(context, FOLD_START_KIND, context.state.sourceSeq + START_AFTER_USER, context.state),
}
