import { useEffect, useRef, useState } from 'react'
import { X } from '@/icons'
import { cn } from '@/lib/utils'
import type { OverlayBox, OverlayContentKind, OverlayTheme } from '@shared/ipc'
import {
  moveOverlayBox,
  resizeOverlayBox,
  type ResizeHandle,
} from '@shared/overlay-boxes'
import { overlayLayerLabel } from '@shared/overlay-outputs'

export type OverlayLayerId = 'verse' | 'reference'

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
  selected: OverlayLayerId | null
  onSelect: (id: OverlayLayerId | null) => void
  onBoxChange: (id: OverlayLayerId, box: OverlayBox) => void
  /** Hides a layer — the canvas's Delete key and the frame's × both call this. */
  onDeleteLayer: (id: OverlayLayerId) => void
  /** Double-click on a box: open its text settings. */
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
 * Only the reference can be removed: the verse box holds the content itself, and
 * the theme has no flag that would hide it. Selecting it and pressing Delete is
 * a no-op rather than an error.
 */
function isDeletable(id: OverlayLayerId): boolean {
  return id === 'reference'
}

export function OverlayCanvas({
  theme,
  contentKind,
  selected,
  onSelect,
  onBoxChange,
  onDeleteLayer,
  onEditLayer,
}: OverlayCanvasProps): React.ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)
  const [guides, setGuides] = useState({ v: false, h: false })
  const dragRef = useRef<{
    id: OverlayLayerId
    mode: 'move' | 'resize'
    handle?: ResizeHandle
    pointerId: number
    startX: number
    startY: number
    startBox: OverlayBox
  } | null>(null)
  const onBoxChangeRef = useRef(onBoxChange)
  onBoxChangeRef.current = onBoxChange
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

  const applyPointer = (clientX: number, clientY: number): void => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const dxPct = ((clientX - drag.startX) / rect.width) * 100
    const dyPct = ((clientY - drag.startY) / rect.height) * 100
    if (drag.mode === 'resize' && drag.handle) {
      onBoxChangeRef.current(drag.id, resizeOverlayBox(drag.startBox, drag.handle, dxPct, dyPct))
      return
    }
    const snapped = snapToCentre(moveOverlayBox(drag.startBox, dxPct, dyPct))
    setGuides((g) => (g.v === snapped.v && g.h === snapped.h ? g : { v: snapped.v, h: snapped.h }))
    onBoxChangeRef.current(drag.id, snapped.box)
  }

  const beginDrag = (
    event: React.PointerEvent<HTMLElement>,
    id: OverlayLayerId,
    mode: 'move' | 'resize',
    handle?: ResizeHandle
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    const box = id === 'verse' ? theme.verse.box : theme.reference.box
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
      applyPointer(moveEvent.clientX, moveEvent.clientY)
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
      const box = selected === 'verse' ? themeRef.current.verse.box : themeRef.current.reference.box
      if (!box) return
      event.preventDefault()
      onBoxChangeRef.current(selected, moveOverlayBox(box, move[0], move[1]))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selected, onDeleteLayer])

  const layers: OverlayLayerId[] =
    theme.reference.show ? ['verse', 'reference'] : ['verse']

  return (
    <div
      ref={frameRef}
      className="absolute inset-0 z-20 touch-none"
      style={{ pointerEvents: 'auto' }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null)
      }}
    >
      {layers.map((id) => (
        <LayerFrame
          key={id}
          id={id}
          label={overlayLayerLabel(contentKind, id === 'verse' ? 'verse' : 'reference')}
          box={id === 'verse' ? theme.verse.box : theme.reference.box}
          selected={selected === id}
          stacked={selected === id ? 30 : id === 'reference' ? 20 : 10}
          onDelete={isDeletable(id) ? () => onDeleteLayer(id) : undefined}
          onPointerDown={beginDrag}
          onDoubleClick={onEditLayer ? () => onEditLayer(id) : undefined}
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
  onDelete,
  onPointerDown,
  onDoubleClick,
}: {
  id: OverlayLayerId
  label: string
  box: OverlayBox
  selected: boolean
  stacked: number
  /** Omitted for layers that cannot be hidden. */
  onDelete?: () => void
  onPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    id: OverlayLayerId,
    mode: 'move' | 'resize',
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
          title={`Hide ${label} (Delete)`}
          aria-label={`Hide ${label}`}
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
    </div>
  )
}
