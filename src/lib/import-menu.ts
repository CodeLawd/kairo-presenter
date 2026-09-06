export const IMPORT_OPTIONS = [
  { kind: 'pdf', label: 'PDF document…', route: 'documents' },
  { kind: 'powerpoint', label: 'PowerPoint presentation…', route: 'documents' },
  { kind: 'image', label: 'Images…', route: 'operator' },
  { kind: 'video', label: 'Videos…', route: 'operator' },
  { kind: 'audio', label: 'Audio files…', route: 'operator' },
  { kind: 'sermon', label: 'Sermon notes…', route: 'scripture' },
  { kind: 'lyrics', label: 'Lyrics file…', route: 'lyrics' },
] as const
export type ImportKind = typeof IMPORT_OPTIONS[number]['kind']
export function isImportKind(value: unknown): value is ImportKind {
  return IMPORT_OPTIONS.some(option => option.kind === value)
}
