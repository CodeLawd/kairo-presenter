/**
 * Read-only ProPresenter resources exposed to the renderer.
 *
 * This module intentionally contains no Electron or network code. It is shared
 * by the main process, preload bridge, and renderer so a ProPresenter UUID is
 * treated as the resource identity everywhere.
 */

export type PPResourceKind =
  | 'theme'
  | 'macro'
  | 'look'
  | 'message'
  | 'prop'
  | 'media'
  | 'mask'
  | 'stageLayout'
  | 'videoInput'
  | 'clearGroup'
  | 'library'
  | 'playlist'

export type PPPreviewKind = 'thumbnail' | 'icon' | 'text' | 'details' | 'none'

export interface PPResourceSummary {
  id: string
  kind: PPResourceKind
  name: string
  collectionId?: string
  collectionName?: string
  childCount?: number
  previewKind: PPPreviewKind
  subtitle?: string
}

export interface PPResourceCatalogue {
  refreshedAt: number
  resources: PPResourceSummary[]
  warnings: Array<{ kind: PPResourceKind; message: string }>
}

export interface PPResourcePreview {
  resourceId: string
  kind: PPResourceKind
  previewKind: PPPreviewKind
  mimeType?: string
  dataUrl?: string
  text?: string
  details?: Record<string, unknown>
}

export interface PPResourceBindings {
  scriptureThemeId: string
  lyricsThemeId: string
  lowerThirdMessageId: string
  defaultLookId: string
  ndiVideoInputId: string
  confidenceStageLayoutId: string
  clearGroupId: string
  serviceStartMacroId: string
}

export const EMPTY_PP_RESOURCE_BINDINGS: PPResourceBindings = {
  scriptureThemeId: '',
  lyricsThemeId: '',
  lowerThirdMessageId: '',
  defaultLookId: '',
  ndiVideoInputId: '',
  confidenceStageLayoutId: '',
  clearGroupId: '',
  serviceStartMacroId: '',
}

export type PPResourceBindingKey = keyof PPResourceBindings

export interface PPValidatedBinding {
  id: string
  missing: boolean
  resource: PPResourceSummary | null
}

export interface PPValidatedResourceBindings {
  scriptureTheme: PPValidatedBinding
  lyricsTheme: PPValidatedBinding
  lowerThirdMessage: PPValidatedBinding
  defaultLook: PPValidatedBinding
  ndiVideoInput: PPValidatedBinding
  confidenceStageLayout: PPValidatedBinding
  clearGroup: PPValidatedBinding
  serviceStartMacro: PPValidatedBinding
}

/**
 * Heals old/partial settings without allowing arbitrary keys or non-string ids
 * into the durable binding object.
 */
export function normalizeResourceBindings(value: unknown): PPResourceBindings {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const bindings = { ...EMPTY_PP_RESOURCE_BINDINGS }

  for (const key of Object.keys(EMPTY_PP_RESOURCE_BINDINGS) as PPResourceBindingKey[]) {
    const raw = source[key]
    if (typeof raw === 'string') bindings[key] = raw.trim()
  }

  return bindings
}

const BINDING_DESCRIPTORS: ReadonlyArray<{
  key: PPResourceBindingKey
  resultKey: keyof PPValidatedResourceBindings
  kind: PPResourceKind
}> = [
  { key: 'scriptureThemeId', resultKey: 'scriptureTheme', kind: 'theme' },
  { key: 'lyricsThemeId', resultKey: 'lyricsTheme', kind: 'theme' },
  { key: 'lowerThirdMessageId', resultKey: 'lowerThirdMessage', kind: 'message' },
  { key: 'defaultLookId', resultKey: 'defaultLook', kind: 'look' },
  { key: 'ndiVideoInputId', resultKey: 'ndiVideoInput', kind: 'videoInput' },
  { key: 'confidenceStageLayoutId', resultKey: 'confidenceStageLayout', kind: 'stageLayout' },
  { key: 'clearGroupId', resultKey: 'clearGroup', kind: 'clearGroup' },
  { key: 'serviceStartMacroId', resultKey: 'serviceStartMacro', kind: 'macro' },
]

const PREVIEW_KINDS: Record<PPResourceKind, PPPreviewKind> = {
  theme: 'thumbnail',
  macro: 'icon',
  look: 'details',
  message: 'text',
  prop: 'thumbnail',
  media: 'thumbnail',
  mask: 'thumbnail',
  stageLayout: 'thumbnail',
  videoInput: 'none',
  clearGroup: 'details',
  library: 'none',
  playlist: 'none',
}

/** Returns a stable UUID/string identifier from the common PP wire shapes. */
export function normalizeResourceId(value: unknown): string {
  const visit = (candidate: unknown, depth: number): string => {
    if (depth > 4 || candidate == null) return ''
    if (typeof candidate === 'string') return candidate.trim()
    if (typeof candidate !== 'object') return ''

    const record = candidate as Record<string, unknown>
    if (typeof record.uuid === 'string' && record.uuid.trim()) return record.uuid.trim()
    if ('id' in record) return visit(record.id, depth + 1)
    return ''
  }

  return visit(value, 0)
}

/** Returns the renderer-safe preview mode for a supported resource kind. */
export function resourcePreviewKind(kind: PPResourceKind): PPPreviewKind {
  return PREVIEW_KINDS[kind]
}

/**
 * Resolves saved UUID bindings against the latest catalogue. Empty values are
 * unconfigured; non-empty values that no longer exist are explicitly missing.
 */
export function validateResourceBindings(
  bindings: PPResourceBindings,
  catalogue: Pick<PPResourceCatalogue, 'resources'> & Partial<Pick<PPResourceCatalogue, 'refreshedAt'>>,
): PPValidatedResourceBindings {
  const byKey = new Map(
    catalogue.resources.map((resource) => [`${resource.kind}:${resource.id}`, resource] as const),
  )

  const result = {} as PPValidatedResourceBindings
  for (const descriptor of BINDING_DESCRIPTORS) {
    const id = typeof bindings[descriptor.key] === 'string' ? bindings[descriptor.key] : ''
    const resource = id ? byKey.get(`${descriptor.kind}:${id}`) ?? null : null
    result[descriptor.resultKey] = {
      id,
      missing: Boolean(id) && resource === null,
      resource,
    }
  }

  return result
}
