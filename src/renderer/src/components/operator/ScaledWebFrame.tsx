import { forwardRef, useEffect, useRef, useState } from 'react'
import { WEB_FRAME_ALLOW, WEB_FRAME_HEIGHT, WEB_FRAME_SANDBOX, WEB_FRAME_WIDTH } from '@shared/web'

/**
 * A web page laid out at the screens' width (1920) and scaled to fit its box,
 * so text wraps as the audience sees it and a scroll position here is the same
 * place on every screen. Same sandbox as screens.
 *
 * Exactly the screens' 1920×1080 window by default. `fill`: the window takes
 * the box's full height instead, with a line where the screens' picture ends —
 * only for pages whose layout doesn't depend on the window's height, or the
 * taller window would lay them out differently from the screens.
 */
export const ScaledWebFrame = forwardRef<
  HTMLIFrameElement,
  {
    url: string
    /** The frame's `name` — how the main process finds it (preview or mirror). */
    name: string
    /** Clickable (the Web page) or just a picture (the main screen preview). */
    interactive: boolean
    title: string
    fill?: boolean
  }
>(function ScaledWebFrame({ url, name, interactive, title, fill = false }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ scale: 0, height: WEB_FRAME_HEIGHT })

  useEffect(() => {
    const node = box.current
    if (!node) return
    const measure = (): void => {
      const scale = node.clientWidth / WEB_FRAME_WIDTH
      setSize({ scale, height: fill && scale > 0 ? Math.round(node.clientHeight / scale) : WEB_FRAME_HEIGHT })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [fill])

  const { scale, height } = size
  return (
    <div ref={box} className="absolute inset-0 overflow-hidden bg-white">
      <iframe
        ref={ref}
        name={name}
        title={title}
        src={url}
        sandbox={WEB_FRAME_SANDBOX}
        allow={WEB_FRAME_ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        tabIndex={interactive ? undefined : -1}
        className="absolute left-0 top-0 origin-top-left border-0 bg-white"
        style={{
          width: WEB_FRAME_WIDTH,
          height,
          transform: `scale(${scale})`,
          visibility: scale > 0 ? 'visible' : 'hidden',
          pointerEvents: interactive ? 'auto' : 'none',
        }}
      />
      {fill && scale > 0 && height > WEB_FRAME_HEIGHT && (
        // The cut-off: everything above it is on the screens.
        <div
          className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-live"
          style={{ top: Math.round(WEB_FRAME_HEIGHT * scale) }}
          aria-hidden="true"
        >
          <span className="absolute right-2 top-1.5 rounded bg-live px-1.5 py-0.5 text-[10px] font-medium text-white">
            Screens show down to here
          </span>
        </div>
      )}
    </div>
  )
})
