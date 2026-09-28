import { useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronDown,
  Eye,
  EyeOff,
  Minus,
} from '@/icons'
import { cn } from '@/lib/utils'
import type {
  OverlayContentKind,
  OverlayTextAlign,
  OverlayTextDecoration,
  OverlayTextOutline,
  OverlayTextShadow,
  OverlayTextStyle,
  OverlayTextTransform,
  OverlayTheme,
  OverlayVerticalAlign,
} from '@shared/ipc'
import type { OverlayLayerId } from './OverlayCanvas'
import { overlayLayerLabel } from '@shared/overlay-outputs'

const FONT_STACKS: Array<{ label: string; value: string }> = [
  { label: 'Helvetica Neue', value: "'Helvetica Neue', Arial, sans-serif" },
  { label: 'Inter', value: "Inter, system-ui, sans-serif" },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Palatino', value: "Palatino, 'Palatino Linotype', serif" },
  { label: 'Avenir Next', value: "'Avenir Next', Avenir, sans-serif" },
  { label: 'Futura', value: "Futura, 'Trebuchet MS', sans-serif" },
  { label: 'Courier', value: "'Courier New', Courier, monospace" },
]

const WEIGHTS: Array<{ label: string; value: number }> = [
  { label: 'Thin', value: 100 },
  { label: 'Extra Light', value: 200 },
  { label: 'Light', value: 300 },
  { label: 'Regular', value: 400 },
  { label: 'Medium', value: 500 },
  { label: 'Semibold', value: 600 },
  { label: 'Bold', value: 700 },
  { label: 'Extra Bold', value: 800 },
  { label: 'Black', value: 900 },
]

const SIZE_PRESETS = [18, 24, 28, 32, 36, 42, 48, 54, 60, 72, 84, 96, 120]

function nearestWeight(weight: number): number {
  return WEIGHTS.reduce((best, item) =>
    Math.abs(item.value - weight) < Math.abs(best - weight) ? item.value : best
  , WEIGHTS[0].value)
}

function expandHex(value: string): string | null {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
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
        'flex h-8 items-center gap-2 rounded-md bg-zinc-800 px-2.5 text-sm text-zinc-100',
        className
      )}
    >
      {children}
    </div>
  )
}

function CompactSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
}): React.ReactElement {
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <FieldShell className="relative pr-8">
        <select
          className="h-full w-full appearance-none bg-transparent text-sm outline-none"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-zinc-900 text-zinc-100">
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-zinc-500" />
      </FieldShell>
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
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <FieldShell>
        {icon}
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
            if (/^[0-9a-fA-F]{0,6}$/.test(raw)) {
              onColorChange(raw.length === 6 || raw.length === 3 ? `#${raw}` : `#${raw}`)
            }
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

function IconToggleGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: Array<{ value: T; label: string; node: React.ReactNode }>
  onChange: (value: T) => void
  ariaLabel: string
}): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-8 gap-0.5 rounded-md bg-zinc-800 p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'flex flex-1 items-center justify-center rounded-sm text-zinc-500 transition-colors',
              active ? 'bg-zinc-700 text-zinc-100' : 'hover:text-zinc-300'
            )}
          >
            {opt.node}
          </button>
        )
      })}
    </div>
  )
}

function SectionHeader({
  title,
  open,
  onOpenChange,
  trailing,
}: {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  trailing?: React.ReactNode
}): React.ReactElement {
  return (
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
      <SectionHeader title={title} open={open} onOpenChange={onOpenChange} trailing={trailing} />
      {open && <div className="space-y-3">{children}</div>}
    </section>
  )
}

