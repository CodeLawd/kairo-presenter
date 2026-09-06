import {
  resourcePreviewKind,
  normalizeResourceId,
} from '@shared/propresenter-resources'
import type {
  PPPreviewKind,
  PPResourceCatalogue,
  PPResourceKind,
  PPResourcePreview,
  PPResourceSummary,
} from '@shared/propresenter-resources'
import type { PPBinaryAsset } from './types'

const MAX_COLLECTION_CONCURRENCY = 4
const MAX_PREVIEW_ENTRIES = 100
const MAX_PREVIEW_BYTES = 40 * 1024 * 1024

const RESOURCE_DESCRIPTORS: ReadonlyArray<{ kind: PPResourceKind; path: string }> = [
  { kind: 'theme', path: '/v1/themes' },
  { kind: 'macro', path: '/v1/macros' },
  { kind: 'look', path: '/v1/looks' },
  { kind: 'message', path: '/v1/messages' },
  { kind: 'prop', path: '/v1/props' },
  { kind: 'media', path: '/v1/media/playlists' },
  { kind: 'mask', path: '/v1/masks' },
  { kind: 'stageLayout', path: '/v1/stage/layouts' },
  { kind: 'videoInput', path: '/v1/video_inputs' },
  { kind: 'clearGroup', path: '/v1/clear/groups' },
  { kind: 'library', path: '/v1/libraries' },
  { kind: 'playlist', path: '/v1/playlists' },
]

export interface ResourceCollectionOutcome {
  items: unknown[]
  error?: unknown
}

export interface ProPresenterResourceClient {
  getResourceCollection: (path: string) => Promise<unknown[]>
  getResourceCollectionOutcome?: (path: string) => Promise<ResourceCollectionOutcome>
  getResourceDetails: (path: string) => Promise<Record<string, unknown> | null>
  getBinaryAsset: (
    path: string,
    params?: Record<string, string | number>,
  ) => Promise<PPBinaryAsset | null>
}

interface PreviewCacheEntry {
  preview: PPResourcePreview
  sizeBytes: number
  lastUsed: number
}

interface LoadedPreview {
  preview: PPResourcePreview
  sizeBytes: number
}

const RESOURCE_KIND_SET = new Set<PPResourceKind>([
  'theme',
  'macro',
  'look',
  'message',
  'prop',
  'media',
  'mask',
  'stageLayout',
  'videoInput',
  'clearGroup',
  'library',
  'playlist',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function recordValue(record: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return undefined
}

function numericValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  }
  return undefined
}

function normalizeSummary(kind: PPResourceKind, raw: unknown): PPResourceSummary | null {
  const record = isRecord(raw) ? raw : {}
  const nestedId = isRecord(record.id) ? record.id : {}
  const id = normalizeResourceId(raw)
  if (!id) return null

  const name = stringValue(
    record.name,
    record.title,
    record.label,
    record.display_name,
    nestedId.name,
    typeof raw === 'string' ? raw : undefined,
    id,
  )

  const collection = recordValue(record, 'collection', 'folder', 'group')
  const collectionRecord = isRecord(collection) ? collection : {}
  const collectionId = stringValue(
    normalizeResourceId(collection),
    record.collectionId,
    record.collection_id,
    record.collection_uuid,
  )
  const collectionName = stringValue(
    collectionRecord.name,
    record.collectionName,
    record.collection_name,
  )

  const childList = [record.slides, record.items, record.children].find(Array.isArray)
  const childCount = numericValue(
    childList ? (childList as unknown[]).length : undefined,
    record.childCount,
    record.child_count,
    record.slide_count,
    record.total_count,
  )
  const subtitle = stringValue(
    record.subtitle,
    record.description,
    record.artist,
    record.type,
    record.path,
  )

  return {
    id,
    kind,
    name,
    ...(collectionId ? { collectionId } : {}),
    ...(collectionName ? { collectionName } : {}),
    ...(childCount !== undefined ? { childCount } : {}),
    previewKind: resourcePreviewKind(kind),
    ...(subtitle ? { subtitle } : {}),
  }
}

