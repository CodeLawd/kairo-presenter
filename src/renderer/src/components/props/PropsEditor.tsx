import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Circle,
  Image,
  Layers,
  Plus,
  Square,
  TextT,
  Trash2,
  X,
} from '@/icons'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { MacTrafficLights } from '@/components/shared/MacTrafficLights'
import { PropPreview } from './PropPreview'
import { useProgramState } from '@/hooks/useProgramState'
import { useDraftPresentation } from '@/components/operator/ProgramPanels'
import {
  MAX_PROP_OBJECTS,
  renderPropHTML,
  type ProgramProp,
  type PropObject,
  type PropObjectKind,
} from '@shared/program'
import { MIN_PROP_OBJECT_SIZE as MIN_SIZE, applyPropGesture, type PropGesture } from '@shared/prop-geometry'

const IS_MAC = navigator.platform.startsWith('Mac')

/** Overlays are laid out on a 1920-wide frame; the stage shows it at 16:9. */
const FRAME_W = 1920
const FRAME_H = 1080

const KIND_LABEL: Record<PropObjectKind, string> = { text: 'Text', shape: 'Shape', image: 'Image' }

const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const hexOr = (value: string, fallback: string): string => (/^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback)
const fileName = (path: string): string => path.split(/[/\\]/).pop() ?? path

/**
 * The Props editor, laid out like ProPresenter's: the props on the left, the
 * selected one on a 16:9 stage in the middle — add text, shapes and images,
 * drag to place, drag a corner to size — and what's selected on the right.
 * The stage draws with the same markup the screens use, so it looks the same.
 */
