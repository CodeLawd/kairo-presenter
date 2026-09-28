import { useEffect, useRef } from 'react'
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
}: OverlayCanvasProps): React.ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)
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
  }

  const applyPointer = (clientX: number, clientY: number): void => {
    const drag = dragRef.current
    const frame = frameRef.current
    if (!drag || !frame) return
    const rect = frame.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    const dxPct = ((clientX - drag.startX) / rect.width) * 100
    const dyPct = ((clientY - drag.startY) / rect.height) * 100
    const next =
      drag.mode === 'resize' && drag.handle
        ? resizeOverlayBox(drag.startBox, drag.handle, dxPct, dyPct)
        : moveOverlayBox(drag.startBox, dxPct, dyPct)
    onBoxChangeRef.current(drag.id, next)
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

  // Delete/Backspace on the selected box, the way any canvas editor behaves.
  // Ignored while typing so the number and color fields keep their own keys.
  useEffect(() => {
    if (!selected || !isDeletable(selected)) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) return
      event.preventDefault()
      onDeleteLayer(selected)
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
          accent={id === 'verse' ? 'teal' : 'amber'}
          onDelete={isDeletable(id) ? () => onDeleteLayer(id) : undefined}
          onPointerDown={beginDrag}
        />
      ))}
    </div>
  )
}

function LayerFrame({
  id,
  label,
  box,
  selected,
  stacked,
  accent,
  onDelete,
  onPointerDown,
}: {
  id: OverlayLayerId
  label: string
  box: OverlayBox
  selected: boolean
  stacked: number
  accent: 'teal' | 'amber'
  /** Omitted for layers that cannot be hidden. */
  onDelete?: () => void
  onPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    id: OverlayLayerId,
    mode: 'move' | 'resize',
    handle?: ResizeHandle
  ) => void
}): React.ReactElement | null {
  if (!box) return null

  // Outline-only frames so verse/reference text color stays visible in the preview.
  const ring = accent === 'teal' ? 'ring-teal-400' : 'ring-amber-400'
  const dash = accent === 'teal' ? 'ring-teal-400/70' : 'ring-amber-400/70'
  const chip = accent === 'teal' ? 'bg-teal-500' : 'bg-amber-500'
  const handleFill = accent === 'teal' ? 'bg-teal-300' : 'bg-amber-300'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Move ${label}`}
      aria-pressed={selected}
      className={cn(
        'absolute cursor-grab touch-none select-none rounded-none bg-transparent ring-2 active:cursor-grabbing',
        selected ? ring : dash
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
    >
      <span
        className={cn(
          'pointer-events-none absolute -top-5 left-0 z-10 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-white',
          chip
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
            'absolute -top-5 -right-1 z-20 grid h-4 w-4 place-items-center rounded text-white transition-opacity hover:opacity-80',
            chip
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
              'absolute z-20 h-3 w-3 rounded-sm border border-white shadow-sm',
              handleFill,
              HANDLE_CLASS[handle]
            )}
            style={{ cursor: HANDLE_CURSOR[handle], pointerEvents: 'auto' }}
            onPointerDown={(event) => onPointerDown(event, id, 'resize', handle)}
          />
        ))}
    </div>
  )
}
