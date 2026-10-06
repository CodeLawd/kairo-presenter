import { useEffect, useState } from 'react'
import { MonitorPlay } from '@/icons'
import type { DisplayInfo, OverlayOutput } from '@shared/ipc'
import { bindingForDisplay, describeDisplay, resolveDisplay } from '@shared/displays'

/** Anything bound to a physical display: a Kairo screen output or a stage display. */
export type DisplayBound = Pick<OverlayOutput, 'displayId' | 'displayLabel' | 'displaySize'> & {
  name: string
}

/** Connected displays, kept current as monitors are plugged in and out. */
export function useDisplays(): DisplayInfo[] {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  useEffect(() => {
    let cancelled = false
    window.api.displays
      .list()
      .then((list) => {
        if (!cancelled) setDisplays(list)
      })
      .catch(() => undefined)
    const unsubscribe = window.api.displays.onChanged(setDisplays)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])
  return displays
}

/** Which physical display an output fills — a dropdown plus Identify. */
export function DisplayPicker({
  id,
  target,
  displays,
  others,
  onChange,
}: {
  id: string
  target: DisplayBound
  displays: DisplayInfo[]
  /** Other enabled things on displays — their display is taken. */
  others: DisplayBound[]
  onChange: (patch: Pick<OverlayOutput, 'displayId' | 'displayLabel' | 'displaySize'>) => void
}): React.ReactElement {
  const bound = resolveDisplay(target, displays)
  // A bound display that is unplugged stays selected — the output keeps its
  // binding and comes back when the display does.
  const missing = target.displayId !== null && !bound
  const takenBy = (display: DisplayInfo): DisplayBound | undefined =>
    others.find((o) => resolveDisplay(o, displays)?.id === display.id)

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <select
          id={id}
          className="input flex-1"
          value={bound ? String(bound.id) : missing ? 'missing' : ''}
          onChange={(e) => {
            if (e.target.value === '') {
              onChange({ displayId: null, displayLabel: '', displaySize: null })
              return
            }
            const display = displays.find((d) => String(d.id) === e.target.value)
            if (display) onChange(bindingForDisplay(display))
          }}
        >
          <option value="">None</option>
          {missing && (
            <option value="missing" disabled>
              {target.displayLabel || 'Previous display'} (not connected)
            </option>
          )}
          {displays.map((display) => {
            const owner = takenBy(display)
            const tags = [
              display.hostsMainWindow ? 'Kairo’s controls' : null,
              owner ? `used by ${owner.name}` : null,
            ].filter(Boolean)
            return (
              <option key={display.id} value={String(display.id)} disabled={!!owner}>
                {describeDisplay(display)}
                {tags.length > 0 ? ` — ${tags.join(', ')}` : ''}
              </option>
            )
          })}
        </select>
        <button
          type="button"
          className="btn-secondary flex shrink-0 items-center gap-1.5 px-3 text-[12px]"
          onClick={() => void window.api.displays.identify()}
          title="Show each display’s name on the display itself"
        >
          <MonitorPlay size={12} aria-hidden="true" />
          Identify
        </button>
      </div>
      {bound?.hostsMainWindow && (
        <p className="text-[11px] leading-snug text-slate-500">
          Kairo’s controls are on this display, so it opens as a rehearsal window instead of full
          screen.
        </p>
      )}
    </div>
  )
}