function mergeSummary(previous: PPResourceSummary, next: PPResourceSummary): PPResourceSummary {
  return {
    ...previous,
    ...(previous.name === previous.id && next.name !== next.id ? { name: next.name } : {}),
    ...(previous.collectionId === undefined && next.collectionId !== undefined
      ? { collectionId: next.collectionId }
      : {}),
    ...(previous.collectionName === undefined && next.collectionName !== undefined
      ? { collectionName: next.collectionName }
      : {}),
    ...(previous.childCount === undefined && next.childCount !== undefined
      ? { childCount: next.childCount }
      : {}),
    ...(previous.subtitle === undefined && next.subtitle !== undefined
      ? { subtitle: next.subtitle }
      : {}),
  }
}

function compareResource(a: PPResourceSummary, b: PPResourceSummary): number {
  const kind = a.kind.localeCompare(b.kind)
  if (kind !== 0) return kind
  const collection = (a.collectionName ?? '').localeCompare(b.collectionName ?? '')
  if (collection !== 0) return collection
  const name = a.name.localeCompare(b.name)
  if (name !== 0) return name
  return a.id.localeCompare(b.id)
}

function errorStatus(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined
  const response = error.response
  if (!isRecord(response)) return undefined
  return typeof response.status === 'number' ? response.status : undefined
}

function discoveryWarning(kind: PPResourceKind, error: unknown): string {
  if (errorStatus(error) === 404) return 'Unavailable in this ProPresenter version'
  const message = error instanceof Error ? error.message : String(error || 'request failed')
  return `Could not load ${kind} resources: ${message}`
}

function encodePath(...segments: string[]): string {
  return `/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`
}

function detailPath(kind: PPResourceKind, id: string): string | null {
  switch (kind) {
    case 'theme': return encodePath('v1', 'theme', id)
    case 'macro': return encodePath('v1', 'macro', id)
    case 'look': return encodePath('v1', 'look', id)
    case 'message': return encodePath('v1', 'message', id)
    case 'prop': return encodePath('v1', 'prop', id)
    case 'media': return encodePath('v1', 'media', 'playlist', id)
    case 'mask': return encodePath('v1', 'mask', id)
    case 'stageLayout': return encodePath('v1', 'stage', 'layout', id)
    case 'clearGroup': return encodePath('v1', 'clear', 'group', id)
    case 'library': return encodePath('v1', 'library', id)
    case 'playlist': return encodePath('v1', 'playlist', id)
    case 'videoInput': return null
  }
}

function sanitizeDetailValue(value: unknown, depth = 0): unknown {
  if (depth > 5 || value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 4_096)
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeDetailValue(item, depth + 1))
  if (!isRecord(value)) return undefined

  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase()
    if (
      normalizedKey.includes('html') ||
      normalizedKey.includes('svg') ||
      normalizedKey.includes('thumbnail') ||
      normalizedKey.includes('dataurl') ||
      normalizedKey === 'bytes' ||
      normalizedKey === 'image'
    ) continue
    const sanitized = sanitizeDetailValue(child, depth + 1)
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

function extractMessageText(details: Record<string, unknown> | null): string {
  if (!details) return ''
  const direct = stringValue(details.message, details.template, details.text)
  if (direct) return direct
  if (Array.isArray(details.tokens)) {
    return details.tokens
      .filter(isRecord)
      .map((token) => {
        const name = stringValue(token.name)
        return name ? `{${name}}` : ''
      })
      .filter(Boolean)
      .join(' ')
  }
  return ''
}

export class ProPresenterResourcesService {
  private readonly client: ProPresenterResourceClient
  private catalogue: PPResourceCatalogue | null = null
  private cataloguePromise: Promise<PPResourceCatalogue> | null = null
  private generation = 0
  private previewBytes = 0
  private previewClock = 0
  private readonly previewCache = new Map<string, PreviewCacheEntry>()
  private readonly previewPromises = new Map<string, Promise<LoadedPreview>>()

  constructor(client: ProPresenterResourceClient) {
    this.client = client
  }

  async getCatalogue(options: { refresh?: boolean } = {}): Promise<PPResourceCatalogue> {
    if (!options.refresh && this.catalogue) return this.catalogue
    if (this.cataloguePromise) return this.cataloguePromise

    const generation = this.generation
    const promise = this.discoverCatalogue()
    this.cataloguePromise = promise
    try {
      const result = await promise
      if (generation === this.generation) this.catalogue = result
      return result
    } finally {
      if (this.cataloguePromise === promise) this.cataloguePromise = null
    }
  }

