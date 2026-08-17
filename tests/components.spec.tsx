import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { FoldToggle, formatDuration } from '../src/client/components/FoldToggle.tsx'

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
})
