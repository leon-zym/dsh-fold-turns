import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Per-session, page-memory-only user expansion state. */
export interface FoldStoreState {
  readonly expandedByTurn: Record<string, true>
}

/**
 * Create the shared store handle used by both fold-toggle node registrations.
 *
 * The declaration deliberately omits `persist`: refreshes always return
 * completed eligible turns to their default collapsed state.
 */
export function createFoldStore() {
  return defineStore({
    init: (): FoldStoreState => ({ expandedByTurn: {} }),
    actions: {
      expand: (draft, turn: number) => {
        draft.expandedByTurn[String(turn)] = true
      },
      collapse: (draft, turn: number) => {
        delete draft.expandedByTurn[String(turn)]
      },
    },
  })
}
