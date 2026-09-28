import { cn } from '@/lib/utils'
import type { DisplayInfo } from '@shared/ipc'
import { describeDisplay, resolveDisplay } from '@shared/displays'
import type { DisplayBound } from './displays'

export interface CanvasBinding extends DisplayBound {
  key: string
  role: 'Audience' | 'Stage'
  enabled: boolean
}

/**
 * The connected displays, laid out as the OS arranges them, with whatever
 * Kairo puts on each. The same picture ProPresenter's Screen Configuration
 * leads with: where things go is answered by looking, not by reading a list.
 *
 * Clicking a display binds the selected screen to it (when one is selected).
 */
export function ArrangementCanvas({
  displays,
  bindings,
  selectedKey,
  canBind,
  onPickDisplay,
}: {
  displays: DisplayInfo[]
  bindings: CanvasBinding[]
  selectedKey: string | null
  /** The selected item takes a display — clicking one assigns it. */
  canBind: boolean
  onPickDisplay: (display: DisplayInfo) => void
}): React.ReactElement {
  if (displays.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-slate-500">
        Looking for displays…
      </div>
    )
  }

  const left = Math.min(...displays.map((d) => d.bounds.x))
  const top = Math.min(...displays.map((d) => d.bounds.y))
  const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width))
  const bottom = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height))
  const width = right - left
  const height = bottom - top

  return (
    <div className="flex h-full w-full items-center justify-center p-10">
      <div
        className="relative max-h-full w-full"
        style={{ aspectRatio: `${width} / ${height}`, maxWidth: `min(100%, calc((100vh - 16rem) * ${width / height}))` }}
      >
        {displays.map((display, index) => {
          const on = bindings.filter((b) => resolveDisplay(b, displays)?.id === display.id)
          const selected = on.some((b) => b.key === selectedKey)
          return (
            <button
              key={display.id}
              type="button"
              disabled={!canBind}
              onClick={() => onPickDisplay(display)}
              title={canBind ? `Show the selected screen on ${display.label || 'this display'}` : undefined}
              className={cn(
                'absolute flex flex-col items-center justify-center gap-1 overflow-hidden border bg-surface-tertiary p-2 text-center transition-colors',
                selected ? 'border-2 border-teal-400' : 'border-surface-border',
                canBind && !selected && 'hover:border-slate-400',
                !canBind && 'cursor-default',
              )}
              style={{
                left: `${((display.bounds.x - left) / width) * 100}%`,
                top: `${((display.bounds.y - top) / height) * 100}%`,
                // A hairline gap between neighbours, so two displays never read as one.
                width: `calc(${(display.bounds.width / width) * 100}% - 6px)`,
                height: `calc(${(display.bounds.height / height) * 100}% - 6px)`,
              }}
            >
              <span className="text-[22px] font-semibold leading-none text-slate-500">{index + 1}</span>
              <span className="max-w-full truncate text-[11px] text-slate-400">{describeDisplay(display)}</span>
              {display.hostsMainWindow && (
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Kairo controls</span>
              )}
              <span className="mt-1 flex max-w-full flex-wrap justify-center gap-1">
                {on.map((b) => (
                  <span
                    key={b.key}
                    className={cn(
                      'max-w-full truncate px-1.5 py-0.5 text-[10px] font-medium',
                      b.key === selectedKey
                        ? 'bg-teal-600 text-white'
                        : b.enabled
                          ? 'bg-surface-border text-slate-200'
                          : 'bg-surface-secondary text-slate-500',
                    )}
                  >
                    {b.role === 'Stage' ? 'Stage · ' : ''}
                    {b.name}
                    {!b.enabled && ' (off)'}
                  </span>
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
