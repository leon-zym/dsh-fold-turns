import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
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
