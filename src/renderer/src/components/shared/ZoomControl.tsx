import { ZoomIn, ZoomOut } from '@/icons'
import { Slider } from '@/components/ui/slider'

/**
 * − [slider] + — card/slide size control shared by Scripture and Lyrics.
 * Plain, like ProPresenter's size slider: no box, no percentage. Double-click
 * anywhere on it to go back to the default size.
 *
 * The slider sits in a fixed-width box. It has no content width of its own and
 * its root always carries `w-full` (our `cn` only joins classes, so a width
 * passed in does not replace it). Given a sized parent, `w-full` resolves to
 * that size instead of stretching over the neighbouring controls.
 */
export function ZoomControl({
  value,
  min,
  max,
  defaultValue,
  step = 5,
  buttonStep = 10,
  label,
  onChange,
}: {
  value: number
  min: number
  max: number
  defaultValue: number
  step?: number
  buttonStep?: number
  /** e.g. "Verse card size" — used for the group and slider labels. */
  label: string
  onChange: (value: number) => void
}): React.ReactElement {
  const iconButton =
    'grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-500 hover:text-white disabled:opacity-30'
  return (
    <div
      className="flex shrink-0 items-center"
      role="group"
      aria-label={label}
      title={`${label} · double-click to reset`}
      onDoubleClick={() => onChange(defaultValue)}
    >
      <button
        type="button"
        className={iconButton}
        onClick={() => onChange(Math.max(min, value - buttonStep))}
        disabled={value <= min}
        aria-label="Smaller"
      >
        <ZoomOut size={13} aria-hidden="true" />
      </button>
      <div className="w-20 shrink-0 px-1">
        <Slider
          trackClassName="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-border"
          rangeClassName="absolute h-full bg-slate-400 select-none"
          thumbClassName="relative block size-3 shrink-0 rounded-full bg-white select-none after:absolute after:-inset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={(next) => onChange(next[0] ?? defaultValue)}
          aria-label={label}
          aria-valuetext={`${value}%`}
        />
      </div>
      <button
        type="button"
        className={iconButton}
        onClick={() => onChange(Math.min(max, value + buttonStep))}
        disabled={value >= max}
        aria-label="Larger"
      >
        <ZoomIn size={13} aria-hidden="true" />
      </button>
    </div>
  )
}
