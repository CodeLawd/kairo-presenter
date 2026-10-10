import { useEffect, useRef, useState } from 'react'
import { X } from '@/icons'
import { cn } from '@/lib/utils'
import type { OverlayBox, OverlayContentKind, OverlayTheme } from '@shared/ipc'
import {
  ELEMENT_BOX_MIN,
  moveOverlayBox,
  resizeOverlayBox,
  resizeOverlayBoxKeepingAspect,
  TEXT_BOX_MIN,
  type BoxMinimum,
  type ResizeHandle,
} from '@shared/overlay-boxes'
import { overlayElementLabel } from '@shared/overlay-elements'
import { overlayLayerLabel } from '@shared/overlay-outputs'

/** The two text boxes. */
export type OverlayLayerId = 'verse' | 'reference'
/** Anything on the canvas: a text box, or an element by its id. */
export type CanvasLayerId = string

export function isTextLayer(id: CanvasLayerId | null): id is OverlayLayerId {
  return id === 'verse' || id === 'reference'
}

/** The box `id` occupies, or null when it is gone (a deleted element). */
export function layerBox(theme: OverlayTheme, id: CanvasLayerId): OverlayBox | null {
  if (id === 'verse') return theme.verse.box
  if (id === 'reference') return theme.reference.box
  return theme.elements.find((el) => el.id === id)?.box ?? null
}

function layerRotation(theme: OverlayTheme, id: CanvasLayerId): number {
  return theme.elements.find((el) => el.id === id)?.rotationDeg ?? 0
}

/** Shift while rotating snaps to this many degrees. */
const ROTATE_SNAP_DEG = 15

/**
 * A resize drag on a turned box: the pointer moves in screen space, the handles
 * in the box's own. Turn the pointer delta into the box's axes, resize there,
 * then move the centre back out so the opposite edge stays where it was.
 */
function resizeTurnedBox(
  start: OverlayBox,
  handle: ResizeHandle,
  dxPx: number,
  dyPx: number,
  frame: { width: number; height: number },
  rotationDeg: number,
  keepAspect: boolean,
  min: BoxMinimum,
): OverlayBox {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = dxPx * cos + dyPx * sin
  const localY = -dxPx * sin + dyPx * cos
  const resize = keepAspect ? resizeOverlayBoxKeepingAspect : resizeOverlayBox
  const next = resize(start, handle, (localX / frame.width) * 100, (localY / frame.height) * 100, min)
  if (!rotationDeg) return next

  const shiftX = ((next.xPct + next.widthPct / 2 - (start.xPct + start.widthPct / 2)) / 100) * frame.width
  const shiftY = ((next.yPct + next.heightPct / 2 - (start.yPct + start.heightPct / 2)) / 100) * frame.height
  const cx = start.xPct + start.widthPct / 2 + ((shiftX * cos - shiftY * sin) / frame.width) * 100
  const cy = start.yPct + start.heightPct / 2 + ((shiftX * sin + shiftY * cos) / frame.height) * 100
  return { ...next, xPct: cx - next.widthPct / 2, yPct: cy - next.heightPct / 2 }
}

function layerMinimum(id: CanvasLayerId): BoxMinimum {
  return isTextLayer(id) ? TEXT_BOX_MIN : ELEMENT_BOX_MIN
}

const HANDLES: ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
}

const HANDLE_CLASS: Record<ResizeHandle, string> = {
  n: 'left-1/2 top-0 -translate-x-1/2 -translate-y-1/2',
  s: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
  e: 'right-0 top-1/2 translate-x-1/2 -translate-y-1/2',
  w: 'left-0 top-1/2 -translate-x-1/2 -translate-y-1/2',
  ne: 'right-0 top-0 translate-x-1/2 -translate-y-1/2',
  nw: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
  se: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2',
  sw: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
}

