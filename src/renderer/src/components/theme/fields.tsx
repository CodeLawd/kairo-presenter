import { Plus } from '@/icons'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Slider as SliderPrimitive } from '@/components/ui/slider'
import { overlayMediaUrl } from '@shared/overlay-template'

// Inspector fields shared by the theme's background and its elements.

export function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  format,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  format?: (v: number) => string
}): React.ReactElement {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">{label}</label>
        <span className="text-[11px] tabular-nums text-slate-400">
          {format ? format(value) : value}
          {unit}
        </span>
      </div>
      <SliderPrimitive
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
        aria-label={label}
        trackClassName="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-elevated"
        rangeClassName="absolute h-full bg-slate-300"
        thumbClassName="block size-3.5 rounded-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      />
    </div>
  )
}

export function LabeledSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.ReactElement {
  return (
    <div>
      <p className="label">{label}</p>
      <SegmentedControl
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        fit
        itemClassName={options.length > 4 ? 'px-1.5 text-[11px]' : undefined}
      />
    </div>
  )
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`

const NEUTRAL_ADJUSTMENTS = { hue: 0, saturation: 1, brightness: 1, contrast: 1, blurPx: 0 } as const

/** The colour and blur settings a background or a media element carries. */
export type MediaAdjustmentValues = {
  hue?: number
  saturation?: number
  brightness?: number
  contrast?: number
  blurPx?: number
}

/** Colour and blur for an image or video. */
export function MediaAdjustments({
  bg,
  onChange,
}: {
  bg: MediaAdjustmentValues
  onChange: (partial: Partial<MediaAdjustmentValues>) => void
}): React.ReactElement {
  const adjusted = (Object.keys(NEUTRAL_ADJUSTMENTS) as Array<keyof typeof NEUTRAL_ADJUSTMENTS>).some(
    (key) => (bg[key] ?? NEUTRAL_ADJUSTMENTS[key]) !== NEUTRAL_ADJUSTMENTS[key],
  )
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="label mb-0">Adjustments</p>
        {adjusted && (
          <button type="button" className="text-[11px] text-slate-400 hover:text-white" onClick={() => onChange({ ...NEUTRAL_ADJUSTMENTS })}>
            Reset
          </button>
        )}
      </div>
      <Slider label="Brightness" value={bg.brightness ?? 1} onChange={(brightness) => onChange({ brightness })} min={0.25} max={1.75} step={0.05} format={pct} />
      <Slider label="Contrast" value={bg.contrast ?? 1} onChange={(contrast) => onChange({ contrast })} min={0.25} max={1.75} step={0.05} format={pct} />
      <Slider label="Saturation" value={bg.saturation ?? 1} onChange={(saturation) => onChange({ saturation })} min={0} max={2} step={0.05} format={pct} />
      <Slider label="Hue" value={bg.hue ?? 0} onChange={(hue) => onChange({ hue })} min={-180} max={180} unit="°" />
      <Slider label="Blur" value={bg.blurPx ?? 0} onChange={(blurPx) => onChange({ blurPx })} min={0} max={40} unit="px" />
    </div>
  )
}

/** The chosen image or video as a thumbnail, with its name and a way to change it. */
export function MediaPicker({ type, path, onPick }: { type: 'image' | 'video'; path: string; onPick: () => void }): React.ReactElement {
  const url = path ? overlayMediaUrl(path) : ''
  return (
    <div>
      <p className="label">{type === 'video' ? 'Video' : 'Image'}</p>
      <button
        type="button"
        onClick={onPick}
        className="group flex w-full items-center gap-3 rounded-lg bg-surface p-1.5 text-left transition-colors hover:bg-surface-tertiary"
      >
        <span className="grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-md bg-black">
          {url && type === 'video' && <video src={`${url}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />}
          {url && type === 'image' && <img src={url} alt="" className="h-full w-full object-cover" />}
          {!url && <Plus size={14} className="text-slate-500" aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-slate-200" title={path || undefined}>
            {path ? path.split(/[\\/]/).pop() : `Choose ${type === 'video' ? 'a video' : 'an image'}`}
          </span>
          {path && <span className="block text-[11px] text-slate-500 group-hover:text-slate-400">Change…</span>}
        </span>
      </button>
    </div>
  )
}
