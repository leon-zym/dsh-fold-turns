import type {
  ChatConversationViewNode, ConversationLocation, ConversationNodeContext,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Build a final Chat node without importing ui-conversation's private helpers. */
export function foldChatNode(
  context: ConversationNodeContext,
  kind: string,
  anchorSeq: number,
  data: unknown,
  visibility: 'visible' | 'hidden' = 'visible',
): ChatConversationViewNode {
  return {
    key: context.key,
    kind,
    id: context.id,
    target: 'chat',
    anchorSeq,
    location: contextLocation(context),
    visibility,
    data,
  }
}

function contextLocation(context: ConversationNodeContext): ConversationLocation {
  return context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' }
}
