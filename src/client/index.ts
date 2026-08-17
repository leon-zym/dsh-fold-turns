/** Browser entry point discovered through the package's dsh.client manifest. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { FoldTurnsLocaleKey } from './locales/index.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Copy used by the completed-turn toggle rows. */
    foldTurns: FoldTurnsLocaleKey
  }
}

export { apply, inject } from './apply.ts'
export { planTurnFold, type TurnFoldPlan } from './fold-core.ts'
export { FoldModelController } from './fold-model-controller.ts'
export { createFoldStore } from './fold-store.ts'
