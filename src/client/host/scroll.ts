/** Scroll anchoring helpers that avoid writing while ChatView follows bottom. */

const BOTTOM_THRESHOLD = 24

export interface ScrollAnchor {
  readonly scrollport: HTMLElement
  readonly element: HTMLElement
  readonly top: number
  readonly followsBottom: boolean
}

/** Capture a stable element's position relative to the native scrollport. */
export function captureScrollAnchor(flow: HTMLElement, element: HTMLElement): ScrollAnchor | undefined {
  const scrollport = flow.closest('[data-conversation-scroll]')
  if (!(scrollport instanceof HTMLElement)) return undefined
  const followsBottom = scrollport.scrollHeight - scrollport.clientHeight - scrollport.scrollTop <= BOTTOM_THRESHOLD
  return {
    scrollport,
    element,
    top: element.getBoundingClientRect().top - scrollport.getBoundingClientRect().top,
    followsBottom,
  }
}

/** Restore the reader's relative position unless native bottom-follow owns it. */
export function restoreScrollAnchor(anchor: ScrollAnchor | undefined): void {
  if (anchor === undefined || anchor.followsBottom || !anchor.element.isConnected) return
  const next = anchor.element.getBoundingClientRect().top - anchor.scrollport.getBoundingClientRect().top
  const delta = next - anchor.top
  if (delta !== 0) anchor.scrollport.scrollTop += delta
}
