import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

/**
 * Lets a modal window's traffic lights reach the frame that sizes it — the
 * green button zooms the frame to fill the app and back.
 */
export const FrameZoomContext = createContext<(() => void) | null>(null)

/**
 * macOS window controls for an in-app modal window (Settings, Screens), drawn
 * the way ProPresenter's windows show them. Red closes; green zooms when the
 * window sits in a resizable frame. Yellow is shown greyed, as macOS does for
 * a button that can't act — an in-app window can't be minimised.
 */
export function MacTrafficLights({
  onClose,
  className,
}: {
  onClose?: () => void
  className?: string
}): React.ReactElement {
  const onZoom = useContext(FrameZoomContext)
  return (
    <div data-settings-drag className={cn('group/lights flex items-center gap-[8px]', className)}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="relative h-[12px] w-[12px] rounded-full bg-[#FF5F57] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <span className="pointer-events-none absolute inset-0 grid place-items-center text-[9px] font-bold leading-none text-[#4d0000] opacity-0 group-hover/lights:opacity-100">
          ×
        </span>
      </button>
      <span aria-hidden="true" className="h-[12px] w-[12px] rounded-full bg-surface-elevated" />
      {onZoom ? (
        <button
          type="button"
          aria-label="Zoom"
          onClick={onZoom}
          className="relative h-[12px] w-[12px] rounded-full bg-[#28C840] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
        >
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-[8px] font-bold leading-none text-[#0b4a14] opacity-0 group-hover/lights:opacity-100">
            +
          </span>
        </button>
      ) : (
        <span aria-hidden="true" className="h-[12px] w-[12px] rounded-full bg-surface-elevated" />
      )}
    </div>
  )
}
