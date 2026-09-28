import type {
  LyricsSong,
  OverlayContentKind,
  ScriptureTranslation,
  ScriptureVerse,
} from './ipc'
import type { LyricSlide } from './lyrics-slides'

/** The last content Kairo sent to its outputs, for cross-tab review. */
export interface LiveOutputPayload {
  kind: OverlayContentKind
  /** Bible reference for scripture, or song/section label for lyrics. */
  reference: string
  /** Text exactly as it was sent to the output layer. */
  text: string
  /** Per-line paint colors for lyric glosses — parallel to `text` split on newlines. */
  lineColors?: (string | undefined)[]
  /** Preserved when a scripture result is available for WYSIWYG rendering. */
  verses?: ScriptureVerse[]
  translation?: ScriptureTranslation
}

/** Builds the cross-tab review payload for a lyric slide push. */
export function buildLyricsLiveOutputPayload(
  song: LyricsSong,
  slide: LyricSlide | undefined,
): LiveOutputPayload {
  return {
    kind: 'lyrics',
    reference: slide?.sectionLabel ? `${song.title} · ${slide.sectionLabel}` : song.title,
    text: slide?.lines.join('\n') ?? '',
    lineColors: slide?.lineColors,
  }
}
