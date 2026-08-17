/** Small, cancelable browser animation scheduler for fold transitions. */

export interface FoldAnimationCallbacks {
  readonly start: () => void
  readonly frame: () => void
  readonly finish: () => void
}

export interface FoldAnimationHandle {
  cancel(): void
}

/** Whether the operating system has asked for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Run one 180ms transition with a separate start/layout and finalization phase.
 *
 * The caller owns all element writes and may safely call `cancel()` repeatedly.
 * A cancelled handle never invokes `finish`.
 * @param callbacks - imperative phase callbacks.
 * @param enabled - false for keyboard and reduced-motion interactions.
 * @returns cancellable transition handle.
 */
export function runFoldAnimation(callbacks: FoldAnimationCallbacks, enabled: boolean): FoldAnimationHandle {
  if (!enabled || prefersReducedMotion()) {
    callbacks.start()
    callbacks.frame()
    callbacks.finish()
    return { cancel: () => {} }
  }
  let cancelled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = scheduleFrame(() => {
    if (cancelled) return
    callbacks.frame()
    timer = setTimeout(() => {
      if (!cancelled) callbacks.finish()
    }, 216)
  })
  callbacks.start()
  return {
    cancel: () => {
      if (cancelled) return
      cancelled = true
      cancelFrame(frame)
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}

function scheduleFrame(callback: FrameRequestCallback): number | ReturnType<typeof setTimeout> {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback)
  return setTimeout(() => { callback(Date.now()) }, 0)
}

function cancelFrame(handle: number | ReturnType<typeof setTimeout>): void {
  if (typeof cancelAnimationFrame === 'function' && typeof handle === 'number') {
    cancelAnimationFrame(handle)
    return
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>)
}