export default function PropsEditor({
  initialSelect,
  onClose,
}: {
  initialSelect: string | null
  onClose: () => void
}): React.ReactElement {
  const [presentation, setPresentation, flushPresentation] = useDraftPresentation()
  const [saving, setSaving] = useState(false)
  // Edits are kept as you go; Save writes any last one now and closes.
  const saveAndClose = async (): Promise<void> => {
    setSaving(true)
    try {
      await flushPresentation()
      onClose()
    } finally {
      setSaving(false)
    }
  }
  const program = useProgramState()
  const props = presentation.props
  const [selectedPropId, setSelectedPropId] = useState<string | null>(initialSelect ?? props[0]?.id ?? null)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const prop = props.find((p) => p.id === selectedPropId) ?? props[0] ?? null
  const object = prop?.objects.find((o) => o.id === selectedObjectId) ?? null

  // ── Writes ────────────────────────────────────────────────────────────────

  const latest = useRef(presentation)
  latest.current = presentation
  const setProps = useCallback(
    (next: ProgramProp[]): void => setPresentation({ ...latest.current, props: next }),
    [setPresentation],
  )
  const patchProp = useCallback(
    (id: string, patch: Partial<ProgramProp>): void =>
      setProps(latest.current.props.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    [setProps],
  )
  const patchObject = useCallback(
    (propId: string, objectId: string, patch: Partial<PropObject>): void =>
      setProps(latest.current.props.map((p) =>
        p.id === propId
          ? { ...p, objects: p.objects.map((o) => (o.id === objectId ? ({ ...o, ...patch } as PropObject) : o)) }
          : p,
      )),
    [setProps],
  )

  const addProp = (): void => {
    const id = newId('prop')
    const name = `Prop ${props.length + 1}`
    setProps([...props, { id, name, background: null, objects: [] }])
    setSelectedPropId(id)
    setSelectedObjectId(null)
  }
  const removeProp = (id: string): void => {
    if (program.activePropIds.includes(id)) void window.api.program.setProp(id, false)
    const next = props.filter((p) => p.id !== id)
    setProps(next)
    if (selectedPropId === id) {
      setSelectedPropId(next[0]?.id ?? null)
      setSelectedObjectId(null)
    }
  }
  const addObject = async (kind: 'text' | 'rectangle' | 'ellipse' | 'image'): Promise<void> => {
    if (!prop || prop.objects.length >= MAX_PROP_OBJECTS) return
    let added: PropObject
    if (kind === 'text') {
      added = { id: newId('text'), kind: 'text', text: 'Your text', fontSizePx: 96, color: '#ffffff', bold: true, align: 'center', x: 0.1, y: 0.4, w: 0.8, h: 0.2, opacity: 1 }
    } else if (kind === 'image') {
      const mediaPath = await window.api.program.pickImage()
      if (!mediaPath) return
      added = { id: newId('image'), kind: 'image', mediaPath, fit: 'contain', x: 0.35, y: 0.25, w: 0.3, h: 0.5, opacity: 1 }
    } else {
      added = { id: newId('shape'), kind: 'shape', shape: kind, fill: '#315ede', radiusPx: kind === 'rectangle' ? 24 : 0, x: 0.3, y: 0.3, w: 0.4, h: 0.4, opacity: 1 }
    }
    patchProp(prop.id, { objects: [...prop.objects, added] })
    setSelectedObjectId(added.id)
  }
  const removeObject = (objectId: string): void => {
    if (!prop) return
    patchProp(prop.id, { objects: prop.objects.filter((o) => o.id !== objectId) })
    setSelectedObjectId(null)
  }
  /** Moves an object one step toward the front (+1) or the back (-1). */
  const restack = (objectId: string, step: 1 | -1): void => {
    if (!prop) return
    const objects = [...prop.objects]
    const index = objects.findIndex((o) => o.id === objectId)
    const target = index + step
    if (index < 0 || target < 0 || target >= objects.length) return
    ;[objects[index], objects[target]] = [objects[target], objects[index]]
    patchProp(prop.id, { objects })
  }

  // ── Stage sizing ────────────────────────────────────────────────────────────

  const stageRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.4)
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const fit = (): void => {
      const pad = 48
      setScale(Math.max(0.1, Math.min((el.clientWidth - pad) / FRAME_W, (el.clientHeight - pad) / FRAME_H)))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const canvasW = FRAME_W * scale
  const canvasH = FRAME_H * scale

  // ── Dragging ────────────────────────────────────────────────────────────────

  const gesture = useRef<PropGesture | null>(null)
  const beginGesture = (event: React.PointerEvent, next: PropGesture): void => {
    event.stopPropagation()
    event.preventDefault()
    gesture.current = next
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    setSelectedObjectId(next.objectId)
  }
  const onPointerMove = (event: React.PointerEvent): void => {
    const current = gesture.current
    if (!current || !prop) return
    const box = applyPropGesture(current, (event.clientX - current.startX) / canvasW, (event.clientY - current.startY) / canvasH)
    patchObject(prop.id, current.objectId, box)
  }
  const endGesture = (event: React.PointerEvent): void => {
    gesture.current = null
    const target = event.currentTarget as HTMLElement
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
  }

  // Delete removes the selected object; arrows nudge it; Escape lets it go.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!prop || !object) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelectedObjectId(null)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        removeObject(object.id)
        return
      }
      const step = event.shiftKey ? 0.05 : 0.005
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
      if (!delta) return
      event.preventDefault()
      patchObject(prop.id, object.id, {
        x: clamp(object.x + delta[0], 0, 1 - object.w),
        y: clamp(object.y + delta[1], 0, 1 - object.h),
      })
    }
    // Capture phase: runs before the app's Escape-closes-the-window listener,
    // so Escape lets go of an object first and closes the window second.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const tools: Array<{ kind: 'text' | 'rectangle' | 'ellipse' | 'image'; label: string; icon: typeof TextT }> = [
    { kind: 'text', label: 'Text', icon: TextT },
    { kind: 'rectangle', label: 'Rectangle', icon: Square },
    { kind: 'ellipse', label: 'Ellipse', icon: Circle },
    { kind: 'image', label: 'Image', icon: Image },
  ]

  return (
    <div className="relative flex h-full w-full text-slate-200">
      {/* ── The props ─────────────────────────────────────────────────────── */}
      <div className="glass hairline-r flex w-[220px] min-h-0 shrink-0 flex-col" data-settings-drag>
        {IS_MAC && <MacTrafficLights onClose={onClose} className="px-[18px] pb-1 pt-[18px]" />}
        <div className="-mx-0 flex h-10 items-center gap-2 bg-surface-tertiary/50 px-3">
          <h2 className="min-w-0 flex-1 text-[14px] font-semibold text-white">Props</h2>
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-surface-elevated hover:text-white"
            aria-label="New prop"
            title="New prop"
            onClick={addProp}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        </div>
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2.5 py-2">
          {props.map((p) => {
            const selected = p.id === prop?.id
            const on = program.activePropIds.includes(p.id)
            return (
              <li key={p.id} className="group/prop relative">
                <button
                  type="button"
                  onClick={() => { setSelectedPropId(p.id); setSelectedObjectId(null) }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
                    selected ? 'bg-teal-500 text-on-accent' : 'hover:bg-surface-tertiary',
                  )}
                >
                  <PropPreview prop={p} width={44} className="rounded-[3px] ring-1 ring-black/30" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{p.name}</span>
                  {on && <span className="size-1.5 shrink-0 rounded-full bg-live" title="On screen" aria-label="On screen" />}
                </button>
                <button
                  type="button"
                  className="absolute right-1.5 top-1/2 hidden size-6 -translate-y-1/2 place-items-center rounded-md bg-surface-elevated text-slate-300 hover:text-red-400 group-hover/prop:grid"
                  aria-label={`Delete ${p.name}`}
                  title="Delete prop"
                  onClick={() => removeProp(p.id)}
                >
                  <Trash2 size={12} aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── The stage ─────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex shrink-0 items-center justify-center gap-1 px-4 pb-2 pt-3" data-settings-drag>
          <div className="flex items-center rounded-lg bg-surface-secondary p-0.5">
            {tools.map(({ kind, label, icon: Icon }) => (
              <button
                key={kind}
                type="button"
                disabled={!prop || (prop?.objects.length ?? 0) >= MAX_PROP_OBJECTS}
                onClick={() => void addObject(kind)}
                className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-slate-300 hover:bg-surface-tertiary hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
                title={`Add ${label.toLowerCase()}`}
              >
                <Icon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-hidden">
          {prop ? (
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm ring-1 ring-surface-border"
              style={{
                width: canvasW,
                height: canvasH,
                // Clear props show a checkerboard, as in ProPresenter.
                background: 'repeating-conic-gradient(rgb(var(--surface-stage)) 0% 25%, rgb(var(--surface-secondary)) 0% 50%) 0 0 / 24px 24px',
              }}
              onPointerDown={() => setSelectedObjectId(null)}
            >
              <div
                className="pointer-events-none absolute left-0 top-0 origin-top-left"
                style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})` }}
                dangerouslySetInnerHTML={{ __html: renderPropHTML(prop) }}
              />
              {prop.objects.map((o) => {
                const selected = o.id === object?.id
                return (
                  <div
                    key={o.id}
                    className={cn(
                      'absolute cursor-move',
                      selected ? 'ring-2 ring-teal-500' : 'hover:ring-1 hover:ring-white/50',
                    )}
                    style={{ left: o.x * canvasW, top: o.y * canvasH, width: o.w * canvasW, height: o.h * canvasH }}
                    onPointerDown={(e) => beginGesture(e, { kind: 'move', objectId: o.id, startX: e.clientX, startY: e.clientY, origin: o })}
                    onPointerMove={onPointerMove}
                    onPointerUp={endGesture}
                    onPointerCancel={endGesture}
                    aria-label={`${KIND_LABEL[o.kind]} object`}
                  >
                    {selected && (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
                      <span
                        key={corner}
                        className={cn(
                          'absolute size-2.5 rounded-sm bg-white ring-1 ring-teal-500',
                          corner === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                          corner === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                          corner === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                          corner === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
                        )}
                        onPointerDown={(e) => beginGesture(e, { kind: 'resize', objectId: o.id, corner, startX: e.clientX, startY: e.clientY, origin: o })}
                        onPointerMove={onPointerMove}
                        onPointerUp={endGesture}
                        onPointerCancel={endGesture}
                      />
                    ))}
                  </div>
                )
              })}
              {prop.objects.length === 0 && !prop.background && (
                <p className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-slate-400">
                  Add text, a shape or an image from the bar above.
                </p>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <span className="grid size-11 place-items-center rounded-full bg-surface-secondary text-slate-400">
                <Layers size={20} aria-hidden="true" />
              </span>
              <p className="text-[14px] font-semibold text-white">No props yet</p>
              <p className="max-w-[22rem] text-[12px] leading-relaxed text-slate-400">
                A prop sits over the slides — a logo in the corner, a welcome banner, a giving card. Build one here, then show it from Operator → Show.
              </p>
              <button type="button" className="btn-primary mt-1 flex items-center gap-1.5 px-3 py-1.5 text-[13px]" onClick={addProp}>
                <Plus size={13} aria-hidden="true" /> New prop
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── What's selected ───────────────────────────────────────────────── */}
      <div className="hairline-l flex w-[260px] shrink-0 flex-col bg-surface-secondary">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3.5 pb-4 pt-4" data-settings-drag>
          {prop && object && (
            <ObjectInspector
              object={object}
              index={prop.objects.indexOf(object)}
              count={prop.objects.length}
              onChange={(patch) => patchObject(prop.id, object.id, patch)}
              onRestack={(step) => restack(object.id, step)}
              onRemove={() => removeObject(object.id)}
            />
          )}
          {prop && !object && (
            <PropInspector
              prop={prop}
              onChange={(patch) => patchProp(prop.id, patch)}
              onSelectObject={setSelectedObjectId}
              onRemove={() => removeProp(prop.id)}
            />
          )}
        </div>
        {prop && (
          <div className="hairline-t shrink-0 p-3">
            <button
              type="button"
              className="btn-primary w-full py-1.5 text-[13px]"
              disabled={saving}
              onClick={() => void saveAndClose()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {!IS_MAC && (
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
          aria-label="Close props"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/** A label and its control on one row. */
function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-3 py-1.5 text-[12px] text-slate-300">
      <span className="shrink-0">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1.5">{children}</div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="space-y-1.5">
      <h3 className="px-1 text-[12px] font-semibold text-white">{title}</h3>
      <div className="pref-group pref-group-dim overflow-hidden rounded-lg bg-surface">{children}</div>
    </section>
  )
}

/** A percentage of the frame, typed as 0–100. */
function PercentInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (share: number) => void
}): React.ReactElement {
  return (
    <label className="flex items-center gap-1 text-[11px] text-slate-500">
      {label}
      <input
        type="number"
        className="input w-[52px] px-1.5 py-0.5 text-right text-[12px] tabular-nums"
        value={Math.round(value * 1000) / 10}
        min={min * 100}
        max={max * 100}
        step={0.5}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(clamp(next / 100, min, max))
        }}
      />
    </label>
  )
}

function PropInspector({
  prop,
  onChange,
  onSelectObject,
  onRemove,
}: {
  prop: ProgramProp
  onChange: (patch: Partial<ProgramProp>) => void
  onSelectObject: (id: string) => void
  onRemove: () => void
}): React.ReactElement {
  return (
    <>
      <Group title="Prop">
        <Row label="Name">
          <input
            className="input w-[140px] px-2 py-1 text-[12px]"
            value={prop.name}
            maxLength={80}
            aria-label="Prop name"
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </Row>
        <Row label="Background">
          <Switch
            checked={prop.background !== null}
            onCheckedChange={(on) => onChange({ background: on ? '#000000' : null })}
            aria-label="Background colour"
          />
          {prop.background !== null && (
            <input
              type="color"
              className="h-6 w-8 cursor-pointer rounded bg-transparent"
              value={hexOr(prop.background, '#000000')}
              aria-label="Background colour"
              onChange={(e) => onChange({ background: e.target.value })}
            />
          )}
        </Row>
      </Group>
      <Group title="Objects">
        {prop.objects.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-slate-500">Nothing yet. Add text, a shape or an image.</p>
        ) : (
          [...prop.objects].reverse().map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-slate-300 hover:bg-surface-tertiary hover:text-white"
              onClick={() => onSelectObject(o.id)}
            >
              <span className="w-12 shrink-0 text-slate-500">{KIND_LABEL[o.kind]}</span>
              <span className="min-w-0 truncate">
                {o.kind === 'text' ? o.text || 'Empty text' : o.kind === 'image' ? fileName(o.mediaPath) : o.shape === 'ellipse' ? 'Ellipse' : 'Rectangle'}
              </span>
            </button>
          ))
        )}
      </Group>
      <p className="px-1 text-[11px] leading-relaxed text-slate-500">
        Objects stack in this order, top of the list in front. Drag on the stage to place them; drag a corner to size them.
      </p>
      <button
        type="button"
        className="flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] text-slate-400 hover:bg-surface-tertiary hover:text-red-400"
        onClick={onRemove}
      >
        <Trash2 size={12} aria-hidden="true" /> Delete prop
      </button>
    </>
  )
}

function ObjectInspector({
  object,
  index,
  count,
  onChange,
  onRestack,
  onRemove,
}: {
  object: PropObject
  index: number
  count: number
  onChange: (patch: Partial<PropObject>) => void
  onRestack: (step: 1 | -1) => void
  onRemove: () => void
}): React.ReactElement {
  return (
    <>
      <div className="flex items-center justify-between px-1">
        <h3 className="text-[13px] font-semibold text-white">{KIND_LABEL[object.kind]}</h3>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-slate-400 hover:bg-surface-tertiary hover:text-red-400"
          onClick={onRemove}
        >
          <Trash2 size={12} aria-hidden="true" /> Delete
        </button>
      </div>

      {object.kind === 'text' && (
        <Group title="Text">
          <div className="px-3 py-2.5">
            <textarea
              className="input min-h-[64px] w-full resize-none px-2 py-1.5 text-[12px]"
              value={object.text}
              aria-label="Text"
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </div>
          <Row label="Size">
            <input
              type="number"
              className="input w-[64px] px-1.5 py-0.5 text-right text-[12px] tabular-nums"
              min={8}
              max={400}
              value={object.fontSizePx}
              aria-label="Text size"
              onChange={(e) => onChange({ fontSizePx: clamp(Number(e.target.value) || 8, 8, 400) })}
            />
          </Row>
          <Row label="Colour">
            <input type="color" className="h-6 w-8 cursor-pointer rounded bg-transparent" value={hexOr(object.color, '#ffffff')} aria-label="Text colour" onChange={(e) => onChange({ color: e.target.value })} />
          </Row>
          <Row label="Bold">
            <Switch checked={object.bold} onCheckedChange={(bold) => onChange({ bold })} aria-label="Bold" />
          </Row>
          <Row label="Align">
            <div className="flex rounded-md bg-surface-tertiary p-0.5">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([align, Icon]) => (
                <button
                  key={align}
                  type="button"
                  aria-label={`Align ${align}`}
                  aria-pressed={object.align === align}
                  className={cn('grid size-6 place-items-center rounded', object.align === align ? 'bg-teal-500 text-on-accent' : 'text-slate-400 hover:text-white')}
                  onClick={() => onChange({ align })}
                >
                  <Icon size={13} aria-hidden="true" />
                </button>
              ))}
            </div>
          </Row>
        </Group>
      )}

      {object.kind === 'shape' && (
        <Group title="Shape">
          <Row label="Shape">
            <SegmentedControl
              label="Shape"
              value={object.shape}
              options={[{ value: 'rectangle', label: 'Rectangle' }, { value: 'ellipse', label: 'Ellipse' }]}
              onChange={(shape) => onChange({ shape })}
              fit
              itemClassName="px-2 py-0.5 text-[11px] whitespace-nowrap"
            />
          </Row>
          <Row label="Fill">
            <input type="color" className="h-6 w-8 cursor-pointer rounded bg-transparent" value={hexOr(object.fill, '#315ede')} aria-label="Fill colour" onChange={(e) => onChange({ fill: e.target.value })} />
          </Row>
          {object.shape === 'rectangle' && (
            <Row label="Corners">
              <input
                type="range"
                min={0}
                max={200}
                value={object.radiusPx}
                aria-label="Corner rounding"
                className="w-24"
                onChange={(e) => onChange({ radiusPx: Number(e.target.value) })}
              />
            </Row>
          )}
        </Group>
      )}

      {object.kind === 'image' && (
        <Group title="Image">
          <Row label="File">
            <span className="min-w-0 truncate text-slate-400" title={object.mediaPath}>{fileName(object.mediaPath)}</span>
            <button
              type="button"
              className="btn-secondary shrink-0 px-2 py-0.5 text-[11px]"
              onClick={() => void window.api.program.pickImage().then((mediaPath) => mediaPath && onChange({ mediaPath }))}
            >
              Change
            </button>
          </Row>
          <Row label="Fit">
            <SegmentedControl
              label="Fit"
              value={object.fit}
              options={[{ value: 'contain', label: 'Whole' }, { value: 'cover', label: 'Fill' }]}
              onChange={(fit) => onChange({ fit })}
              fit
              itemClassName="px-2 py-0.5 text-[11px] whitespace-nowrap"
            />
          </Row>
        </Group>
      )}

      <Group title="Place">
        <Row label="Position">
          <PercentInput label="X" value={object.x} min={0} max={1 - object.w} onChange={(x) => onChange({ x })} />
          <PercentInput label="Y" value={object.y} min={0} max={1 - object.h} onChange={(y) => onChange({ y })} />
        </Row>
        <Row label="Size">
          <PercentInput label="W" value={object.w} min={MIN_SIZE} max={1 - object.x} onChange={(w) => onChange({ w })} />
          <PercentInput label="H" value={object.h} min={MIN_SIZE} max={1 - object.y} onChange={(h) => onChange({ h })} />
        </Row>
        <Row label="Opacity">
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(object.opacity * 100)}
            aria-label="Opacity"
            className="w-24"
            onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })}
          />
          <span className="w-8 text-right text-[11px] tabular-nums text-slate-500">{Math.round(object.opacity * 100)}%</span>
        </Row>
        <Row label="Order">
          <button
            type="button"
            className="btn-secondary flex items-center gap-1 px-2 py-0.5 text-[11px]"
            disabled={index >= count - 1}
            onClick={() => onRestack(1)}
          >
            <ArrowUp size={11} aria-hidden="true" /> Forward
          </button>
          <button
            type="button"
            className="btn-secondary flex items-center gap-1 px-2 py-0.5 text-[11px]"
            disabled={index <= 0}
            onClick={() => onRestack(-1)}
          >
            <ArrowDown size={11} aria-hidden="true" /> Back
          </button>
        </Row>
      </Group>
    </>
  )
}