  async getDetails(kind: PPResourceKind, id: string): Promise<Record<string, unknown> | null> {
    this.assertResourceInput(kind, id)
    const path = detailPath(kind, id)
    if (!path) return null
    const details = await this.client.getResourceDetails(path)
    if (!details) return null
    const sanitized = sanitizeDetailValue(details)
    return isRecord(sanitized) ? sanitized : null
  }

  async getPreview(kind: PPResourceKind, id: string, childId?: string): Promise<PPResourcePreview> {
    this.assertResourceInput(kind, id)
    if (childId !== undefined && (typeof childId !== 'string' || childId.length === 0 || childId.length > 512)) {
      throw new Error('Invalid ProPresenter resource child id')
    }

    const key = `${kind}:${id}:${childId ?? ''}`
    const cached = this.previewCache.get(key)
    if (cached) {
      cached.lastUsed = ++this.previewClock
      return cached.preview
    }

    const pending = this.previewPromises.get(key)
    if (pending) return (await pending).preview

    const generation = this.generation
    const promise = this.loadPreview(kind, id, childId)
    this.previewPromises.set(key, promise)
    try {
      const loaded = await promise
      // A disconnect can invalidate the cache while the network request is in
      // flight. The old caller may still receive its result, but it must not
      // repopulate the cache that belongs to the next ProPresenter connection.
      if (generation === this.generation) this.cachePreview(key, loaded)
      return loaded.preview
    } finally {
      if (this.previewPromises.get(key) === promise) this.previewPromises.delete(key)
    }
  }

  invalidate(): void {
    this.generation++
    this.catalogue = null
    this.cataloguePromise = null
    this.previewPromises.clear()
    this.previewCache.clear()
    this.previewBytes = 0
    this.previewClock = 0
  }