function TextFormatFields({
  style,
  showSize,
  onChange,
}: {
  style: OverlayTextStyle
  showSize: boolean
  onChange: (partial: Partial<OverlayTextStyle>) => void
}): React.ReactElement {
  const weight = nearestWeight(style.fontWeight)
  const sizeValue = String(style.fontSizePx)
  const sizeOptions = [
    ...SIZE_PRESETS.map((px) => ({ label: `${px}`, value: String(px) })),
    ...(!SIZE_PRESETS.includes(style.fontSizePx)
      ? [{ label: `${style.fontSizePx}`, value: String(style.fontSizePx) }]
      : []),
  ]

  return (
    <div className="space-y-3">
      <CompactSelect
        label="Font"
        value={style.fontFamily}
        options={FONT_STACKS}
        onChange={(fontFamily) => onChange({ fontFamily })}
      />

      <div className={cn('grid gap-2', showSize ? 'grid-cols-2' : 'grid-cols-1')}>
        <CompactSelect
          label="Weight"
          value={String(weight)}
          options={WEIGHTS.map((item) => ({ label: item.label, value: String(item.value) }))}
          onChange={(next) => onChange({ fontWeight: Number(next) })}
        />
        {showSize && (
          <CompactSelect
            label="Size"
            value={sizeValue}
            options={sizeOptions}
            onChange={(next) => onChange({ fontSizePx: Number(next) })}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <CompactNumber
          label="Line height"
          value={Number(style.lineHeight.toFixed(2))}
          step={0.05}
          min={0.9}
          max={2.5}
          onChange={(lineHeight) => onChange({ lineHeight })}
          icon={<span className="text-[10px] font-bold text-zinc-500">↕</span>}
        />
        <CompactNumber
          label="Letter spacing"
          value={Number(style.letterSpacingPx.toFixed(1))}
          step={0.5}
          min={-4}
          max={20}
          suffix="px"
          onChange={(letterSpacingPx) => onChange({ letterSpacingPx })}
          icon={<span className="text-[10px] font-bold tracking-widest text-zinc-500">VA</span>}
        />
      </div>

      <ColorOpacityField
        label="Color"
        color={style.color}
        opacity={style.colorOpacity}
        onColorChange={(color) => onChange({ color })}
        onOpacityChange={(colorOpacity) => onChange({ colorOpacity })}
      />

      <div className="grid grid-cols-[1.2fr_1fr] gap-2">
        <div>
          <FieldLabel>Alignment</FieldLabel>
          <IconToggleGroup<OverlayTextAlign>
            ariaLabel="Horizontal alignment"
            value={style.align}
            onChange={(align) => onChange({ align })}
            options={[
              { value: 'left', label: 'Left', node: <AlignLeft size={14} /> },
              { value: 'center', label: 'Center', node: <AlignCenter size={14} /> },
              { value: 'right', label: 'Right', node: <AlignRight size={14} /> },
              { value: 'justify', label: 'Justify', node: <AlignJustify size={14} /> },
            ]}
          />
        </div>
        <div>
          <FieldLabel>Vertical</FieldLabel>
          <IconToggleGroup<OverlayVerticalAlign>
            ariaLabel="Vertical alignment"
            value={style.verticalAlign}
            onChange={(verticalAlign) => onChange({ verticalAlign })}
            options={[
              { value: 'top', label: 'Top', node: <span className="text-[11px] font-bold">T</span> },
              { value: 'middle', label: 'Middle', node: <span className="text-[11px] font-bold">M</span> },
              { value: 'bottom', label: 'Bottom', node: <span className="text-[11px] font-bold">B</span> },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Decoration</FieldLabel>
          <IconToggleGroup<OverlayTextDecoration>
            ariaLabel="Text decoration"
            value={style.textDecoration}
            onChange={(textDecoration) => onChange({ textDecoration })}
            options={[
              { value: 'none', label: 'None', node: <Minus size={14} /> },
              { value: 'underline', label: 'Underline', node: <span className="text-[11px] font-semibold underline">U</span> },
              {
                value: 'line-through',
                label: 'Strikethrough',
                node: <span className="text-[11px] font-semibold line-through">S</span>,
              },
            ]}
          />
        </div>
        <div>
          <FieldLabel>Case</FieldLabel>
          <IconToggleGroup<OverlayTextTransform>
            ariaLabel="Text case"
            value={style.textTransform}
            onChange={(textTransform) => onChange({ textTransform })}
            options={[
              { value: 'none', label: 'As typed', node: <Minus size={14} /> },
              { value: 'uppercase', label: 'Uppercase', node: <span className="text-[10px] font-bold">PB</span> },
              { value: 'capitalize', label: 'Capitalize', node: <span className="text-[10px] font-bold">Pb</span> },
              { value: 'lowercase', label: 'Lowercase', node: <span className="text-[10px] font-bold">pb</span> },
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function EffectsFields({
  shadow,
  outline,
  onShadowChange,
  onOutlineChange,
}: {
  shadow: OverlayTextShadow
  outline: OverlayTextOutline
  onShadowChange: (partial: Partial<OverlayTextShadow>) => void
  onOutlineChange: (partial: Partial<OverlayTextOutline>) => void
}): React.ReactElement {
  const [shadowOpen, setShadowOpen] = useState(true)
  const [outlineOpen, setOutlineOpen] = useState(true)

  return (
    <div className="space-y-5">
      <CollapsibleSection
        title="Drop Shadow"
        open={shadowOpen}
        onOpenChange={setShadowOpen}
        trailing={
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:text-zinc-200"
            aria-label={shadow.enabled ? 'Hide drop shadow' : 'Show drop shadow'}
            onClick={() => onShadowChange({ enabled: !shadow.enabled })}
          >
            {shadow.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        }
      >
        <div className={cn('space-y-3', !shadow.enabled && 'pointer-events-none opacity-40')}>
          <div className="grid grid-cols-2 gap-2">
            <CompactNumber label="X" value={shadow.xPx} min={-40} max={40} onChange={(xPx) => onShadowChange({ xPx })} />
            <CompactNumber label="Y" value={shadow.yPx} min={-40} max={40} onChange={(yPx) => onShadowChange({ yPx })} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-[11px] font-medium text-zinc-500">Blur</p>
              <span className="text-[11px] tabular-nums text-zinc-500">{shadow.blurPx}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={80}
              step={1}
              value={shadow.blurPx}
              onChange={(event) => onShadowChange({ blurPx: Number(event.target.value) })}
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 accent-orange-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-orange-500"
              aria-label="Shadow blur"
            />
          </div>
          <ColorOpacityField
            label="Color"
            color={shadow.color}
            opacity={shadow.opacity}
            onColorChange={(color) => onShadowChange({ color })}
            onOpacityChange={(opacity) => onShadowChange({ opacity })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Outline"
        open={outlineOpen}
        onOpenChange={setOutlineOpen}
        trailing={
          <button
            type="button"
            className="rounded p-1 text-zinc-500 hover:text-zinc-200"
            aria-label={outline.enabled ? 'Hide outline' : 'Show outline'}
            onClick={() => onOutlineChange({ enabled: !outline.enabled })}
          >
            {outline.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        }
      >
        <div className={cn('space-y-3', !outline.enabled && 'pointer-events-none opacity-40')}>
          <div className="grid grid-cols-2 gap-2">
            <CompactSelect
              label="Position"
              value={outline.position}
              options={[
                { label: 'Outside', value: 'outside' },
                { label: 'Center', value: 'center' },
                { label: 'Inside', value: 'inside' },
              ]}
              onChange={(position) =>
                onOutlineChange({ position: position as OverlayTextOutline['position'] })
              }
            />
            <CompactNumber
              label="Width"
              value={outline.widthPx}
              min={0}
              max={24}
              suffix="px"
              onChange={(widthPx) => onOutlineChange({ widthPx, enabled: widthPx > 0 ? true : outline.enabled })}
            />
          </div>
          <CompactSelect
            label="Style"
            value={outline.style}
            options={[
              { label: 'Solid', value: 'solid' },
              { label: 'Dashed', value: 'dashed' },
              { label: 'Dotted', value: 'dotted' },
            ]}
            onChange={(style) => onOutlineChange({ style: style as OverlayTextOutline['style'] })}
          />
          <ColorOpacityField
            label="Color"
            color={outline.color}
            opacity={outline.opacity}
            onColorChange={(color) => onOutlineChange({ color })}
            onOpacityChange={(opacity) => onOutlineChange({ opacity })}
          />
        </div>
      </CollapsibleSection>
    </div>
  )
}

interface ThemeTypePanelProps {
  theme: OverlayTheme
  /** Names the two layers — "Reference" means nothing on a lyric slide. */
  contentKind: OverlayContentKind
  selectedLayer: OverlayLayerId
  onSelectLayer: (id: OverlayLayerId) => void
  onUpdateLayer: (id: OverlayLayerId, partial: Partial<OverlayTextStyle>) => void
  onUpdateReferenceMeta: (partial: Partial<Pick<OverlayTheme['reference'], 'show' | 'position'>>) => void
  onAutoFitChange: (autoFitText: boolean) => void
}

export function ThemeTypePanel({
  theme,
  contentKind,
  selectedLayer,
  onSelectLayer,
  onUpdateLayer,
  onUpdateReferenceMeta,
  onAutoFitChange,
}: ThemeTypePanelProps): React.ReactElement {
  const [scriptureOpen, setScriptureOpen] = useState(true)
  const [effectsOpen, setEffectsOpen] = useState(true)
  const layer = selectedLayer === 'reference' ? theme.reference : theme.verse
  const title = overlayLayerLabel(contentKind, selectedLayer === 'reference' ? 'reference' : 'verse')
  const referenceLabel = overlayLayerLabel(contentKind, 'reference')

  return (
    <div className="space-y-5">
      <div className="flex gap-1 rounded-md bg-zinc-800 p-0.5">
        {([
          { id: 'verse' as const, label: overlayLayerLabel(contentKind, 'verse') },
          { id: 'reference' as const, label: referenceLabel },
        ]).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectLayer(item.id)}
            className={cn(
              'flex-1 rounded-sm px-2 py-1.5 text-[11px] font-semibold transition-colors',
              selectedLayer === item.id
                ? 'bg-zinc-700 text-zinc-50'
                : 'text-zinc-500 hover:text-zinc-300'
            )}
          >
            {item.label}
            {item.id === 'reference' && !theme.reference.show && (
              <span className="ml-1 text-[9px] font-medium text-zinc-600">off</span>
            )}
          </button>
        ))}
      </div>

      {/* Visible on both layer tabs — hiding this line is the most common edit
          and burying it under the layer it removes made it unfindable. */}
      {(
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-zinc-200">Show {referenceLabel.toLowerCase()}</p>
            <p className="text-[10px] text-zinc-500">
              {theme.reference.show
                ? `Hide to drop the ${referenceLabel.toLowerCase()} from output`
                : `Turn on to show the ${referenceLabel.toLowerCase()} again`}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={theme.reference.show}
            aria-label={`Show ${referenceLabel.toLowerCase()}`}
            onClick={() => onUpdateReferenceMeta({ show: !theme.reference.show })}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full transition-colors',
              theme.reference.show ? 'bg-orange-500' : 'bg-zinc-700'
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                theme.reference.show && 'translate-x-4'
              )}
            />
          </button>
        </div>
      )}

      <CollapsibleSection title={title} open={scriptureOpen} onOpenChange={setScriptureOpen}>
        {selectedLayer === 'verse' && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] font-semibold text-zinc-200">Fit to box</p>
              <p className="text-[10px] leading-relaxed text-zinc-500">
                Fits long verses into the box. Short lines stay a natural size.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={theme.layout.autoFitText}
              onClick={() => onAutoFitChange(!theme.layout.autoFitText)}
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                theme.layout.autoFitText ? 'bg-orange-500' : 'bg-zinc-700'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                  theme.layout.autoFitText && 'translate-x-4'
                )}
              />
            </button>
          </div>
        )}
        <TextFormatFields
          style={layer}
          showSize={selectedLayer !== 'verse' || !theme.layout.autoFitText}
          onChange={(partial) => onUpdateLayer(selectedLayer, partial)}
        />
        {selectedLayer === 'reference' && theme.reference.show && (
          <CompactSelect
            label="Snap to verse"
            value={theme.reference.position}
            options={[
              { label: 'Above verse', value: 'above' },
              { label: 'Below verse', value: 'below' },
            ]}
            onChange={(position) =>
              onUpdateReferenceMeta({ position: position as 'above' | 'below' })
            }
          />
        )}
      </CollapsibleSection>

      <div className="h-px bg-zinc-800" />

      <CollapsibleSection title="Effects" open={effectsOpen} onOpenChange={setEffectsOpen}>
        <EffectsFields
          shadow={layer.shadow}
          outline={layer.outline}
          onShadowChange={(partial) =>
            onUpdateLayer(selectedLayer, { shadow: { ...layer.shadow, ...partial } })
          }
          onOutlineChange={(partial) =>
            onUpdateLayer(selectedLayer, { outline: { ...layer.outline, ...partial } })
          }
        />
      </CollapsibleSection>
    </div>
  )
}
