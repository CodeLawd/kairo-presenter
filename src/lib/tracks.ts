/** House-audio files — local speakers only, never NDI / backgrounds. */
export const TRACK_FILE_EXTENSIONS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] as const

export const TRACK_EXT = new Set<string>(TRACK_FILE_EXTENSIONS)

export function isTrackExtension(ext: string): boolean {
  return TRACK_EXT.has(ext.toLowerCase().replace(/^\./, ''))
}

/**
 * Audio lives next to the backgrounds folder, not inside it.
 * `…/Kairo Presenter/Media` → `…/Kairo Presenter/Audio`
 */
export function siblingAudioFolder(mediaFolder: string): string {
  const trimmed = mediaFolder.replace(/[/\\]+$/, '')
  const sep = trimmed.includes('\\') && !trimmed.includes('/') ? '\\' : '/'
  const parts = trimmed.split(/[/\\]/).filter(Boolean)
  if (parts.length === 0) return trimmed
  parts[parts.length - 1] = 'Audio'
  if (/^[A-Za-z]:$/.test(parts[0])) {
    return `${parts[0]}\\${parts.slice(1).join('\\')}`
  }
  return `${trimmed.startsWith('/') ? '/' : ''}${parts.join(sep)}`.replace(/\/{2,}/g, '/')
}
