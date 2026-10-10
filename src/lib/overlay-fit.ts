/**
 * DOM auto-fit for overlay verse text. Renderer-only at runtime.
 * Typed without DOM globals so the shared lib still typechecks in Node.
 * overlay.html duplicates a tiny copy so the NDI window can fit without bundling.
 */

interface FitElement {
  dataset: { autoFit?: string; maxFontPx?: string }
  clientHeight: number
  clientWidth: number
  scrollHeight: number
  scrollWidth: number
  style: { fontSize: string }
  querySelector(selector: string): FitElement | null
}

interface FitRoot {
  querySelector(selector: string): FitElement | null
}

export function largestFontThatFits(
  minPx: number,
  maxPx: number,
  overflows: (px: number) => boolean
): number {
  const min = Math.max(1, Math.floor(minPx))
  const max = Math.max(min, Math.floor(maxPx))
  if (overflows(min)) return min
  let lo = min
  let hi = max
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)
    if (overflows(mid)) hi = mid - 1
    else lo = mid
  }
  return lo
}

/** True when the verse text does not fit the clip box (the NDI-visible area). */
export function overlayTextOverflows(
  text: { scrollHeight: number; scrollWidth: number },
  verse: { clientHeight: number; clientWidth: number },
  box: { clientHeight: number; clientWidth: number }
): boolean {
  // Flex min-height:auto can grow `.pa-verse` with its content. The box is
  // overflow:hidden, so it is the real 1920×1080 constraint.
  const limitH = Math.max(1, Math.min(verse.clientHeight, box.clientHeight))
  const limitW = Math.max(1, Math.min(verse.clientWidth, box.clientWidth))
  return text.scrollHeight > limitH + 1 || text.scrollWidth > limitW + 1
}

export interface OverlayVideoTime {
  currentTime: number
  duration: number
  ended: boolean
}

interface OverlayVideo {
  muted: boolean
  defaultMuted?: boolean
  playsInline: boolean
  readyState: number
  ended?: boolean
  currentTime?: number
  duration?: number
  dataset?: { paPaused?: string }
  play(): Promise<void>
  pause(): void
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void
  removeEventListener?(type: string, listener: () => void): void
}

interface OverlayVideoRoot {
  querySelectorAll(selector: string): ArrayLike<OverlayVideo>
}

/**
 * The background video(s) the operator's transport drives — pause, seek, time.
 * Video elements placed in the theme are decoration and just keep playing.
 */
export const OVERLAY_TRANSPORT_VIDEOS = 'video:not(.pa-element video)'

/**
 * Videos written through innerHTML do not reliably honor `autoplay`.
 * Start them after the slide is in the DOM so the operator preview and the
 * NDI window show motion instead of the first frame.
 */
export function playOverlayVideos(root: OverlayVideoRoot, paused = false): void {
  const videos = root.querySelectorAll('video')
  const transport = new Set(Array.from(root.querySelectorAll(OVERLAY_TRANSPORT_VIDEOS)))
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i]
    const held = paused && transport.has(video)
    video.muted = true
    if (video.defaultMuted !== undefined) video.defaultMuted = true
    video.playsInline = true
    markOverlayVideoPaused(video, held)
    if (held) {
      video.pause()
      continue
    }
    const start = (): void => {
      if (video.dataset?.paPaused === '1') return
      void video.play().catch(() => undefined)
    }
    video.addEventListener('loadeddata', start, { once: true })
    video.addEventListener('canplay', start, { once: true })
    if (video.readyState >= 2) start()
  }
}

/** Pause or resume videos already in the slide without rebuilding the HTML. */
export function setOverlayVideosPaused(root: OverlayVideoRoot, paused: boolean): void {
  const videos = root.querySelectorAll(OVERLAY_TRANSPORT_VIDEOS)
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i]
    markOverlayVideoPaused(video, paused)
    if (paused) {
      video.pause()
      continue
    }
    if (video.ended) video.currentTime = 0
    void video.play().catch(() => undefined)
  }
}

function markOverlayVideoPaused(video: OverlayVideo, paused: boolean): void {
  if (video.dataset) video.dataset.paPaused = paused ? '1' : ''
}

/** Jump every background video to the same time without rebuilding the slide. */
export function seekOverlayVideos(root: OverlayVideoRoot, seconds: number): void {
  const videos = root.querySelectorAll(OVERLAY_TRANSPORT_VIDEOS)
  const raw = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i]
    const duration = video.duration ?? 0
    video.currentTime = Number.isFinite(duration) && duration > 0 ? Math.min(duration, raw) : raw
  }
}

export function overlayVideoTime(video: OverlayVideo): OverlayVideoTime {
  const duration = Number.isFinite(video.duration) ? (video.duration ?? 0) : 0
  return {
    currentTime: Number.isFinite(video.currentTime) ? (video.currentTime ?? 0) : 0,
    duration,
    ended: !!video.ended,
  }
}

export function applyOverlayAutoFit(root: FitRoot): void {
  const box = root.querySelector('.pa-verse-box')
  const verse = root.querySelector('.pa-verse')
  if (!box || !verse) return
  if (box.dataset.autoFit !== 'true') return
  const maxPx = Number(box.dataset.maxFontPx)
  const cap = Number.isFinite(maxPx) && maxPx > 0 ? maxPx : 240
  const text = verse.querySelector('.pa-verse-text') ?? verse
  const fitted = largestFontThatFits(12, cap, (px) => {
    verse.style.fontSize = `${px}px`
    return overlayTextOverflows(text, verse, box)
  })
  verse.style.fontSize = `${fitted}px`
}