interface OverlayCanvasProps {
  theme: OverlayTheme
  contentKind: OverlayContentKind
  selected: CanvasLayerId | null
  onSelect: (id: CanvasLayerId | null) => void
  onBoxChange: (id: CanvasLayerId, box: OverlayBox) => void
  /** Rotate handle on an element: its new angle, -180–180°. */
  onRotate?: (id: CanvasLayerId, deg: number) => void
  /** Hides the reference or deletes an element — the Delete key and the frame's × both call this. */
  onDeleteLayer: (id: CanvasLayerId) => void
  /** Double-click on a text box: open its text settings. */
  onEditLayer?: (id: OverlayLayerId) => void
}

/** How close (in % of the frame) a box centre has to come to the frame centre to snap. */
const SNAP_PCT = 1.5
/** Arrow-key nudge, and with Shift. */
const NUDGE_PCT = 0.5
const NUDGE_SHIFT_PCT = 5

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

/** Centres a moved box on the frame's axes when it comes close, and says which guides to draw. */
function snapToCentre(box: OverlayBox): { box: OverlayBox; v: boolean; h: boolean } {
  const cx = box.xPct + box.widthPct / 2
  const cy = box.yPct + box.heightPct / 2
  const v = Math.abs(cx - 50) < SNAP_PCT
  const h = Math.abs(cy - 50) < SNAP_PCT
  return {
    box: {
      ...box,
      xPct: v ? 50 - box.widthPct / 2 : box.xPct,
      yPct: h ? 50 - box.heightPct / 2 : box.yPct,
    },
    v,
    h,
  }
}

/**
 * The reference hides and elements delete. The verse box holds the content
 * itself, and the theme has no flag that would hide it, so Delete on it is a
 * no-op rather than an error.
 */
function isDeletable(id: CanvasLayerId): boolean {
  return id !== 'verse'
}

