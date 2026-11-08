import { useEffect, useId, useState } from 'react'
import { Popover } from 'radix-ui'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ObjectAlignBottom,
  ObjectAlignMiddle,
  ObjectAlignTop,
  Settings,
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
import { NumberField } from './NumberField'
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

function FontSizeField({ value, onChange }: { value: number; onChange: (value: number) => void }): React.ReactElement {
  const listId = useId()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  const commit = (): void => {
    const number = Number(draft)
    if (!draft.trim() || !Number.isFinite(number)) { setDraft(String(value)); return }
    const next = Math.max(12, Math.min(200, Math.round(number)))
    setDraft(String(next))
    if (next !== value) onChange(next)
  }
  return (
    <FieldShell>
      <input aria-label="Size" type="number" min={12} max={200} list={listId} value={draft}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        className="h-full w-full min-w-0 bg-transparent text-sm outline-none tabular-nums" />
      <datalist id={listId}>{SIZE_PRESETS.map((size) => <option key={size} value={size} />)}</datalist>
    </FieldShell>
  )
}

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
        'flex h-8 items-center gap-2 rounded-md bg-surface-tertiary px-2.5 text-[13px] text-zinc-100',
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
  disabled = false,
  describedBy,
  hideLabel = false,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  onChange: (value: string) => void
  disabled?: boolean
  describedBy?: string
  /** The field explains itself (a font name, a weight) — keep the label for screen readers only. */
  hideLabel?: boolean
}): React.ReactElement {
  return (
    <div className="min-w-0">
      {!hideLabel && <FieldLabel>{label}</FieldLabel>}
      <FieldShell className="relative pr-8">
        <select
          className="h-full w-full appearance-none bg-transparent text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          aria-describedby={describedBy}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={label}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} className="bg-surface-secondary text-zinc-100">
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-zinc-500" />
      </FieldShell>
    </div>
  )
}

export function ColorOpacityField({
  label,
  color,
  opacity,
  onColorChange,
  onOpacityChange,
  hideLabel = false,
}: {
  label: string
  color: string
  opacity: number
  onColorChange: (color: string) => void
  onOpacityChange: (opacity: number) => void
  hideLabel?: boolean
}): React.ReactElement {
  const swatch = expandHex(color) ?? '#000000'
  const hexDisplay = (expandHex(color) ?? color.replace(/^#/, '')).replace(/^#/, '').toUpperCase()
  return (
    <div className="min-w-0">
      {!hideLabel && <FieldLabel>{label}</FieldLabel>}
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
    <div role="group" aria-label={ariaLabel} className="flex h-7 gap-0.5 rounded-md bg-surface-tertiary p-0.5">
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
              'flex flex-1 items-center justify-center rounded text-zinc-400 transition-colors',
              active ? 'bg-teal-500 text-on-accent' : 'hover:text-zinc-100',
            )}
          >
            {opt.node}
          </button>
        )
      })}
    </div>
  )
}

/** One section of the inspector, split from the next by a full-width line — as ProPresenter does. */
function Section({ children }: { children: React.ReactNode }): React.ReactElement {
  return <section className="hairline-t -mx-4 space-y-2.5 px-4 py-3.5 first:pt-0 first:shadow-none">{children}</section>
}

/** A label on the left and its control on the right. */
function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }): React.ReactElement {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[12px] text-zinc-400" title={title}>{label}</span>
      {children}
    </div>
  )
}

/** A checkbox that turns an effect on and, while on, shows its settings — ProPresenter's Stroke and Shadow rows. */
function EffectToggle({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string
  enabled: boolean
  onToggle: (enabled: boolean) => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <Section>
      <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-zinc-200">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
          className="size-4 cursor-pointer rounded accent-[rgb(var(--control-accent))]"
        />
        {label}
      </label>
      {enabled && <div className="space-y-2.5 pt-1">{children}</div>}
    </Section>
  )
}

