import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FoldToggle, formatDuration } from '../src/client/components/FoldToggle.tsx'
import { useElapsedDuration } from '../src/client/components/FoldStart.tsx'

describe('FoldToggle', () => {
  it('formats exact durations without consulting the wall clock', () => {
    expect(formatDuration(12_999)).toBe('12s')
    expect(formatDuration(123_000)).toBe('2m 03s')
    expect(formatDuration(3_723_000)).toBe('1h 02m 03s')
  })

  it('renders one native accessible button with the current expansion state', () => {
    const onToggle = vi.fn()
    const buttonRef = createRef<HTMLButtonElement>()
    render(
      <FoldToggle
        buttonRef={buttonRef}
        durationMs={12_000}
        expanded={false}
        position="start"
        label="Worked for 12s"
        ariaLabel="Expand turn 2"
        onToggle={onToggle}
      />,
    )

    const button = screen.getByRole('button', { name: 'Expand turn 2' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(buttonRef.current).toBe(button)
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it('keeps an unavailable toggle mounted with stable layout geometry but out of view and accessibility', () => {
    const onToggle = vi.fn()
    const buttonRef = createRef<HTMLButtonElement>()
    const { container, rerender } = render(
      <FoldToggle
        buttonRef={buttonRef}
        durationMs={12_000}
        expanded={false}
        position="start"
        label="Worked for 12s"
        ariaLabel="Expand turn 2"
        available={false}
        reserveSpace
        onToggle={onToggle}
      />,
    )

    expect(within(container).queryByRole('button', { name: 'Expand turn 2' })).toBeNull()
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.hasAttribute('hidden')).toBe(false)
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(wrapper.dataset.dshFoldLayout).toBe('reserved')
    expect(buttonRef.current?.disabled).toBe(true)
    expect(buttonRef.current?.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(buttonRef.current as HTMLButtonElement)
    expect(onToggle).not.toHaveBeenCalled()

    rerender(
      <FoldToggle
        buttonRef={buttonRef}
        durationMs={12_000}
        expanded={false}
        position="start"
        label="Worked for 12s"
        ariaLabel="Expand turn 2"
        available
        onToggle={onToggle}
      />,
    )
    expect(container.firstElementChild).toBe(wrapper)
    expect(wrapper.style.visibility).toBe('')
    expect(wrapper.getAttribute('aria-hidden')).toBeNull()
  })

  it('marks a blocked toggle seat to leave layout without becoming interactive', () => {
    const onToggle = vi.fn()
    const buttonRef = createRef<HTMLButtonElement>()
    const { container, rerender } = render(
      <FoldToggle
        buttonRef={buttonRef}
        durationMs={12_000}
        expanded={false}
        position="start"
        label="Worked for 12s"
        ariaLabel="Expand turn 2"
        available={false}
        reserveSpace
        onToggle={onToggle}
      />,
    )

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.dataset.dshFoldLayout).toBe('reserved')
    rerender(
      <FoldToggle
        buttonRef={buttonRef}
        durationMs={12_000}
        expanded={false}
        position="start"
        label="Worked for 12s"
        ariaLabel="Expand turn 2"
        available={false}
        reserveSpace={false}
        onToggle={onToggle}
      />,
    )
    expect(container.firstElementChild).toBe(wrapper)
    expect(wrapper.dataset.dshFoldLayout).toBe('none')
    expect(wrapper.style.visibility).toBe('hidden')
    expect(wrapper.getAttribute('aria-hidden')).toBe('true')
    expect(buttonRef.current?.disabled).toBe(true)
    expect(buttonRef.current?.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(buttonRef.current as HTMLButtonElement)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('keeps the live status passive and refreshes its duration once per second', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(1_000))
    const { result, rerender, unmount } = renderHook(
      ({ startedAt }: { readonly startedAt: number | undefined }) => useElapsedDuration(startedAt),
      { initialProps: { startedAt: 1_000 } },
    )
    expect(result.current).toBe(0)

    act(() => { vi.advanceTimersByTime(1_000) })
    expect(result.current).toBe(1_000)
    rerender({ startedAt: undefined })
    expect(result.current).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    unmount()
    vi.useRealTimers()

    const onToggle = vi.fn()
    render(
      <FoldToggle
        buttonRef={createRef<HTMLButtonElement>()}
        durationMs={1_000}
        expanded={false}
        position="start"
        label="Running for 1s"
        ariaLabel="Running for 1s"
        interactive={false}
        onToggle={onToggle}
      />,
    )
    const button = screen.getByRole('button', { name: 'Running for 1s' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBeNull()
    fireEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
  })
})