export function OverlayCanvas({
  theme,
  contentKind,
  selected,
  onSelect,
  onBoxChange,
  onRotate,
  onDeleteLayer,
  onEditLayer,
}: OverlayCanvasProps): React.ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState({ v: false, h: false })
  const dragRef = useRef<{
    id: CanvasLayerId
    mode: 'move' | 'resize' | 'rotate'
    handle?: ResizeHandle
    pointerId: number
    startX: number
    startY: number
    startBox: OverlayBox
    rotationDeg: number
  } | null>(null)
  const onBoxChangeRef = useRef(onBoxChange)
  onBoxChangeRef.current = onBoxChange
  const onRotateRef = useRef(onRotate)
  onRotateRef.current = onRotate
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const themeRef = useRef(theme)
  themeRef.current = theme
  const listenersRef = useRef<{
    move: (event: PointerEvent | MouseEvent) => void
    up: (event: Event) => void
  } | null>(null)

  const endDrag = (): void => {
    const drag = dragRef.current
    const listeners = listenersRef.current
    if (listeners) {
      window.removeEventListener('pointermove', listeners.move, true)
      window.removeEventListener('pointerup', listeners.up, true)
      window.removeEventListener('pointercancel', listeners.up, true)
      window.removeEventListener('mousemove', listeners.move, true)
      window.removeEventListener('mouseup', listeners.up, true)
      listenersRef.current = null
    }
    const frame = frameRef.current
    if (drag && frame?.hasPointerCapture(drag.pointerId)) {
      frame.releasePointerCapture(drag.pointerId)
    }
    dragRef.current = null
    setGuides({ v: false, h: false })
  }

  const applyPointer = (clientX: number, clientY: number, shift: boolean): void => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const min = layerMinimum(drag.id)
    if (drag.mode === 'rotate') {
      const box = drag.startBox
      const cx = rect.left + ((box.xPct + box.widthPct / 2) / 100) * rect.width
      const cy = rect.top + ((box.yPct + box.heightPct / 2) / 100) * rect.height
      // 0° with the pointer straight above the centre, clockwise positive.
      let deg = (Math.atan2(clientX - cx, cy - clientY) * 180) / Math.PI
      if (shift) deg = Math.round(deg / ROTATE_SNAP_DEG) * ROTATE_SNAP_DEG
      if (deg > 180) deg -= 360
      onRotateRef.current?.(drag.id, Math.round(deg))
      return
    }
    if (drag.mode === 'resize' && drag.handle) {
      const next = resizeTurnedBox(
        drag.startBox,
        drag.handle,
        clientX - drag.startX,
        clientY - drag.startY,
        rect,
        drag.rotationDeg,
        shift,
        min,
      )
      onBoxChangeRef.current(drag.id, next)
      return
    }
    const dxPct = ((clientX - drag.startX) / rect.width) * 100
    const dyPct = ((clientY - drag.startY) / rect.height) * 100
    const snapped = snapToCentre(moveOverlayBox(drag.startBox, dxPct, dyPct, min))
    setGuides((g) => (g.v === snapped.v && g.h === snapped.h ? g : { v: snapped.v, h: snapped.h }))
    onBoxChangeRef.current(drag.id, snapped.box)
  }

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    id: CanvasLayerId,
    mode: 'move' | 'resize' | 'rotate',
    handle?: ResizeHandle
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const box = layerBox(theme, id)
    if (!box) return

    endDrag()
    dragRef.current = {
      id,
      mode,
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startBox: { ...box },
      rotationDeg: layerRotation(theme, id),
    }
    onSelectRef.current(id)

    const frame = frameRef.current
    if (frame) {
      try {
        frame.setPointerCapture(event.pointerId)
      } catch {
        // Capture can fail if the pointer is already released.
      }
    }

    const move = (moveEvent: PointerEvent | MouseEvent): void => {
      if (!dragRef.current) return
      moveEvent.preventDefault()
      applyPointer(moveEvent.clientX, moveEvent.clientY, moveEvent.shiftKey)
    }
    const up = (): void => {
      endDrag()
    }
    listenersRef.current = { move, up }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('mousemove', move, true)
    window.addEventListener('mouseup', up, true)
  }

  // Canvas keys, the way any design tool behaves: Delete hides the reference,
  // arrows nudge, Esc deselects. Ignored while typing in a field.
  useEffect(() => {
    if (!selected) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTyping(event.target)) return
      if (event.key === 'Escape') {
        onSelectRef.current(null)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && isDeletable(selected)) {
        event.preventDefault()
        onDeleteLayer(selected)
        return
      }
      const step = event.shiftKey ? NUDGE_SHIFT_PCT : NUDGE_PCT
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const move = delta[event.key]
      if (!move) return
      // Read through the ref so the listener isn't re-attached on every drag frame.
      const box = layerBox(themeRef.current, selected)
      if (!box) return
      event.preventDefault()
      onBoxChangeRef.current(selected, moveOverlayBox(box, move[0], move[1], layerMinimum(selected)))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, onDeleteLayer])

  // Drawing order: elements under the text, the text, elements over it.
  const below = theme.elements.filter((el) => !el.aboveText)
  const above = theme.elements.filter((el) => el.aboveText)
  const layers: Array<{ id: CanvasLayerId; label: string; box: OverlayBox; z: number; rotationDeg?: number }> = [
    ...below.map((el, i) => ({ id: el.id, label: overlayElementLabel(el), box: el.box, z: 100 + i, rotationDeg: el.rotationDeg })),
    { id: 'verse', label: overlayLayerLabel(contentKind, 'verse'), box: theme.verse.box, z: 200 },
    ...(theme.reference.show
      ? [{ id: 'reference', label: overlayLayerLabel(contentKind, 'reference'), box: theme.reference.box, z: 210 }]
      : []),
    ...above.map((el, i) => ({ id: el.id, label: overlayElementLabel(el), box: el.box, z: 300 + i, rotationDeg: el.rotationDeg })),
  ]

  return (
    <div
      ref={frameRef}
      className="absolute inset-0 z-20 touch-none"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null)
      }}
    >
      {layers.map(({ id, label, box, z, rotationDeg }) => (
        <LayerFrame
          rotationDeg={onRotate ? rotationDeg : undefined}
          key={id}
          id={id}
          label={label}
          box={box}
          selected={selected === id}
          stacked={selected === id ? 1000 : z}
          deleteVerb={isTextLayer(id) ? 'Hide' : 'Delete'}
          onDelete={isDeletable(id) ? () => onDeleteLayer(id) : undefined}
          onPointerDown={beginDrag}
          onDoubleClick={onEditLayer && isTextLayer(id) ? () => onEditLayer(id) : undefined}
        />
      ))}
      {guides.v && <div className="pointer-events-none absolute inset-y-0 left-1/2 z-40 w-px -translate-x-1/2 bg-white/70" />}
      {guides.h && <div className="pointer-events-none absolute inset-x-0 top-1/2 z-40 h-px -translate-y-1/2 bg-white/70" />}
    </div>
  )
}

