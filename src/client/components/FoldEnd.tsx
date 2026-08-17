import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { FoldModel } from '../fold-model-controller.ts'
import type { FoldDomCoordinator } from '../host/contract.ts'
import type { createFoldStore } from '../fold-store.ts'
import { FoldToggle, formatDuration } from './FoldToggle.tsx'

/** Registration-owned dependencies of the bottom toggle node. */
export interface FoldEndInjected {
  readonly hooks: { readonly foldModel: ObservableSnapshot<FoldModel> }
  readonly coordinator: FoldDomCoordinator
  acknowledgeLateDefault(turn: number): void
}

type FoldEndProps = PropsRuntime<'conversation.chat.node', 'fold-end'>
  & PropsLocale<'foldTurns'>
  & PropsStore<ReturnType<typeof createFoldStore>>
  & Omit<FoldEndInjected, 'hooks'>
  & { readonly useFoldModel: <S>(selector: (model: FoldModel) => S) => S }

/** Bottom toggle, visible only while the matching turn is expanded. */
export const FoldEnd = memo(function FoldEnd({
  node, useFoldModel, useStore, actions, coordinator, acknowledgeLateDefault, t,
}: FoldEndProps) {
  const owner = useRef({}).current
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const buttonRef = useCallback((node: HTMLButtonElement | null) => { setButton(node) }, [])
  const model = useFoldModel(value => value)
  const plan = model.byEndKey.get(node.key)
  const explicitlyExpanded = useStore(state => plan === undefined ? false : state.expandedByTurn[String(plan.turn)] === true)
  const defaultExpanded = plan !== undefined && model.defaultExpandedByTurn.get(plan.turn) === true
  const expanded = explicitlyExpanded || defaultExpanded

  useLayoutEffect(() => {
    if (button === null || plan === undefined || !expanded) return
    coordinator.mountBottom(owner, plan.turn, button)
    return () => { coordinator.unmountBottom(owner) }
  }, [button, coordinator, expanded, owner, plan])

  const onToggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (plan === undefined || plan.durationMs === undefined) return
    coordinator.requestToggle(plan.turn, expanded, event.currentTarget)
    acknowledgeLateDefault(plan.turn)
    if (expanded) actions.collapse(plan.turn)
    else actions.expand(plan.turn)
  }, [acknowledgeLateDefault, actions, coordinator, expanded, plan])

  if (plan === undefined || !plan.eligible || plan.durationMs === undefined || !expanded) return null
  return (
    <FoldToggle
      buttonRef={buttonRef}
      durationMs={plan.durationMs}
      expanded={expanded}
      position="end"
      label={t('toggle.worked', { duration: formatDuration(plan.durationMs) })}
      ariaLabel={t('toggle.collapse', { turn: plan.turn })}
      onToggle={onToggle}
    />
  )
})
