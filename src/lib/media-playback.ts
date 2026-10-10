import type { MediaKind, MediaPlayback, OverlayTheme } from './ipc'

/** Color identity. Loop is off until the operator turns it on. */
export const DEFAULT_MEDIA_PLAYBACK: MediaPlayback = {
  loop: false,
  hue: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1,
}

export function normalizeMediaPlayback(raw: unknown): MediaPlayback {
  const value = raw && typeof raw === 'object' ? (raw as Partial<MediaPlayback>) : {}
  return {
    loop: typeof value.loop === 'boolean' ? value.loop : DEFAULT_MEDIA_PLAYBACK.loop,
    hue: clamp(value.hue, -180, 180, DEFAULT_MEDIA_PLAYBACK.hue),
    saturation: clamp(value.saturation, 0, 2, DEFAULT_MEDIA_PLAYBACK.saturation),
    brightness: clamp(value.brightness, 0.25, 1.75, DEFAULT_MEDIA_PLAYBACK.brightness),
    contrast: clamp(value.contrast, 0.25, 1.75, DEFAULT_MEDIA_PLAYBACK.contrast),
  }
}

export function isDefaultMediaPlayback(playback: MediaPlayback): boolean {
  return (
    playback.loop === DEFAULT_MEDIA_PLAYBACK.loop &&
    playback.hue === DEFAULT_MEDIA_PLAYBACK.hue &&
    playback.saturation === DEFAULT_MEDIA_PLAYBACK.saturation &&
    playback.brightness === DEFAULT_MEDIA_PLAYBACK.brightness &&
    playback.contrast === DEFAULT_MEDIA_PLAYBACK.contrast
  )
}

export function normalizePlaybackMap(raw: unknown): Record<string, MediaPlayback> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const next: Record<string, MediaPlayback> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id) continue
    const playback = normalizeMediaPlayback(value)
    if (!isDefaultMediaPlayback(playback)) next[id] = playback
  }
  return next
}

/** Empty when identity — do not emit a no-op `filter` on the overlay. */
export function mediaFilterCss(playback: MediaPlayback): string {
  const parts: string[] = []
  if (playback.hue !== 0) parts.push(`hue-rotate(${playback.hue}deg)`)
  if (playback.saturation !== 1) parts.push(`saturate(${playback.saturation})`)
  if (playback.brightness !== 1) parts.push(`brightness(${playback.brightness})`)
  if (playback.contrast !== 1) parts.push(`contrast(${playback.contrast})`)
  return parts.join(' ')
}

export function applyPlaybackToBackground(
  background: OverlayTheme['background'],
  playback: MediaPlayback,
  kind: MediaKind,
): OverlayTheme['background'] {
  return {
    ...background,
    mediaLoop: kind === 'video' ? playback.loop : true,
    hue: playback.hue,
    saturation: playback.saturation,
    brightness: playback.brightness,
    contrast: playback.contrast,
  }
}

/** Puts a dock background under a theme without touching verse styling. */
export function themeWithLiveMedia(
  theme: OverlayTheme,
  item: { kind: MediaKind; path: string } | null,
  playback: MediaPlayback = DEFAULT_MEDIA_PLAYBACK,
): OverlayTheme {
  if (!item) return theme
  return {
    ...theme,
    background: applyPlaybackToBackground(
      {
        ...theme.background,
        type: item.kind === 'video' ? 'video' : 'image',
        mediaPath: item.path,
        mediaFit: theme.background.mediaFit ?? 'cover',
      },
      playback,
      item.kind,
    ),
  }
}

/** `m:ss` or `h:mm:ss` for the live transport clock. */
export function formatMediaClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const padded = String(rest).padStart(2, '0')
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${padded}`
  return `${minutes}:${padded}`
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * True when `theme` carries a background of its own.
 *
 * The dock's live loop only fills in for a theme that asked for nothing — a
 * scripture theme configured with an image, gradient or solid colour must keep
 * it when it is pushed over a song that is already running a motion loop.
 * The same goes for a lyrics theme with a background of its own; a song with
 * no lyrics theme inherits scripture's look without its background.
 */
export function themeOwnsBackground(theme: OverlayTheme): boolean {
  return theme.background.type !== 'transparent'
}

/** The theme with no background at all — what a screen with Backgrounds off draws text on. */
export function withoutBackground(theme: OverlayTheme): OverlayTheme {
  if (theme.background.type === 'transparent') return theme
  return { ...theme, background: { ...theme.background, type: 'transparent' } }
}

/**
 * The theme a slide goes out with on one output — the single rule the push
 * (orchestrator) and the operator's preview both use. Backgrounds off: no
 * background at all. Otherwise the live dock background fills in, unless the
 * theme has its own; `force` is the dock's own "present this background".
 */
export function themeForPush(
  theme: OverlayTheme,
  options: {
    showsBackgrounds: boolean
    live: { kind: MediaKind; path: string } | null
    playback?: MediaPlayback
    force?: boolean
  },
): OverlayTheme {
  if (!options.showsBackgrounds) return withoutBackground(theme)
  if (!options.live || (!options.force && themeOwnsBackground(theme))) return theme
  return themeWithLiveMedia(theme, options.live, options.playback)
}
