import { useState } from 'react'
import { ChevronDown, Eye, EyeOff } from '@/icons'
import { cn } from '@/lib/utils'
import type { OverlayBox, OverlayContentKind, OverlayTheme } from '@shared/ipc'
import { colorWithOpacity } from '@shared/overlay-template'
import type { OverlayLayerId } from './OverlayCanvas'
import { overlayLayerLabel } from '@shared/overlay-outputs'

function expandHex(value: string): string | null {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}

function parseColorParts(value: string): { hex: string; opacity: number } {
  const hex = expandHex(value)
  if (hex) return { hex, opacity: 1 }
  const rgba = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value.trim())
  if (rgba) {
    const r = Math.round(Number(rgba[1])).toString(16).padStart(2, '0')
    const g = Math.round(Number(rgba[2])).toString(16).padStart(2, '0')
    const b = Math.round(Number(rgba[3])).toString(16).padStart(2, '0')
    return {
      hex: `#${r}${g}${b}`,
      opacity: rgba[4] !== undefined ? Math.min(1, Math.max(0, Number(rgba[4]))) : 1,
    }
  }
  return { hex: '#030a14', opacity: 0.75 }
}

function FieldLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="mb-1 text-[11px] font-medium text-zinc-500">{children}</p>
}

function FieldShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex h-8 items-center gap-2 rounded-md bg-surface-tertiary px-2.5 text-[13px] text-zinc-100',
        className
      )}
    >
      {children}
    </div>
  )
}

function CompactNumber({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  max?: number
  suffix?: string
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <FieldShell>
        <input
          type="number"
          className="h-full w-full bg-transparent text-sm outline-none tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          value={Number.isFinite(value) ? value : 0}
          step={step}
          min={min}
          max={max}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (!Number.isFinite(next)) return
            let clamped = next
            if (min !== undefined) clamped = Math.max(min, clamped)
            if (max !== undefined) clamped = Math.min(max, clamped)
            onChange(clamped)
          }}
          aria-label={label}
        />
        {suffix && <span className="shrink-0 text-xs text-zinc-500">{suffix}</span>}
      </FieldShell>
    </div>
  )
}

