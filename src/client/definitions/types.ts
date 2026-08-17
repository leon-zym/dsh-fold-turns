import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
// This type-only import activates the host ChatNodeDataMap declaration merge.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Candidate inserted immediately after every ordinary user-source message. */
export interface FoldStartData {
  readonly messageId: string
  readonly sourceSeq: number
}

/** Candidate inserted immediately before a completed turn's closing assistant. */
export interface FoldEndData {
  readonly turn: number
}

/** Narrow structural subset of the native assistant-step payload used by the adapter. */
export interface AssistantStepFoldData {
  readonly blocks: readonly AssistantBlock[]
  readonly finalNode?: { readonly seq: number }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Plugin-owned toggle seat immediately after a user message. */
    'fold-start': FoldStartData
    /** Plugin-owned toggle seat immediately before the closing assistant. */
    'fold-end': FoldEndData
  }
}
