type Listener = () => void

export function createSnapshotStore<T>(initial: T) {
  let snapshot = initial
  const listeners = new Set<Listener>()
  const notify = (): void => { for (const listener of listeners) listener() }
  return {
    getSnapshot: (): T => snapshot,
    subscribe: (listener: Listener): (() => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    update: (mutator: (draft: T) => void): void => {
      mutator(snapshot)
      notify()
    },
    set: (next: T): void => {
      snapshot = next
      notify()
    },
  }
}

export function defineStore<T, A extends Record<string, (draft: T, ...args: any[]) => void>>(spec: {
  readonly init: () => T
  readonly persist?: string
  readonly actions: A
}) {
  return {
    spec,
    create: (_scopeKey?: string) => {
      const store = createSnapshotStore(spec.init())
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([key, action]) => [key, (...args: unknown[]) => {
        store.update(draft => { action(draft, ...args) })
      }])) as { [Key in keyof A]: (...args: Parameters<A[Key]> extends [T, ...infer Rest] ? Rest : never) => void }
      return {
        ...store,
        actions,
        store,
        clearPersisted: (): void => {},
      }
    },
  }
}

export function isAppendSurfaceEvent(event: { readonly data?: { readonly surface?: { readonly placement?: string } } }): boolean {
  return event.data?.surface?.placement === 'append'
}
