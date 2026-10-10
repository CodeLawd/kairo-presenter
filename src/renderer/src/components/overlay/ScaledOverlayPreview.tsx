import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  applyOverlayAutoFit,
  OVERLAY_TRANSPORT_VIDEOS,
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
 * A thumbnail's video background as a still: no autoplay, metadata only, and a
 * media fragment so the element paints one frame. Every playing preview is its
 * own H.264 decoder — a page of verse cards or theme tiles with a video theme
 * ran the renderer out of memory inside ffmpeg and blanked the window.
 */
function stillVideos(html: string): string {
  if (!html.includes('<video')) return html
  return html.replace(/<video\b[^>]*>/g, (tag) =>
    tag
      .replace(/\sautoplay\b/, '')
      .replace(/\sloop\b/, '')
      .replace('preload="auto"', 'preload="metadata"')
      .replace(/src="([^"#]*)"/, 'src="$1#t=0.1"'),
  )
}

/** Stop a video and drop its source so its decoder is freed immediately. */
function releaseVideo(video: HTMLVideoElement): void {
  if (video.isConnected) return
  video.pause()
  video.removeAttribute('src')
  video.load()
}

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
  motion = false,
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
  /**
   * Play video backgrounds. Only the live monitor and the theme canvas need
   * motion; everything else shows a still frame (see `stillVideos`).
   */
  motion?: boolean
}): React.ReactElement {
  const frameRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState({ x: 0, y: 0 })
  const sized = width != null && height != null
  const frameHtml = useMemo(() => (motion ? html : stillVideos(html)), [html, motion])
  // A page kept mounted behind another tab (display:none) must not keep
  // decoding: pause while the frame is off screen.
  const [onScreen, setOnScreen] = useState(true)
  const hasVideo = motion && html.includes('<video')
  useEffect(() => {
    const frame = frameRef.current
    if (!hasVideo || !frame) return
    const io = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
    io.observe(frame)
    return () => io.disconnect()
  }, [hasVideo])
  const videoPaused = paused || !onScreen

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

  // Each html change replaces the frame's DOM. Keep a playing video whose
  // source did not change (a slider tick or the next verse must not restart the
  // background or spin up another decoder), and free the ones that went away
  // now rather than whenever GC gets to them.
  const videosRef = useRef<HTMLVideoElement[]>([])
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    const previous = videosRef.current
    const next = Array.from(inner.querySelectorAll('video'))
    const kept = new Set<HTMLVideoElement>()
    if (motion) {
      next.forEach((fresh, index) => {
        const old = previous[index]
        if (!old || old.getAttribute('src') !== fresh.getAttribute('src')) return
        for (const name of ['style', 'loop']) {
          const value = fresh.getAttribute(name)
          if (value === null) old.removeAttribute(name)
          else old.setAttribute(name, value)
        }
        fresh.replaceWith(old)
        releaseVideo(fresh)
        next[index] = old
        kept.add(old)
      })
    }
    for (const old of previous) if (!kept.has(old)) releaseVideo(old)
    videosRef.current = next
  }, [frameHtml, motion])
  useEffect(() => () => videosRef.current.forEach(releaseVideo), [])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || scale.x <= 0 || scale.y <= 0) return
    if (motion) playOverlayVideos(inner, videoPaused)
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
  }, [frameHtml, autoFit, scale.x, scale.y])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !motion) return
    setOverlayVideosPaused(inner, videoPaused)
  }, [videoPaused, motion])

  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner || !seekTo || !motion) return
    seekOverlayVideos(inner, seekTo.seconds)
  }, [seekTo])

  useEffect(() => {
    const inner = innerRef.current
    if (!inner || !onTime || !motion) return
    const videos = inner.querySelectorAll<HTMLVideoElement>(OVERLAY_TRANSPORT_VIDEOS)
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
  }, [frameHtml, onTime, motion])

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
        dangerouslySetInnerHTML={{ __html: frameHtml }}
      />
    </div>
  )
}
