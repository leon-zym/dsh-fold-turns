import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnFoldPlan } from '../fold-core.ts'
import type { FoldPresentation } from '../fold-model-controller.ts'

/** Current renderer state supplied to the DOM adapter. */
export interface FoldDomState {
  readonly expanded: boolean
  readonly loadingOlder: boolean
  readonly presentation: FoldPresentation
}

/** Whether the host DOM contract can safely present one turn's controls. */
export type FoldDomCapability = 'checking' | 'available' | 'blocked'

/** Observable capability projection consumed by both toggle renderers. */
export interface FoldDomModel {
  readonly byTurn: ReadonlyMap<number, FoldDomCapability>
}

/** DOM host surface used by the two React toggle renderers. */
export interface FoldDomCoordinator extends ObservableSnapshot<FoldDomModel> {
  mountTop(owner: object, button: HTMLButtonElement): void
  updateTop(owner: object, plan: TurnFoldPlan, state: FoldDomState): void
  unmountTop(owner: object): void
  mountBottom(owner: object, turn: number, button: HTMLButtonElement): void
  unmountBottom(owner: object): void
  requestToggle(turn: number, expanded: boolean, trigger: HTMLButtonElement): void
  dispose(): void
}
