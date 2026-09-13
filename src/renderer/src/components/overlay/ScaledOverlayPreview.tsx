import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  applyOverlayAutoFit,
  overlayVideoTime,
  playOverlayVideos,
  seekOverlayVideos,
  setOverlayVideosPaused,
  type OverlayVideoTime,
} from '@shared/overlay-fit'
import { cn } from '@/lib/utils'

export const OVERLAY_FRAME_WIDTH = 1920
export const OVERLAY_FRAME_HEIGHT = 1080

/**
 * Overlay HTML always lays out at 1920×1080 (same as NDI). The slot only
 * scales that frame visually. Container queries and height-gated scale both
 * collapsed the layout to the thumbnail, so auto-fit treated a 160px tile as
 * the box and blew the type up.
 */
export function ScaledOverlayPreview({
  html,
  autoFit,
  width,
  height,
  className,
  fill = false,
  paused = false,
  seekTo = null,
  onTime,
}: {
  html: string
  autoFit: boolean
  width?: number
  height?: number
  className?: string
  /** Fill a sized parent instead of imposing 16:9. */
  fill?: boolean
  /** Pause background video without rebuilding the slide. */
  paused?: boolean
  /** Scrub without rebuilding the slide. Token changes trigger the seek. */
  seekTo?: { token: number; seconds: number } | null
  onTime?: (time: OverlayVideoTime) => void
}): React.ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState({ x: 0, y: 0 })
  const sized = width != null && height != null

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = (): void => {
      const w = frame.clientWidth
      const h = frame.clientHeight
      const x = w > 0 ? w / OVERLAY_FRAME_WIDTH : 0
      const y = h > 0 ? h / OVERLAY_FRAME_HEIGHT : 0
      setScale((prev) => (prev.x === x && prev.y === y ? prev : { x, y }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(frame)
    return () => ro.disconnect()
  }, [width, height])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || scale.x <= 0 || scale.y <= 0) return
    playOverlayVideos(inner, paused)
    if (!autoFit) return
    applyOverlayAutoFit(inner)
    let cancelled = false
    void document.fonts?.ready.then(() => {
      if (!cancelled) applyOverlayAutoFit(inner)
    })
    return () => {
      cancelled = true
    }
    // `paused` is applied by the effect below so a play/pause toggle does not
    // rebind autoplay listeners and restart the clip.
    // Effect deps are intentionally html/scale only (no exhaustive-deps plugin configured).
  }, [html, autoFit, scale.x, scale.y])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    setOverlayVideosPaused(inner, paused)
  }, [paused])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !seekTo) return
    seekOverlayVideos(inner, seekTo.seconds)
  }, [seekTo])

  useEffect(() => {
    const inner = innerRef.current
    if (!inner || !onTime) return
    const videos = inner.querySelectorAll('video')
    if (videos.length === 0) return
    const video = videos[0]
    const emit = (): void => {
      onTime(overlayVideoTime(video))
    }
    video.addEventListener('timeupdate', emit)
    video.addEventListener('durationchange', emit)
    video.addEventListener('loadedmetadata', emit)
    video.addEventListener('ended', emit)
    video.addEventListener('seeked', emit)
    emit()
    return () => {
      video.removeEventListener('timeupdate', emit)
      video.removeEventListener('durationchange', emit)
      video.removeEventListener('loadedmetadata', emit)
      video.removeEventListener('ended', emit)
      video.removeEventListener('seeked', emit)
    }
  }, [html, onTime])

  const ready = scale.x > 0 && scale.y > 0

  return (
    <div
      ref={frameRef}
      className={cn(
        'relative overflow-hidden bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#0d0d0d_0%_50%)] bg-[length:12px_12px]',
        !sized && !fill && 'aspect-video w-full',
        fill && 'h-full w-full',
        className
      )}
      style={sized ? { width, height } : undefined}
    >
      <div
        ref={innerRef}
        className="pointer-events-none absolute left-0 top-0"
        style={{
          width: OVERLAY_FRAME_WIDTH,
          height: OVERLAY_FRAME_HEIGHT,
          minWidth: OVERLAY_FRAME_WIDTH,
          minHeight: OVERLAY_FRAME_HEIGHT,
          transformOrigin: 'top left',
          transform: `scale(${scale.x}, ${scale.y})`,
          visibility: ready ? 'visible' : 'hidden',
        }}
        // Shared WYSIWYG overlay template (escaped upstream; no react/no-danger plugin configured).
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  )
}