  private async discoverCatalogue(): Promise<PPResourceCatalogue> {
    const rawResults: unknown[][] = RESOURCE_DESCRIPTORS.map(() => [])
    const warnings: Array<{ kind: PPResourceKind; message: string }> = []
    let nextIndex = 0

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++
        if (index >= RESOURCE_DESCRIPTORS.length) return
        const descriptor = RESOURCE_DESCRIPTORS[index]
        try {
          const outcome = this.client.getResourceCollectionOutcome
            ? await this.client.getResourceCollectionOutcome(descriptor.path)
            : { items: await this.client.getResourceCollection(descriptor.path) }
          rawResults[index] = outcome.items
          if (outcome.error) warnings.push({ kind: descriptor.kind, message: discoveryWarning(descriptor.kind, outcome.error) })
        } catch (error) {
          warnings.push({ kind: descriptor.kind, message: discoveryWarning(descriptor.kind, error) })
        }
      }
    }

    await Promise.all(
      Array.from(
        { length: Math.min(MAX_COLLECTION_CONCURRENCY, RESOURCE_DESCRIPTORS.length) },
        () => worker(),
      ),
    )

    const byKey = new Map<string, PPResourceSummary>()
    for (let index = 0; index < RESOURCE_DESCRIPTORS.length; index++) {
      const { kind } = RESOURCE_DESCRIPTORS[index]
      for (const raw of rawResults[index]) {
        const summary = normalizeSummary(kind, raw)
        if (!summary) continue
        const key = `${summary.kind}:${summary.id}`
        const previous = byKey.get(key)
        byKey.set(key, previous ? mergeSummary(previous, summary) : summary)
      }
    }

    warnings.splice(0, warnings.length, ...this.dedupeWarnings(warnings))
    return {
      refreshedAt: Date.now(),
      resources: [...byKey.values()].sort(compareResource),
      warnings,
    }
  }

  private dedupeWarnings(warnings: Array<{ kind: PPResourceKind; message: string }>): Array<{ kind: PPResourceKind; message: string }> {
    const seen = new Set<string>()
    return warnings.filter((warning) => {
      const key = `${warning.kind}:${warning.message}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  private assertResourceInput(kind: PPResourceKind, id: string): void {
    if (!RESOURCE_KIND_SET.has(kind)) throw new Error('Unknown ProPresenter resource kind')
    if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
      throw new Error('Invalid ProPresenter resource id')
    }
  }

  private async loadPreview(kind: PPResourceKind, id: string, childId?: string): Promise<LoadedPreview> {
    const previewKind: PPPreviewKind = resourcePreviewKind(kind)
    const base: PPResourcePreview = { resourceId: id, kind, previewKind }

    if (previewKind === 'none') return { preview: base, sizeBytes: 0 }

    if (previewKind === 'text') {
      const details = await this.getDetails(kind, id)
      const text = extractMessageText(details)
      return {
        preview: { ...base, text: text || 'Preview unavailable' },
        sizeBytes: text.length,
      }
    }

    if (previewKind === 'details') {
      const details = await this.getDetails(kind, id)
      return {
        preview: { ...base, details: details ?? {} },
        sizeBytes: details ? Buffer.byteLength(JSON.stringify(details)) : 0,
      }
    }

    if (kind === 'theme' && !childId) return { preview: base, sizeBytes: 0 }

    const path = this.previewPath(kind, id, childId)
    if (!path) return { preview: base, sizeBytes: 0 }
    const asset = await this.client.getBinaryAsset(path, { quality: 512 })
    if (!asset) return { preview: base, sizeBytes: 0 }

    return {
      preview: {
        ...base,
        mimeType: asset.mimeType,
        dataUrl: `data:${asset.mimeType};base64,${Buffer.from(asset.bytes).toString('base64')}`,
      },
      sizeBytes: asset.bytes.byteLength,
    }
  }

  private previewPath(kind: PPResourceKind, id: string, childId?: string): string | null {
    switch (kind) {
      case 'theme': return childId ? encodePath('v1', 'theme', id, 'slides', childId, 'thumbnail') : null
      case 'macro': return encodePath('v1', 'macro', id, 'icon')
      case 'prop': return encodePath('v1', 'prop', id, 'thumbnail')
      case 'media': return encodePath('v1', 'media', id, 'thumbnail')
      case 'mask': return encodePath('v1', 'mask', id, 'thumbnail')
      case 'stageLayout': return encodePath('v1', 'stage', 'layout', id, 'thumbnail')
      default: return null
    }
  }

  private cachePreview(key: string, loaded: LoadedPreview): void {
    if (loaded.sizeBytes > MAX_PREVIEW_BYTES) return
    const previous = this.previewCache.get(key)
    if (previous) {
      this.previewBytes -= previous.sizeBytes
      this.previewCache.delete(key)
    }

    while (
      this.previewCache.size >= MAX_PREVIEW_ENTRIES ||
      this.previewBytes + loaded.sizeBytes > MAX_PREVIEW_BYTES
    ) {
      const oldest = [...this.previewCache.entries()].sort(([, a], [, b]) => a.lastUsed - b.lastUsed)[0]
      if (!oldest) break
      this.previewCache.delete(oldest[0])
      this.previewBytes -= oldest[1].sizeBytes
    }

    this.previewCache.set(key, {
      preview: loaded.preview,
      sizeBytes: loaded.sizeBytes,
      lastUsed: ++this.previewClock,
    })
    this.previewBytes += loaded.sizeBytes
  }
}

/** Configured by the ProPresenter service once its client is constructed. */
let configuredClient: ProPresenterResourceClient | null = null

export const proPresenterResources = new ProPresenterResourcesService({
  getResourceCollection: async (path) => configuredClient?.getResourceCollection(path) ?? [],
  getResourceCollectionOutcome: async (path) => configuredClient?.getResourceCollectionOutcome
    ? configuredClient.getResourceCollectionOutcome(path)
    : { items: configuredClient ? await configuredClient.getResourceCollection(path) : [] },
  getResourceDetails: async (path) => configuredClient?.getResourceDetails(path) ?? null,
  getBinaryAsset: async (path, params) => configuredClient?.getBinaryAsset(path, params) ?? null,
})

export function configureProPresenterResourceClient(client: ProPresenterResourceClient): void {
  configuredClient = client
  proPresenterResources.invalidate()
}
