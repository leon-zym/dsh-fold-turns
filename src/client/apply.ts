import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FoldEnd, type FoldEndInjected, FoldStart, type FoldStartInjected } from './components/index.ts'
import { disposeStyles as disposeFoldToggleStyles } from './components/FoldToggle.module.css'
import { foldEndDefinition, foldStartDefinition } from './definitions/index.ts'
import { FoldModelController } from './fold-model-controller.ts'
import { createFoldStore } from './fold-store.ts'
import { ChatFlowDomCoordinator } from './host/dom-coordinator.ts'
import { en, zh } from './locales/index.ts'

/** Dictionary namespace owned by this browser plugin. */
export const FOLD_TURNS_NAMESPACE = 'foldTurns'

/** Client services required by the public snapshot, slot, and locale seams. */
export const inject = ['conversationEvents', 'slots', 'sessions', 'locale']

/**
 * Register fold node Definitions plus their browser-only keyed renderers.
 *
 * No Node-side service is created. Per-session controllers and DOM coordinators
 * are allocated lazily by the session-scoped renderer injection.
 * @param ctx - DSH browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(foldStartDefinition)
  ctx.conversationEvents.register(foldEndDefinition)
  ctx.effect(() => ctx.locale.register(FOLD_TURNS_NAMESPACE, { zh, en }), 'dsh-fold-turns: dictionaries')
  ctx.effect(() => disposeFoldToggleStyles, 'dsh-fold-turns: client styles')

  const foldStore = createFoldStore()
  ctx.slots.inject('conversation.chat.node', () => {
    interface SessionResources {
      readonly controller: FoldModelController
      readonly coordinator: ChatFlowDomCoordinator
    }
    const resources = new Map<SessionId, SessionResources>()
    const release = (sessionId: SessionId, expected: SessionResources): void => {
      if (resources.get(sessionId) !== expected) return
      resources.delete(sessionId)
      expected.coordinator.dispose()
      expected.controller.dispose()
    }
    const resourcesFor = (sessionId: SessionId): SessionResources => {
      const existing = resources.get(sessionId)
      if (existing !== undefined) return existing
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`dsh-fold-turns cannot resolve session ${String(sessionId)}`)
      const created: SessionResources = {
        controller: new FoldModelController(binding.session),
        coordinator: new ChatFlowDomCoordinator(),
      }
      resources.set(sessionId, created)
      try {
        binding.ctx.effect(
          () => () => { release(sessionId, created) },
          'dsh-fold-turns: session resources',
        )
      } catch (error) {
        release(sessionId, created)
        throw error
      }
      return created
    }
    const startInjected = (sessionId: SessionId): FoldStartInjected => {
      const { controller, coordinator } = resourcesFor(sessionId)
      return {
        hooks: { foldModel: controller, foldDom: coordinator },
        coordinator,
        acknowledgeLateDefault: turn => { controller.acknowledgeLateDefault(turn) },
      }
    }
    const endInjected = (sessionId: SessionId): FoldEndInjected => {
      const { controller, coordinator } = resourcesFor(sessionId)
      return {
        hooks: { foldModel: controller, foldDom: coordinator },
        coordinator,
        acknowledgeLateDefault: turn => { controller.acknowledgeLateDefault(turn) },
      }
    }
    const disposeStart = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'fold-start',
      locale: FOLD_TURNS_NAMESPACE,
      store: foldStore,
      inject: startInjected,
    }, FoldStart)
    const disposeEnd = ctx.slots.register({
      name: 'conversation.chat.node',
      key: 'fold-end',
      locale: FOLD_TURNS_NAMESPACE,
      store: foldStore,
      inject: endInjected,
    }, FoldEnd)
    return () => {
      disposeEnd()
      disposeStart()
      for (const [sessionId, current] of [...resources]) release(sessionId, current)
    }
  })
}
