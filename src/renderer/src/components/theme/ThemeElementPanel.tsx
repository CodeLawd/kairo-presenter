import { ChevronDown, Copy, Eye, EyeOff, Trash2 } from '@/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { OverlayBox, OverlayElement } from '@shared/ipc'
import { clampOverlayBox, ELEMENT_BOX_MIN } from '@shared/overlay-boxes'
import { isLineElement, isMediaElement, overlayElementLabel } from '@shared/overlay-elements'
import { overlayShape } from '@shared/overlay-shapes'
import { ShapeMenuItems, ShapeThumb } from './ShapeGallery'
import { LabeledSegmented, MediaAdjustments, MediaPicker } from './fields'
import { NumberField } from './NumberField'
import { ColorOpacityField } from './ThemeTypePanel'

type ElementPatch = Partial<Omit<OverlayElement, 'id' | 'kind'>>
export type ReorderTarget = 'forward' | 'backward' | 'front' | 'back'

/** Inspector for one shape, image or video on the slide. */
export function ThemeElementPanel({
  element,
  onChange,
  onReorder,
  onDuplicate,
  onDelete,
  onPickMedia,
}: {
  element: OverlayElement
  onChange: (patch: ElementPatch) => void
  onReorder: (to: ReorderTarget) => void
  onDuplicate: () => void
  onDelete: () => void
  onPickMedia: () => void
}): React.ReactElement {
  const media = isMediaElement(element)
  const line = isLineElement(element)
  const shapeDef = element.kind === 'shape' ? overlayShape(element.shape) : null
  const label = overlayElementLabel(element)
  const setBox = (patch: Partial<OverlayBox>): void =>
    onChange({ box: clampOverlayBox({ ...element.box, ...patch }, ELEMENT_BOX_MIN) })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-white">{label}</p>
        <div className="flex items-center">
          {[
            { name: 'Duplicate', icon: Copy, run: onDuplicate },
            { name: 'Delete', icon: Trash2, run: onDelete },
          ].map(({ name, icon: Icon, run }) => (
            <button
              key={name}
              type="button"
              aria-label={`${name} ${label.toLowerCase()}`}
              data-tooltip={name}
              onClick={run}
              className="grid size-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-surface-tertiary hover:text-white"
            >
              <Icon size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      {media && (
        <>
          <MediaPicker type={element.kind as 'image' | 'video'} path={element.mediaPath ?? ''} onPick={onPickMedia} />
          <LabeledSegmented
            label="Fit"
            value={element.mediaFit}
            options={[
              { value: 'cover', label: 'Fill' },
              { value: 'contain', label: 'Fit' },
              { value: 'fill', label: 'Stretch' },
            ]}
            onChange={(mediaFit) => onChange({ mediaFit })}
          />
          {element.kind === 'video' && (
            <LabeledSegmented
              label="Playback"
              value={element.mediaLoop ? 'loop' : 'once'}
              options={[
                { value: 'loop', label: 'Loop' },
                { value: 'once', label: 'Play once' },
              ]}
              onChange={(v) => onChange({ mediaLoop: v === 'loop' })}
            />
          )}
        </>
      )}

      {shapeDef && (
        <div>
          <p className="mb-1 text-[11px] font-medium text-zinc-500">Shape</p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-full items-center gap-2 rounded-md bg-surface-tertiary px-2.5 text-[13px] text-zinc-100 transition-colors hover:bg-surface-elevated"
              >
                <ShapeThumb path={shapeDef.path} lineOnly={shapeDef.lineOnly} />
                <span className="flex-1 text-left">{shapeDef.label}</span>
                <ChevronDown size={14} className="text-zinc-500" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[60vh] w-[316px] overflow-y-auto p-2">
              <ShapeMenuItems
                includeBoxShapes={false}
                onPick={(pick) => {
                  const next = overlayShape(pick.shape)
                  if (!next) return
                  // Turning a shape into a line (or back) needs a visible stroke.
                  onChange(next.lineOnly && !element.stroke.enabled ? { shape: next.id, stroke: { ...element.stroke, enabled: true } } : { shape: next.id })
                }}
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {!media && (
        <>
          {!line && (
            <ColorOpacityField
              label="Fill"
              color={element.fill}
              opacity={element.fillOpacity}
              onColorChange={(fill) => onChange({ fill })}
              onOpacityChange={(fillOpacity) => onChange({ fillOpacity })}
            />
          )}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-zinc-500">{line ? 'Line' : 'Border'}</p>
              <button
                type="button"
                className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                aria-label={element.stroke.enabled ? `Hide ${line ? 'line' : 'border'}` : `Show ${line ? 'line' : 'border'}`}
                onClick={() => onChange({ stroke: { ...element.stroke, enabled: !element.stroke.enabled } })}
              >
                {element.stroke.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
            </div>
            <div className={cn('space-y-2', !element.stroke.enabled && 'pointer-events-none opacity-40')}>
              <ColorOpacityField
                label="Color"
                color={element.stroke.color}
                opacity={element.stroke.opacity}
                onColorChange={(color) => onChange({ stroke: { ...element.stroke, color } })}
                onOpacityChange={(opacity) => onChange({ stroke: { ...element.stroke, opacity } })}
              />
              <NumberField
                label="Width"
                value={element.stroke.widthPx}
                min={0}
                max={200}
                suffix="px"
                onChange={(widthPx) => onChange({ stroke: { ...element.stroke, widthPx } })}
              />
            </div>
          </div>
          {element.kind === 'rectangle' && (
            <NumberField label="Corner radius" value={element.radiusPx} min={0} max={1080} suffix="px" onChange={(radiusPx) => onChange({ radiusPx })} />
          )}
        </>
      )}

      <NumberField
        label="Rotation"
        value={element.rotationDeg}
        min={-180}
        max={180}
        suffix="°"
        onChange={(rotationDeg) => onChange({ rotationDeg })}
      />

      <NumberField
        label="Opacity"
        value={Math.round(element.opacity * 100)}
        min={0}
        max={100}
        suffix="%"
        onChange={(v) => onChange({ opacity: v / 100 })}
      />

      <div className="space-y-2">
        <p className="text-[11px] font-medium text-zinc-500">Position and size</p>
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={element.box.xPct} step={0.5} min={0} max={100} suffix="%" onChange={(xPct) => setBox({ xPct })} />
          <NumberField label="Y" value={element.box.yPct} step={0.5} min={0} max={100} suffix="%" onChange={(yPct) => setBox({ yPct })} />
          <NumberField label="Width" value={element.box.widthPct} step={0.5} min={ELEMENT_BOX_MIN.widthPct} max={100} suffix="%" onChange={(widthPct) => setBox({ widthPct })} />
          <NumberField label="Height" value={element.box.heightPct} step={0.5} min={ELEMENT_BOX_MIN.heightPct} max={100} suffix="%" onChange={(heightPct) => setBox({ heightPct })} />
        </div>
      </div>

      <div className="space-y-2">
        <LabeledSegmented
          label="Arrange"
          value={element.aboveText ? 'over' : 'under'}
          options={[
            { value: 'under', label: 'Under text' },
            { value: 'over', label: 'Over text' },
          ]}
          onChange={(v) => onChange({ aboveText: v === 'over' })}
        />
        <div className="grid grid-cols-4 gap-1">
          {([
            ['back', 'To back'],
            ['backward', 'Back'],
            ['forward', 'Forward'],
            ['front', 'To front'],
          ] as const).map(([to, text]) => (
            <button
              key={to}
              type="button"
              onClick={() => onReorder(to)}
              className="rounded-md bg-surface-tertiary px-1 py-1.5 text-[11px] text-slate-300 transition-colors hover:bg-surface-elevated hover:text-white"
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      {media && <MediaAdjustments bg={element} onChange={onChange} />}
    </div>
  )
}
