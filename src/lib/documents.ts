export interface ProjectionDocument {
  id: string
  name: string
  format: 'pdf' | 'ppt' | 'pptx'
  pages: string[]
}

export type PowerpointConverterId = 'powerpoint' | 'wps' | 'keynote' | 'libreoffice' | 'builtin'

export interface DocumentsCapabilities {
  /** Installed converters that can turn PPT/PPTX into a PDF. */
  converters: PowerpointConverterId[]
  /** True when at least one converter is installed. */
  canConvertPowerPoint: boolean
  /** Kept for older preload builds that only knew LibreOffice. */
  libreOffice: boolean
}

export interface DocumentsAPI {
  list(): Promise<ProjectionDocument[]>
  capabilities(): Promise<DocumentsCapabilities>
  prepare(kind?: 'pdf' | 'powerpoint'): Promise<{ id: string; data: Uint8Array } | null>
  savePage(id: string, page: number, png: Uint8Array): Promise<void>
  finish(id: string): Promise<ProjectionDocument[]>
  cancel(id: string): Promise<void>
  rename(id: string, name: string): Promise<ProjectionDocument[]>
  remove(id: string): Promise<ProjectionDocument[]>
  push(id: string, page: number): Promise<{ applied: boolean }>
}

export const DOCUMENTS = {
  LIST: 'documents:list', CAPABILITIES: 'documents:capabilities', PREPARE: 'documents:prepare', SAVE_PAGE: 'documents:savePage',
  FINISH: 'documents:finish', CANCEL: 'documents:cancel', RENAME: 'documents:rename', REMOVE: 'documents:remove', PUSH: 'documents:push',
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