function ColorOpacityField({
  label,
  color,
  opacity,
  onColorChange,
  onOpacityChange,
}: {
  label: string
  color: string
  opacity: number
  onColorChange: (color: string) => void
  onOpacityChange: (opacity: number) => void
}): React.ReactElement {
  const swatch = expandHex(color) ?? '#000000'
  const hexDisplay = (expandHex(color) ?? color.replace(/^#/, '')).replace(/^#/, '').toUpperCase()
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <FieldShell className="gap-2">
        <input
          type="color"
          value={swatch}
          onChange={(event) => onColorChange(event.target.value)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
          aria-label={`${label} swatch`}
        />
        <input
          type="text"
          value={hexDisplay}
          spellCheck={false}
          onChange={(event) => {
            const raw = event.target.value.trim().replace(/^#/, '')
            if (/^[0-9a-fA-F]{0,6}$/.test(raw)) onColorChange(`#${raw}`)
          }}
          onBlur={() => {
            const expanded = expandHex(color.startsWith('#') ? color : `#${color}`)
            if (expanded) onColorChange(expanded)
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs uppercase outline-none"
          aria-label={`${label} hex`}
        />
        <div className="flex shrink-0 items-center gap-0.5 pl-1.5">
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(opacity * 100)}
            onChange={(event) => {
              const pct = Number(event.target.value)
              if (!Number.isFinite(pct)) return
              onOpacityChange(Math.min(100, Math.max(0, pct)) / 100)
            }}
            className="w-10 bg-transparent text-right text-xs tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            aria-label={`${label} opacity`}
          />
          <span className="text-xs text-zinc-500">%</span>
        </div>
      </FieldShell>
    </div>
  )
}

function CollapsibleSection({
  title,
  open,
  onOpenChange,
  trailing,
  children,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trailing?: React.ReactNode
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => onOpenChange(!open)}
          aria-expanded={open}
        >
          <ChevronDown
            size={13}
            className={cn('shrink-0 text-zinc-600 transition-transform', open ? 'rotate-0' : '-rotate-90')}
          />
          <span className="truncate text-[12px] font-semibold tracking-wide text-zinc-300">{title}</span>
        </button>
        {trailing}
      </div>
      {open && <div className="space-y-3">{children}</div>}
    </section>
  )
}

function CompactSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  format?: (value: number) => string
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[11px] font-medium text-zinc-500">{label}</p>
        <span className="text-[11px] tabular-nums text-zinc-500">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-elevated [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
        aria-label={label}
      />
    </div>
  )
}

interface ThemeLayoutPanelProps {
  theme: OverlayTheme
  contentKind: OverlayContentKind
  selectedLayer: OverlayLayerId
  onSelectLayer: (id: OverlayLayerId) => void
  onApplyPreset: (position: OverlayTheme['layout']['position']) => void
  onUpdateLayout: (partial: Partial<OverlayTheme['layout']>) => void
  onUpdateBox: (id: OverlayLayerId, box: OverlayBox) => void
  onUpdatePresetWidth: (maxWidthPct: number) => void
}

export function ThemeLayoutPanel({
  theme,
  contentKind,
  selectedLayer,
  onSelectLayer,
  onApplyPreset,
  onUpdateLayout,
  onUpdateBox,
  onUpdatePresetWidth,
}: ThemeLayoutPanelProps): React.ReactElement {
  const [placementOpen, setPlacementOpen] = useState(true)
  const [boxOpen, setBoxOpen] = useState(true)
  const [backdropOpen, setBackdropOpen] = useState(true)

  const layer = selectedLayer === 'reference' ? 'reference' : 'verse'
  const box = theme[layer].box
  const backdrop = parseColorParts(theme.layout.backdropColor)

  const setBoxField = (field: keyof OverlayBox, value: number): void => {
    onUpdateBox(layer, { ...box, [field]: value })
  }

  return (
    <div className="space-y-5">
      <CollapsibleSection title="Placement" open={placementOpen} onOpenChange={setPlacementOpen}>
        <div>
          <FieldLabel>Position</FieldLabel>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-0.5">
            {(
              [
                { value: 'lower-third', label: 'Lower third' },
                { value: 'center', label: 'Center' },
                { value: 'top', label: 'Top' },
                { value: 'full', label: 'Fullscreen' },
              ] as const
            ).map((opt) => {
              const active = theme.layout.position === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onApplyPreset(opt.value)}
                  className={cn(
                    'rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                    active ? 'bg-surface-elevated text-white' : 'text-zinc-500 hover:text-zinc-300'
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className={cn('grid gap-2', theme.layout.position === 'full' ? 'grid-cols-1' : 'grid-cols-2')}>
          {theme.layout.position !== 'full' && (
            <CompactSlider
              label="Width"
              value={theme.layout.maxWidthPct}
              onChange={onUpdatePresetWidth}
              min={20}
              max={100}
              format={(v) => `${v}%`}
            />
          )}
          <CompactSlider
            label="Padding"
            value={theme.layout.paddingPx}
            onChange={(paddingPx) => onUpdateLayout({ paddingPx })}
            min={0}
            max={200}
            format={(v) => `${v}px`}
          />
        </div>
      </CollapsibleSection>


      <CollapsibleSection title="Selected box" open={boxOpen} onOpenChange={setBoxOpen}>
        <div className="flex gap-1 rounded-lg bg-surface p-0.5">
          {([
            { id: 'verse' as const, label: overlayLayerLabel(contentKind, 'verse') },
            { id: 'reference' as const, label: overlayLayerLabel(contentKind, 'reference') },
          ]).map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={item.id === 'reference' && !theme.reference.show}
              onClick={() => onSelectLayer(item.id)}
              className={cn(
                'flex-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:opacity-40',
                selectedLayer === item.id
                  ? 'bg-surface-elevated text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <CompactNumber
            label="X"
            value={Number(box.xPct.toFixed(1))}
            step={0.5}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => setBoxField('xPct', v)}
          />
          <CompactNumber
            label="Y"
            value={Number(box.yPct.toFixed(1))}
            step={0.5}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => setBoxField('yPct', v)}
          />
          <CompactNumber
            label="Width"
            value={Number(box.widthPct.toFixed(1))}
            step={0.5}
            min={8}
            max={100}
            suffix="%"
            onChange={(v) => setBoxField('widthPct', v)}
          />
          <CompactNumber
            label="Height"
            value={Number(box.heightPct.toFixed(1))}
            step={0.5}
            min={6}
            max={100}
            suffix="%"
            onChange={(v) => setBoxField('heightPct', v)}
          />
        </div>
      </CollapsibleSection>


      <CollapsibleSection
        title="Backdrop"
        open={backdropOpen}
        onOpenChange={setBackdropOpen}
        trailing={
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:text-zinc-200"
            aria-label={theme.layout.backdropBox ? 'Hide backdrop' : 'Show backdrop'}
            onClick={() => onUpdateLayout({ backdropBox: !theme.layout.backdropBox })}
          >
            {theme.layout.backdropBox ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        }
      >
        <div className={cn('space-y-3', !theme.layout.backdropBox && 'pointer-events-none opacity-40')}>
          <ColorOpacityField
            label="Color"
            color={backdrop.hex}
            opacity={backdrop.opacity}
            onColorChange={(hex) =>
              onUpdateLayout({ backdropColor: colorWithOpacity(hex, backdrop.opacity) })
            }
            onOpacityChange={(opacity) =>
              onUpdateLayout({ backdropColor: colorWithOpacity(backdrop.hex, opacity) })
            }
          />
        </div>
      </CollapsibleSection>
    </div>
  )
}