/** Line height and letter spacing: set once and rarely touched, so they live behind the gear. */
function SpacingPopover({
  style,
  onChange,
}: {
  style: OverlayTextStyle
  onChange: (partial: Partial<OverlayTextStyle>) => void
}): React.ReactElement {
  return (
    <Popover.Root>
      <Popover.Trigger
        className="flex h-7 w-11 shrink-0 items-center justify-center gap-0.5 rounded-md bg-surface-tertiary text-zinc-300 transition-colors hover:text-white data-[state=open]:bg-surface-elevated"
        aria-label="Spacing"
        title="Line height and letter spacing"
      >
        <Settings size={14} aria-hidden="true" />
        <ChevronDown size={10} aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 grid w-60 grid-cols-2 gap-2 rounded-lg bg-surface-tertiary p-3 text-zinc-200 animate-spring-in"
        >
          <NumberField
            label="Line height"
            value={Number(style.lineHeight.toFixed(2))}
            step={0.05}
            min={0.9}
            max={2.5}
            onChange={(lineHeight) => onChange({ lineHeight })}
          />
          <NumberField
            label="Letter spacing"
            value={Number(style.letterSpacingPx.toFixed(1))}
            step={0.5}
            min={-4}
            max={20}
            suffix="px"
            onChange={(letterSpacingPx) => onChange({ letterSpacingPx })}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Underline and strikethrough as two toggles; pressing the lit one turns it off. */
function DecorationToggles({
  value,
  onChange,
}: {
  value: OverlayTextDecoration
  onChange: (value: OverlayTextDecoration) => void
}): React.ReactElement {
  const options: Array<{ value: OverlayTextDecoration; label: string; node: React.ReactNode }> = [
    { value: 'underline', label: 'Underline', node: <span className="text-[12px] font-semibold underline">U</span> },
    { value: 'line-through', label: 'Strikethrough', node: <span className="text-[12px] font-semibold line-through">S</span> },
  ]
  return (
    <div role="group" aria-label="Text decoration" className="flex h-7 gap-0.5 rounded-md bg-surface-tertiary p-0.5">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.label}
            aria-label={opt.label}
            aria-pressed={active}
            onClick={() => onChange(active ? 'none' : opt.value)}
            className={cn(
              'w-8 rounded transition-colors',
              active ? 'bg-teal-500 text-on-accent' : 'text-zinc-400 hover:text-zinc-100',
            )}
          >
            {opt.node}
          </button>
        )
      })}
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

/**
 * The selected text layer's look, laid out like ProPresenter's Text inspector:
 * font, weight and size up top, then colour, sizing, alignment, and effects as
 * checkbox rows that open only when on. The layer itself is picked on the
 * slide or in the Layers list.
 */
export function ThemeTypePanel({
  theme,
  contentKind,
  selectedLayer,
  onUpdateLayer,
  onUpdateReferenceMeta,
  onAutoFitChange,
}: ThemeTypePanelProps): React.ReactElement {
  const isReference = selectedLayer === 'reference'
  const style = isReference ? theme.reference : theme.verse
  const referenceLabel = overlayLayerLabel(contentKind, 'reference')
  const automaticSize = !isReference && theme.layout.autoFitText
  const update = (partial: Partial<OverlayTextStyle>): void => onUpdateLayer(selectedLayer, partial)
  const weight = nearestWeight(style.fontWeight)

  return (
    <div>
      <Section>
        <p className="text-[13px] font-semibold text-zinc-100">{overlayLayerLabel(contentKind, isReference ? 'reference' : 'verse')}</p>
        {isReference && (
          <label className="flex cursor-pointer items-center gap-2.5 text-[13px] text-zinc-200">
            <input
              type="checkbox"
              checked={theme.reference.show}
              onChange={(event) => onUpdateReferenceMeta({ show: event.target.checked })}
              className="size-4 cursor-pointer rounded accent-[rgb(var(--control-accent))]"
            />
            Show {referenceLabel.toLowerCase()}
          </label>
        )}
      </Section>

      <Section>
        <CompactSelect hideLabel label="Font" value={style.fontFamily} options={FONT_STACKS} onChange={(fontFamily) => update({ fontFamily })} />
        <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
          <CompactSelect
            hideLabel
            label="Weight"
            value={String(weight)}
            options={WEIGHTS.map((item) => ({ label: item.label, value: String(item.value) }))}
            onChange={(next) => update({ fontWeight: Number(next) })}
          />
          <FontSizeField value={style.fontSizePx} onChange={(fontSizePx) => {
            if (automaticSize) onAutoFitChange(false)
            update({ fontSizePx })
          }} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <DecorationToggles value={style.textDecoration} onChange={(textDecoration) => update({ textDecoration })} />
          <SpacingPopover style={style} onChange={update} />
        </div>
        <Row label="Capitalization">
          <CompactSelect
            hideLabel
            label="Capitalization"
            value={style.textTransform}
            options={[
              { label: 'None', value: 'none' },
              { label: 'UPPERCASE', value: 'uppercase' },
              { label: 'Title Case', value: 'capitalize' },
              { label: 'lowercase', value: 'lowercase' },
            ]}
            onChange={(textTransform) => update({ textTransform: textTransform as OverlayTextTransform })}
          />
        </Row>
      </Section>

      <Section>
        <Row label="Text color">
          <ColorOpacityField
            hideLabel
            label="Text color"
            color={style.color}
            opacity={style.colorOpacity}
            onColorChange={(color) => update({ color })}
            onOpacityChange={(colorOpacity) => update({ colorOpacity })}
          />
        </Row>
      </Section>

      <Section>
        {isReference ? (
          <Row label="Position">
            <CompactSelect
              hideLabel
              label="Position"
              value={theme.reference.position}
              options={[
                { label: 'Above verse', value: 'above' },
                { label: 'Below verse', value: 'below' },
              ]}
              onChange={(position) => onUpdateReferenceMeta({ position: position as 'above' | 'below' })}
            />
          </Row>
        ) : (
          <Row label="Scaling" title="Fit to box sizes the text automatically to fill its box">
            <CompactSelect
              hideLabel
              label="Scaling"
              value={theme.layout.autoFitText ? 'fit' : 'none'}
              options={[
                { label: 'None', value: 'none' },
                { label: 'Fit to box', value: 'fit' },
              ]}
              onChange={(next) => onAutoFitChange(next === 'fit')}
            />
          </Row>
        )}
        {automaticSize && (
          <p className="text-[11px] text-zinc-400">
            Size follows the box. Enter a size to switch to manual sizing.
          </p>
        )}
      </Section>

      <Section>
        <IconToggleGroup<OverlayTextAlign>
          ariaLabel="Horizontal alignment"
          value={style.align}
          onChange={(align) => update({ align })}
          options={[
            { value: 'left', label: 'Left', node: <AlignLeft size={14} /> },
            { value: 'center', label: 'Center', node: <AlignCenter size={14} /> },
            { value: 'right', label: 'Right', node: <AlignRight size={14} /> },
            { value: 'justify', label: 'Justify', node: <AlignJustify size={14} /> },
          ]}
        />
        <IconToggleGroup<OverlayVerticalAlign>
          ariaLabel="Vertical alignment"
          value={style.verticalAlign}
          onChange={(verticalAlign) => update({ verticalAlign })}
          options={[
            { value: 'top', label: 'Top', node: <ObjectAlignTop size={14} /> },
            { value: 'middle', label: 'Middle', node: <ObjectAlignMiddle size={14} /> },
            { value: 'bottom', label: 'Bottom', node: <ObjectAlignBottom size={14} /> },
          ]}
        />
      </Section>

      <EffectToggle label="Shadow" enabled={style.shadow.enabled} onToggle={(enabled) => update({ shadow: { ...style.shadow, enabled } })}>
        <ShadowFields shadow={style.shadow} onChange={(partial) => update({ shadow: { ...style.shadow, ...partial } })} />
      </EffectToggle>

      <EffectToggle
        label="Stroke"
        enabled={style.outline.enabled}
        onToggle={(enabled) =>
          update({ outline: { ...style.outline, enabled, widthPx: enabled && style.outline.widthPx === 0 ? 2 : style.outline.widthPx } })
        }
      >
        <OutlineFields outline={style.outline} onChange={(partial) => update({ outline: { ...style.outline, ...partial } })} />
      </EffectToggle>
    </div>
  )
}

