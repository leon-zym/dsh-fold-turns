import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Ref } from 'react'
import type { MouseEvent } from 'react'
import css from './FoldToggle.module.css'

/** Format an exact non-negative turn duration without using wall-clock time. */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`
  if (totalMinutes > 0) return `${totalMinutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

/** Presentational, accessible control shared by the start and end node renderers. */
export function FoldToggle({
  buttonRef,
  durationMs,
  expanded,
  position,
  label,
  ariaLabel,
  interactive = true,
  available = true,
  reserveSpace = true,
  onToggle,
}: {
  readonly buttonRef: Ref<HTMLButtonElement>
  readonly durationMs: number
  readonly expanded: boolean
  readonly position: 'start' | 'end'
  readonly label: string
  readonly ariaLabel: string
  readonly interactive?: boolean
  /** Keep the probe anchor mounted while withholding an unsafe control. */
  readonly available?: boolean
  /** Preserve the seat while the host contract is still being checked. */
  readonly reserveSpace?: boolean
  readonly onToggle: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  const usable = interactive && available
  return (
    <div
      className={css.root}
      data-dsh-fold-toggle={position}
      data-dsh-fold-layout={available ? 'normal' : reserveSpace ? 'reserved' : 'none'}
      aria-hidden={available ? undefined : true}
      style={{ visibility: available ? undefined : 'hidden' }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={css.button}
        aria-expanded={usable ? expanded : undefined}
        aria-label={ariaLabel}
        data-dsh-fold-toggle-button={position}
        disabled={!usable}
        onClick={usable ? onToggle : undefined}
      >
        <span className={css.label}>{label}</span>
        {interactive ? <IconChevronDownOutline14 className={css.chevron} /> : null}
      </button>
    </div>
  )
}
