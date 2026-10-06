import { ZoomIn, ZoomOut } from '@/icons'
import { Slider } from '@/components/ui/slider'

/**
 * − [slider] + 100% — card/slide size control shared by Scripture and Lyrics.
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
    'grid h-6 w-6 shrink-0 place-items-center rounded text-zinc-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-30'
  return (
    <div
      className="flex shrink-0 items-center gap-1 rounded-md bg-surface px-1 py-0.5"
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className={iconButton}
        onClick={() => onChange(Math.max(min, value - buttonStep))}
        disabled={value <= min}
        aria-label="Smaller"
        title="Smaller"
      >
        <ZoomOut size={13} aria-hidden="true" />
      </button>
      <div className="w-24 shrink-0 px-1">
        <Slider
          trackClassName="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-border"
          rangeClassName="absolute h-full bg-blue-500 select-none"
          thumbClassName="relative block size-3.5 shrink-0 rounded-full bg-white transition-shadow select-none after:absolute after:-inset-2 hover:ring-4 hover:ring-blue-400/25 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/40"
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={(next) => onChange(next[0] ?? defaultValue)}
          aria-label={label}
        />
      </div>
      <button
        type="button"
        className={iconButton}
        onClick={() => onChange(Math.min(max, value + buttonStep))}
        disabled={value >= max}
        aria-label="Larger"
        title="Larger"
      >
        <ZoomIn size={13} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="h-6 w-11 shrink-0 rounded px-1 text-right text-[11px] font-semibold tabular-nums text-zinc-300 hover:bg-surface-tertiary hover:text-white"
        onClick={() => onChange(defaultValue)}
        title="Reset to default size"
        aria-label={`${label} ${value}%. Reset to default`}
      >
        {value}%
      </button>
    </div>
  )
}