function ShadowFields({
  shadow,
  onChange,
}: {
  shadow: OverlayTextShadow
  onChange: (partial: Partial<OverlayTextShadow>) => void
}): React.ReactElement {
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="X" value={shadow.xPx} min={-40} max={40} onChange={(xPx) => onChange({ xPx })} />
        <NumberField label="Y" value={shadow.yPx} min={-40} max={40} onChange={(yPx) => onChange({ yPx })} />
        <NumberField label="Blur" value={shadow.blurPx} min={0} max={80} onChange={(blurPx) => onChange({ blurPx })} />
      </div>
      <Row label="Color">
        <ColorOpacityField
          hideLabel
          label="Shadow color"
          color={shadow.color}
          opacity={shadow.opacity}
          onColorChange={(color) => onChange({ color })}
          onOpacityChange={(opacity) => onChange({ opacity })}
        />
      </Row>
    </>
  )
}

function OutlineFields({
  outline,
  onChange,
}: {
  outline: OverlayTextOutline
  onChange: (partial: Partial<OverlayTextOutline>) => void
}): React.ReactElement {
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
        <CompactSelect
          label="Position"
          value={outline.position}
          options={[
            { label: 'Outside', value: 'outside' },
            { label: 'Center', value: 'center' },
            { label: 'Inside', value: 'inside' },
          ]}
          onChange={(position) => onChange({ position: position as OverlayTextOutline['position'] })}
        />
        <NumberField label="Width" value={outline.widthPx} min={0} max={24} suffix="px" onChange={(widthPx) => onChange({ widthPx })} />
      </div>
      <Row label="Style">
        <CompactSelect
          hideLabel
          label="Stroke style"
          value={outline.style}
          options={[
            { label: 'Solid', value: 'solid' },
            { label: 'Dashed', value: 'dashed' },
            { label: 'Dotted', value: 'dotted' },
          ]}
          onChange={(style) => onChange({ style: style as OverlayTextOutline['style'] })}
        />
      </Row>
      <Row label="Color">
        <ColorOpacityField
          hideLabel
          label="Stroke color"
          color={outline.color}
          opacity={outline.opacity}
          onColorChange={(color) => onChange({ color })}
          onOpacityChange={(opacity) => onChange({ opacity })}
        />
      </Row>
    </>
  )
}
