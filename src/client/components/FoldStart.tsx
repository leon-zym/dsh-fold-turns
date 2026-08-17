import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { FoldModel } from '../fold-model-controller.ts'
import type { FoldDomCoordinator } from '../host/contract.ts'
import type { createFoldStore } from '../fold-store.ts'
import { FoldToggle, formatDuration } from './FoldToggle.tsx'

/** Registration-owned dependencies of the top toggle node. */
export interface FoldStartInjected {
  readonly hooks: { readonly foldModel: ObservableSnapshot<FoldModel> }
  readonly coordinator: FoldDomCoordinator
  acknowledgeLateDefault(turn: number): void
}

type FoldStartProps = PropsRuntime<'conversation.chat.node', 'fold-start'>
  & PropsLocale<'foldTurns'>
  & PropsStore<ReturnType<typeof createFoldStore>>
  & Omit<FoldStartInjected, 'hooks'>
  & { readonly useFoldModel: <S>(selector: (model: FoldModel) => S) => S }

/** Top toggle, mounted only for an eligible plan's final ordinary user candidate. */
export const FoldStart = memo(function FoldStart({
  node, useFoldModel, useStore, actions, coordinator, acknowledgeLateDefault, t,
}: FoldStartProps) {
  const owner = useRef({}).current
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const buttonRef = useCallback((node: HTMLButtonElement | null) => { setButton(node) }, [])
  const model = useFoldModel(value => value)
  const plan = model.byStartKey.get(node.key)
  const explicitlyExpanded = useStore(state => plan === undefined ? false : state.expandedByTurn[String(plan.turn)] === true)
  const defaultExpanded = plan !== undefined && model.defaultExpandedByTurn.get(plan.turn) === true
  const expanded = explicitlyExpanded || defaultExpanded || model.loadingOlder

  useLayoutEffect(() => {
    if (button === null) return
    coordinator.mountTop(owner, button)
    return () => { coordinator.unmountTop(owner) }
  }, [button, coordinator, owner])

  useLayoutEffect(() => {
    if (button === null || plan === undefined || !plan.eligible) return
    coordinator.updateTop(owner, plan, {
      expanded,
      loadingOlder: model.loadingOlder,
      presentation: model.presentationByTurn.get(plan.turn) ?? 'initial',
    })
  }, [button, coordinator, expanded, model.loadingOlder, model.presentationByTurn, owner, plan])

  const onToggle = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (plan === undefined || plan.durationMs === undefined) return
    coordinator.requestToggle(plan.turn, expanded, event.currentTarget, event.detail !== 0)
    acknowledgeLateDefault(plan.turn)
    if (expanded) actions.collapse(plan.turn)
    else actions.expand(plan.turn)
  }, [acknowledgeLateDefault, actions, coordinator, expanded, plan])

  if (plan === undefined || !plan.eligible || plan.durationMs === undefined) return null
  return (
    <FoldToggle
      buttonRef={buttonRef}
      durationMs={plan.durationMs}
      expanded={expanded}
      position="start"
      label={t('toggle.worked', { duration: formatDuration(plan.durationMs) })}
      ariaLabel={t(expanded ? 'toggle.collapse' : 'toggle.expand', { turn: plan.turn })}
      onToggle={onToggle}
    />
  )
})
