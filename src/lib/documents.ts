export interface ProjectionDocument {
  id: string
  name: string
  format: 'pdf' | 'ppt' | 'pptx'
  pages: string[]
  /** Original slide aspect ratio and embedded videos; absent in older imports. */
  slideSize?: { width: number; height: number }
  videos?: DocumentVideo[][]
  warnings?: string[]
}

export interface DocumentVideo {
  /** Cached media filename; absolute paths are resolved only by the main process. */
  file: string
  box: { x: number; y: number; width: number; height: number }
  start: number
  end?: number
}

export interface DocumentSlide {
  id: string
  page: number
  path: string
  width: number
  height: number
  videos: DocumentVideo[]
}

export interface DocumentVideoStatus {
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  visible: boolean
  error: string | null
}

export interface DocumentPlaybackStatus {
  id: string
  page: number
  videos: DocumentVideoStatus[]
}

export type DocumentVideoCommand = { action: 'pause' | 'play' | 'restart' } | { action: 'seek'; seconds: number }

export type PowerpointConverterId = 'powerpoint' | 'wps' | 'keynote' | 'libreoffice' | 'builtin'

export interface DocumentsCapabilities {
  /** Installed converters that can turn PPT/PPTX into a PDF. */
  converters: PowerpointConverterId[]
  /** True when at least one converter is installed. */
  canConvertPowerPoint: boolean
  /** Kept for older preload builds that only knew LibreOffice. */
  libreOffice: boolean
}

/** Unattended page advance — announcement loops, pre-service slides. */
export interface DocumentsSettings {
  /** Seconds each page stays on screen before the next one is pushed. */
  slideshowSec: number
  /** Return to page 1 after the last page instead of stopping. */
  slideshowLoop: boolean
  /** Begin advancing as soon as a page is pushed, with no second click. */
  slideshowAutoStart: boolean
}

export const SLIDESHOW_MIN_SEC = 2
export const SLIDESHOW_MAX_SEC = 3600
export const DEFAULT_DOCUMENTS_SETTINGS: DocumentsSettings = {
  slideshowSec: 10,
  slideshowLoop: true,
  slideshowAutoStart: false,
}

/** Clamp anything a renderer or an old store hands us into a usable config. */
export function normalizeDocumentsSettings(raw: unknown): DocumentsSettings {
  const value = (raw ?? {}) as Partial<DocumentsSettings>
  const seconds = Number(value.slideshowSec)
  return {
    slideshowSec: Number.isFinite(seconds)
      ? Math.min(SLIDESHOW_MAX_SEC, Math.max(SLIDESHOW_MIN_SEC, Math.round(seconds)))
      : DEFAULT_DOCUMENTS_SETTINGS.slideshowSec,
    slideshowLoop: value.slideshowLoop ?? DEFAULT_DOCUMENTS_SETTINGS.slideshowLoop,
    slideshowAutoStart: value.slideshowAutoStart ?? DEFAULT_DOCUMENTS_SETTINGS.slideshowAutoStart,
  }
}

export interface DocumentImportInfo {
  name: string
  format: ProjectionDocument['format']
  sizeBytes: number
  maxSizeBytes: number
}

export function formatDocumentSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface DocumentsAPI {
  list(): Promise<ProjectionDocument[]>
  capabilities(): Promise<DocumentsCapabilities>
  prepare(kind?: 'pdf' | 'powerpoint', onPreparing?: (document: DocumentImportInfo) => void): Promise<{ id: string; data: Uint8Array; name: string; format: ProjectionDocument['format'] } | null>
  savePage(id: string, page: number, png: Uint8Array): Promise<void>
  finish(id: string): Promise<ProjectionDocument[]>
  cancel(id: string): Promise<void>
  rename(id: string, name: string): Promise<ProjectionDocument[]>
  remove(id: string): Promise<ProjectionDocument[]>
  push(id: string, page: number): Promise<{ applied: boolean }>
  playback(id: string, page: number): Promise<DocumentPlaybackStatus | null>
  control(id: string, page: number, video: number, command: DocumentVideoCommand): Promise<void>
}

export const DOCUMENTS = {
  LIST: 'documents:list', CAPABILITIES: 'documents:capabilities', PREPARE: 'documents:prepare', SAVE_PAGE: 'documents:savePage',
  FINISH: 'documents:finish', CANCEL: 'documents:cancel', RENAME: 'documents:rename', REMOVE: 'documents:remove', PUSH: 'documents:push',
  PREPARING: 'documents:preparing', PLAYBACK: 'documents:playback', CONTROL: 'documents:control',
} as const

/** Strip Electron's invoke wrapper so operators see the real reason. */
export function documentsErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
}

export const POWERPOINT_NEEDS_CONVERTER =
  'This older .ppt file needs PowerPoint, WPS, Keynote, or LibreOffice. Save it as .pptx or export a PDF and import that instead.'

/** @deprecated Use POWERPOINT_NEEDS_CONVERTER. */
export const POWERPOINT_NEEDS_LIBREOFFICE = POWERPOINT_NEEDS_CONVERTER

export function validDocumentPage(page: number, count: number): boolean {
  return Number.isInteger(page) && page >= 0 && page < count
}

/** Display name for an imported document — not a filesystem path. */
export function normalizeDocumentName(name: string): string {
  // eslint-disable-next-line no-control-regex -- stripping C0 controls from display names is the point.
  const trimmed = name.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  if (!trimmed) throw new Error('Enter a name for this document.')
  if (trimmed.length > 120) throw new Error('Document names can be up to 120 characters.')
  if (/[/\\]/.test(trimmed)) throw new Error('Document names cannot include slashes.')
  return trimmed
}

export function canConvertPowerPoint(capabilities: DocumentsCapabilities | null | undefined): boolean {
  if (!capabilities) return false
  if (capabilities.canConvertPowerPoint) return true
  if (capabilities.converters?.length) return true
  return capabilities.libreOffice === true
}
