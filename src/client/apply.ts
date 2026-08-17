import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { FoldEnd, type FoldEndInjected, FoldStart, type FoldStartInjected } from './components/index.ts'
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

  const foldStore = createFoldStore()
  ctx.slots.inject('conversation.chat.node', () => {
    const controllers = new Map<SessionId, FoldModelController>()
    const coordinators = new Map<SessionId, ChatFlowDomCoordinator>()
    const controllerFor = (sessionId: SessionId): FoldModelController => {
      let controller = controllers.get(sessionId)
      if (controller !== undefined) return controller
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) throw new Error(`dsh-fold-turns cannot resolve session ${String(sessionId)}`)
      controller = new FoldModelController(binding.session)
      controllers.set(sessionId, controller)
      return controller
    }
    const coordinatorFor = (sessionId: SessionId): ChatFlowDomCoordinator => {
      let coordinator = coordinators.get(sessionId)
      if (coordinator === undefined) {
        coordinator = new ChatFlowDomCoordinator()
        coordinators.set(sessionId, coordinator)
      }
      return coordinator
    }
    const startInjected = (sessionId: SessionId): FoldStartInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { foldModel: controller },
        coordinator: coordinatorFor(sessionId),
        acknowledgeLateDefault: turn => { controller.acknowledgeLateDefault(turn) },
      }
    }
    const endInjected = (sessionId: SessionId): FoldEndInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { foldModel: controller },
        coordinator: coordinatorFor(sessionId),
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
      for (const coordinator of coordinators.values()) coordinator.dispose()
      for (const controller of controllers.values()) controller.dispose()
      coordinators.clear()
      controllers.clear()
    }
  })
}
