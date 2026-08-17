import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { FoldModel } from '../fold-model-controller.ts'
import type { FoldDomCoordinator, FoldDomModel } from '../host/contract.ts'
import type { createFoldStore } from '../fold-store.ts'
import { FoldToggle, formatDuration } from './FoldToggle.tsx'

/** Registration-owned dependencies of the top toggle node. */
export interface FoldStartInjected {
  readonly hooks: {
    readonly foldModel: ObservableSnapshot<FoldModel>
    readonly foldDom: ObservableSnapshot<FoldDomModel>
  }
  readonly coordinator: FoldDomCoordinator
  acknowledgeLateDefault(turn: number): void
}

type FoldStartProps = PropsRuntime<'conversation.chat.node', 'fold-start'>
  & PropsLocale<'foldTurns'>
  & PropsStore<ReturnType<typeof createFoldStore>>
  & Omit<FoldStartInjected, 'hooks'>
  & { readonly useFoldModel: <S>(selector: (model: FoldModel) => S) => S }
  & { readonly useFoldDom: <S>(selector: (model: FoldDomModel) => S) => S }

/** Update a running duration once per second and stop as soon as it is final. */
export function useElapsedDuration(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (startedAt === undefined) return
    const tick = () => { setNow(Date.now()) }
    tick()
    const timer = setInterval(tick, 1_000)
    return () => { clearInterval(timer) }
  }, [startedAt])
  return startedAt === undefined ? 0 : Math.max(0, now - startedAt)
}

/** Top status row for a running turn and toggle for an eligible completed turn. */
export const FoldStart = memo(function FoldStart({
  node, useFoldModel, useFoldDom, useStore, actions, coordinator, acknowledgeLateDefault, t,
}: FoldStartProps) {
  const owner = useRef({}).current
  const [button, setButton] = useState<HTMLButtonElement | null>(null)
  const buttonRef = useCallback((node: HTMLButtonElement | null) => { setButton(node) }, [])
  const model = useFoldModel(value => value)
  const plan = model.byStartKey.get(node.key)
  const capability = useFoldDom(value => plan === undefined ? undefined : value.byTurn.get(plan.turn))
  const running = model.runningByStartKey.get(node.key)
  const runningDuration = useElapsedDuration(plan === undefined ? running?.startedAt : undefined)
  const explicitlyExpanded = useStore(state => plan === undefined ? false : state.expandedByTurn[String(plan.turn)] === true)
  const defaultExpanded = plan !== undefined && model.defaultExpandedByTurn.get(plan.turn) === true
  const expanded = explicitlyExpanded || defaultExpanded

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
    if (plan === undefined || plan.durationMs === undefined || capability !== 'available') return
    coordinator.requestToggle(plan.turn, expanded, event.currentTarget)
    acknowledgeLateDefault(plan.turn)
    if (expanded) actions.collapse(plan.turn)
    else actions.expand(plan.turn)
  }, [acknowledgeLateDefault, actions, capability, coordinator, expanded, plan])

  if (plan !== undefined && plan.eligible && plan.durationMs !== undefined) {
    return (
      <FoldToggle
        buttonRef={buttonRef}
        durationMs={plan.durationMs}
        expanded={expanded}
        position="start"
        label={t('toggle.worked', { duration: formatDuration(plan.durationMs) })}
        ariaLabel={t(expanded ? 'toggle.collapse' : 'toggle.expand', { turn: plan.turn })}
        available={capability === 'available'}
        reserveSpace={capability !== 'blocked'}
        onToggle={onToggle}
      />
    )
  }
  if (running === undefined) return null
  return (
    <FoldToggle
      buttonRef={buttonRef}
      durationMs={runningDuration}
      expanded={false}
      position="start"
      label={t('toggle.running', { duration: formatDuration(runningDuration) })}
      ariaLabel={t('toggle.running', { duration: formatDuration(runningDuration) })}
      interactive={false}
      onToggle={onToggle}
    />
  )
})
