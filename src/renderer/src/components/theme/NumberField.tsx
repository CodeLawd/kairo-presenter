import { useRef } from 'react'
import { ChevronDown, ChevronUp } from '@/icons'

/** Pixels of horizontal drag on the label per step. */
const SCRUB_PX_PER_STEP = 3
/** Shift multiplies a step — arrow keys, the stepper buttons and scrubbing alike. */
const SHIFT_MULTIPLIER = 10

function decimalsOf(step: number): number {
  const text = String(step)
  const dot = text.indexOf('.')
  return dot === -1 ? 0 : text.length - dot - 1
}

/**
 * A number box for the theme inspector: type a value, nudge it with the arrow
 * keys or the up/down buttons, or drag the label sideways to scrub it.
 * Shift moves ten steps at a time.
 */
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
  icon,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
  icon?: React.ReactNode
}): React.ReactElement {
  const current = Number.isFinite(value) ? value : 0
  const scrub = useRef<{ x: number; start: number } | null>(null)

  const commit = (next: number): void => {
    let clamped = Number(next.toFixed(decimalsOf(step)))
    if (min !== undefined) clamped = Math.max(min, clamped)
    if (max !== undefined) clamped = Math.min(max, clamped)
    if (clamped !== current) onChange(clamped)
  }

  const nudge = (direction: 1 | -1, shift: boolean): void =>
    commit(current + direction * step * (shift ? SHIFT_MULTIPLIER : 1))

  return (
    <div className="min-w-0">
      <p
        className="mb-1 cursor-ew-resize select-none text-[11px] font-medium text-zinc-500"
        title="Drag to adjust"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          scrub.current = { x: event.clientX, start: current }
        }}
        onPointerMove={(event) => {
          const drag = scrub.current
          if (!drag) return
          const steps = Math.round((event.clientX - drag.x) / SCRUB_PX_PER_STEP)
          commit(drag.start + steps * step * (event.shiftKey ? SHIFT_MULTIPLIER : 1))
        }}
        onPointerUp={() => {
          scrub.current = null
        }}
        onPointerCancel={() => {
          scrub.current = null
        }}
      >
        {label}
      </p>
      <div className="flex h-8 items-center gap-2 rounded-md bg-surface-tertiary pl-2.5 text-[13px] text-zinc-100">
        {icon}
        <input
          type="number"
          className="h-full w-full min-w-0 bg-transparent text-sm outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={current}
          step={step}
          min={min}
          max={max}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
            event.preventDefault()
            nudge(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
          }}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (event.target.value !== '' && Number.isFinite(next)) commit(next)
          }}
          aria-label={label}
        />
        {suffix && <span className="shrink-0 text-xs text-zinc-500">{suffix}</span>}
        <div className="flex h-full shrink-0 flex-col py-0.5 pr-0.5">
          {([1, -1] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              tabIndex={-1}
              aria-label={`${direction === 1 ? 'Increase' : 'Decrease'} ${label}`}
              disabled={direction === 1 ? max !== undefined && current >= max : min !== undefined && current <= min}
              onClick={(event) => nudge(direction, event.shiftKey)}
              className="grid flex-1 place-items-center rounded px-1 text-zinc-500 transition-colors hover:bg-surface-elevated hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              {direction === 1 ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
