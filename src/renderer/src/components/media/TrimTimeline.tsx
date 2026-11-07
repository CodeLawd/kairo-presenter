import { useRef } from 'react'

type Edge = 'start' | 'end'

export function TrimTimeline({ duration, start, end, onTrim }: {
  duration: number
  start: number
  end: number
  onTrim: (edge: Edge, time: number) => void
}): React.ReactElement {
  const track = useRef<HTMLDivElement>(null)
  const grabOffset = useRef(0)
  const gap = Math.min(0.01, duration / 2)
  const clamp = (edge: Edge, time: number): number =>
    edge === 'start' ? Math.max(0, Math.min(end - gap, time)) : Math.min(duration, Math.max(start + gap, time))

  return (
    <div className="px-3">
      <div ref={track} className="relative my-3 h-7 rounded-sm bg-surface-tertiary">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-y-2 border-teal-400 bg-teal-400/20"
          style={{ left: `${duration ? start / duration * 100 : 0}%`, right: `${duration ? (1 - end / duration) * 100 : 0}%` }}
        />
        {(['start', 'end'] as const).map((edge) => {
          const time = edge === 'start' ? start : end
          const min = edge === 'start' ? 0 : Math.min(duration, start + gap)
          const max = edge === 'start' ? Math.max(0, end - gap) : duration
          return (
            <button
              key={edge}
              type="button"
              role="slider"
              aria-label={edge === 'start' ? 'Trim start' : 'Trim end'}
              title={edge === 'start' ? 'Drag to set the start' : 'Drag to set the end'}
              aria-valuemin={Math.min(min, time)}
              aria-valuemax={Math.max(max, time)}
              aria-valuenow={time}
              aria-valuetext={`${time.toFixed(2)} seconds`}
              disabled={!duration}
              className={`absolute inset-y-0 z-10 grid w-3 cursor-ew-resize touch-none place-items-center rounded-sm bg-teal-400 text-slate-950 outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 ${edge === 'start' ? '-translate-x-full' : ''}`}
              style={{ left: `${duration ? time / duration * 100 : edge === 'start' ? 0 : 100}%` }}
              onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return
                const bounds = event.currentTarget.getBoundingClientRect()
                grabOffset.current = event.clientX - (edge === 'start' ? bounds.right : bounds.left)
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId) || !track.current) return
                const bounds = track.current.getBoundingClientRect()
                if (bounds.width <= 0) return
                const seconds = (event.clientX - grabOffset.current - bounds.left) / bounds.width * duration
                const snapped = seconds >= duration ? duration : Math.round(seconds * 100) / 100
                onTrim(edge, clamp(edge, snapped))
              }}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 1 : 0.1
                const keys: Record<string, number> = {
                  ArrowLeft: time - step, ArrowDown: time - step,
                  ArrowRight: time + step, ArrowUp: time + step,
                  Home: min, End: max,
                }
                const next = keys[event.key]
                if (typeof next !== 'number') return
                event.preventDefault()
                event.stopPropagation()
                onTrim(edge, event.key === 'Home' || event.key === 'End' ? next : clamp(edge, Math.round(next * 100) / 100))
              }}
            >
              <span aria-hidden="true" className="h-3 w-px bg-black/60" />
            </button>
          )
        })}
      </div>
    </div>
  )
}
