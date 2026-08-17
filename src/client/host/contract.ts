import type { TurnFoldPlan } from '../fold-core.ts'
import type { FoldPresentation } from '../fold-model-controller.ts'

/** Current renderer state supplied to the DOM adapter. */
export interface FoldDomState {
  readonly expanded: boolean
  readonly loadingOlder: boolean
  readonly presentation: FoldPresentation
}

/** DOM host surface used by the two React toggle renderers. */
export interface FoldDomCoordinator {
  mountTop(owner: object, button: HTMLButtonElement): void
  updateTop(owner: object, plan: TurnFoldPlan, state: FoldDomState): void
  unmountTop(owner: object): void
  mountBottom(owner: object, turn: number, button: HTMLButtonElement): void
  unmountBottom(owner: object): void
  requestToggle(turn: number, expanded: boolean, trigger: HTMLButtonElement, animate: boolean): void
  dispose(): void
}