function LayerFrame({
  id,
  label,
  box,
  selected,
  stacked,
  rotationDeg,
  deleteVerb,
  onDelete,
  onPointerDown,
  onDoubleClick,
}: {
  id: CanvasLayerId
  label: string
  box: OverlayBox
  selected: boolean
  stacked: number
  /** Elements turn; text boxes don't, and get no rotate handle. */
  rotationDeg?: number
  deleteVerb: string
  /** Omitted for layers that cannot be hidden. */
  onDelete?: () => void
  onPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    id: CanvasLayerId,
    mode: 'move' | 'resize' | 'rotate',
    handle?: ResizeHandle
  ) => void
  onDoubleClick?: () => void
}): React.ReactElement | null {
  if (!box) return null

  // Like a design tool: boxes are invisible until hovered, so the slide reads as
  // the real thing. Hover shows the outline and name, selection adds handles.

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Move ${label}`}
      aria-pressed={selected}
      className={cn(
        'group/frame absolute cursor-move touch-none select-none bg-transparent outline-none ring-inset transition-shadow',
        selected ? 'ring-2 ring-white/90' : 'ring-0 hover:ring-1 hover:ring-white/50 focus-visible:ring-1 focus-visible:ring-white/50'
      )}
      style={{
        left: `${box.xPct}%`,
        top: `${box.yPct}%`,
        width: `${box.widthPct}%`,
        height: `${box.heightPct}%`,
        zIndex: stacked,
        pointerEvents: 'auto',
        transform: rotationDeg ? `rotate(${rotationDeg}deg)` : undefined,
      }}
      onPointerDown={(event) => onPointerDown(event, id, 'move')}
      onDoubleClick={onDoubleClick}
    >
      <span
        className={cn(
          'pointer-events-none absolute -top-5 left-0 z-10 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover/frame:opacity-100'
        )}
      >
        {label}
      </span>
      {selected && onDelete && (
        <button
          type="button"
          // The drag handler lives on pointerdown, so it has to be stopped here
          // or clicking × would start a drag before the click ever lands.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          title={`${deleteVerb} ${label} (Delete)`}
          aria-label={`${deleteVerb} ${label}`}
          className={cn(
            'absolute -top-5 -right-1 z-20 grid h-4 w-4 place-items-center rounded bg-black/75 text-white transition-opacity hover:opacity-80'
          )}
          style={{ pointerEvents: 'auto' }}
        >
          <X size={10} aria-hidden="true" />
        </button>
      )}
      {selected &&
        HANDLES.map((handle) => (
          <span
            key={handle}
            className={cn(
              'absolute z-20 h-2.5 w-2.5 rounded-sm bg-white',
              HANDLE_CLASS[handle]
            )}
            style={{ cursor: HANDLE_CURSOR[handle], pointerEvents: 'auto' }}
            onPointerDown={(event) => onPointerDown(event, id, 'resize', handle)}
          />
        ))}
      {selected && rotationDeg !== undefined && (
        <>
          <span className="pointer-events-none absolute -bottom-5 left-1/2 h-5 w-px -translate-x-1/2 bg-white/70" />
          <span
            role="presentation"
            title="Rotate (Shift snaps to 15°)"
            className="absolute -bottom-7 left-1/2 z-20 h-3 w-3 -translate-x-1/2 rounded-full border-2 border-white bg-black/60"
            style={{ cursor: 'grab', pointerEvents: 'auto' }}
            onPointerDown={(event) => onPointerDown(event, id, 'rotate')}
          />
        </>
      )}
    </div>
  )
}
