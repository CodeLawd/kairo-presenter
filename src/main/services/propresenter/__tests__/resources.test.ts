import assert from 'node:assert/strict'
import test from 'node:test'
import { ProPresenterClient } from '../client'
import { ProPresenterResourcesService } from '../resources'

type FakeResponse = {
  data: unknown
  headers?: Record<string, string>
}

type SeenRequest = {
  path: string
  config?: Record<string, unknown>
}

function makeClientReplying(
  reply: FakeResponse | ((path: string, config?: Record<string, unknown>) => FakeResponse),
): { client: ProPresenterClient; seen: SeenRequest[] } {
  const client = new ProPresenterClient()
  const seen: SeenRequest[] = []
  const http = {
    get: async (path: string, config?: Record<string, unknown>): Promise<FakeResponse> => {
      seen.push({ path, config })
      return typeof reply === 'function' ? reply(path, config) : reply
    },
  }
  ;(client as unknown as { http: typeof http }).http = http
  return { client, seen }
}

test('resource collection accepts raw, items, and collections response envelopes', async () => {
  const envelopes: unknown[] = [
    [{ uuid: 'raw-1' }],
    { items: [{ uuid: 'items-1' }] },
    { collections: [{ uuid: 'collections-1' }] },
  ]

  for (const envelope of envelopes) {
    const { client } = makeClientReplying({ data: envelope })
    const result = await client.getResourceCollection('/v1/themes')
    assert.deepEqual(result, Array.isArray(envelope) ? envelope : (envelope as { items?: unknown[]; collections?: unknown[] }).items ?? (envelope as { collections: unknown[] }).collections)
  }
})

test('clearing ProAutomate output keeps the bound video input selected in PP', async () => {
  const { client, seen } = makeClientReplying({ data: null })

  await client.clearAll({ clearVideoInput: false })

  assert.deepEqual(seen.map((request) => request.path), ['/v1/clear/layer/slide'])
})

test('reads thumbnail bytes and MIME type without mutation', async () => {
  const { client, seen } = makeClientReplying({
    data: Uint8Array.from([137, 80, 78, 71]),
    headers: { 'content-type': 'image/png; charset=utf-8' },
  })
  const asset = await client.getBinaryAsset('/v1/theme/t1/slides/title/thumbnail', { quality: 512 })

  assert.equal(asset?.mimeType, 'image/png')
  assert.deepEqual([...asset!.bytes], [137, 80, 78, 71])
  assert.equal(seen[0].config?.responseType, 'arraybuffer')
  assert.deepEqual(seen[0].config?.params, { quality: 512 })
})

test('resource detail and thumbnail wrappers encode every path segment and use GET', async () => {
  const { client, seen } = makeClientReplying({ data: {} })

  await client.getTheme('theme/one')
  await client.getThemeSlideThumbnail('theme/one', 'slide two')
  await client.getMacroIcon('macro/one')

  assert.deepEqual(seen.map((request) => request.path), [
    '/v1/theme/theme%2Fone',
    '/v1/theme/theme%2Fone/slides/slide%20two/thumbnail',
    '/v1/macro/macro%2Fone/icon',
  ])
  assert.equal(seen.every((request) => request.config?.method === undefined), true)
})

test('rejects unsupported or oversized binary resources without returning bytes', async () => {
  const unsupported = makeClientReplying({
    data: Uint8Array.from([1]),
    headers: { 'content-type': 'application/octet-stream' },
  })
  assert.equal(await unsupported.client.getBinaryAsset('/v1/mask/m1/thumbnail'), null)

  const oversized = makeClientReplying({
    data: new Uint8Array(5 * 1024 * 1024 + 1),
    headers: { 'content-type': 'image/webp' },
  })
  assert.equal(await oversized.client.getBinaryAsset('/v1/mask/m1/thumbnail'), null)
})

test('native presentation creation carries a selected theme and preserves the empty path', async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = []
  const client = new ProPresenterClient()
  ;(client as unknown as { http: unknown }).http = {
    get: async (path: string): Promise<FakeResponse> => {
      requests.push({ method: 'GET', path })
      return { data: [{ uuid: 'library-1', name: 'Main' }] }
    },
    put: async (path: string, body: unknown): Promise<FakeResponse> => {
      requests.push({ method: 'PUT', path, body })
      return { data: { id: { uuid: 'presentation-1', name: 'Sunday', index: 0 }, slide_groups: [] } }
    },
    post: async (path: string, body: unknown): Promise<FakeResponse> => {
      requests.push({ method: 'POST', path, body })
      return { data: null }
    },
  }

  const slide = { label: 'Verse 1', lines: ['In the beginning'] }
  await client.createPresentation('Sunday', [slide], { themeId: 'theme-1' })
  const themedBody = requests.find((request) => request.method === 'PUT')?.body as { theme?: { uuid: string } }
  assert.equal(themedBody.theme?.uuid, 'theme-1')

  requests.length = 0
  await client.createPresentation('Sunday', [slide])
  const unthemedBody = requests.find((request) => request.method === 'PUT')?.body as { theme?: unknown }
  assert.equal('theme' in unthemedBody, false)
  assert.equal(requests.every((request) => request.method === 'GET' || request.method === 'PUT'), true)
})

test('bound messages trigger directly with tokens without creating a message', async () => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = []
  const client = new ProPresenterClient()
  ;(client as unknown as { http: unknown }).http = {
    get: async (path: string): Promise<FakeResponse> => {
      requests.push({ method: 'GET', path })
      return { data: {} }
    },
    post: async (path: string, body: unknown): Promise<FakeResponse> => {
      requests.push({ method: 'POST', path, body })
      return { data: null }
    },
  }

  assert.equal(await client.showBoundMessage('message-1', 'John 3:16', 'For God so loved'), true)
  assert.deepEqual(requests, [{
    method: 'POST',
    path: '/v1/message/message-1/trigger',
    body: [
      { name: 'Reference', text: { text: 'John 3:16' } },
      { name: 'Text', text: { text: 'For God so loved' } },
    ],
  }])
})

function resourceIdForPath(path: string): string {
  return path.split('/').filter(Boolean).join('-')
}

test('catalogue keeps successful categories, warns once for partial failure, deduplicates, and sorts', async () => {
  let active = 0
  let maximumActive = 0
  const client = {
    getResourceCollection: async (path: string): Promise<unknown[]> => {
      active++
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active--
      if (path === '/v1/masks') {
        const error = new Error('not available') as Error & { response?: { status: number } }
        error.response = { status: 404 }
        throw error
      }
      if (path === '/v1/themes') {
        return [
          { id: { uuid: 'theme-2', name: 'Beta' }, collection: { uuid: 'collection-2', name: 'Zed' } },
          { id: { uuid: 'theme-1', name: 'Alpha' }, collection: { uuid: 'collection-1', name: 'A' } },
          { id: { uuid: 'theme-1', name: 'Duplicate' }, collection: { uuid: 'collection-1', name: 'A' } },
        ]
      }
      if (path === '/v1/looks') return [{ uuid: 'look-1', name: 'Main' }]
      return [{ uuid: resourceIdForPath(path), name: path }]
    },
    getResourceDetails: async (): Promise<Record<string, unknown> | null> => null,
    getBinaryAsset: async (): Promise<{ mimeType: string; bytes: Uint8Array } | null> => null,
  }

  const service = new ProPresenterResourcesService(client)
  const catalogue = await service.getCatalogue({ refresh: true })

  assert.ok(maximumActive <= 4, `expected at most four requests, saw ${maximumActive}`)
  assert.deepEqual(catalogue.warnings, [{ kind: 'mask', message: 'Unavailable in this ProPresenter version' }])
  assert.equal(catalogue.resources.filter((resource) => resource.id === 'theme-1').length, 1)
  const sorted = catalogue.resources.map((resource) => `${resource.kind}:${resource.collectionName ?? ''}:${resource.name}`)
  assert.deepEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b)))
  assert.equal(catalogue.resources.some((resource) => resource.kind === 'theme' && resource.id === 'theme-2'), true)
})

test('preview cache returns data URLs and evicts the least recently used entry after 100 entries', async () => {
  let requests = 0
  const client = {
    getResourceCollection: async (): Promise<unknown[]> => [],
    getResourceDetails: async (): Promise<Record<string, unknown> | null> => null,
    getBinaryAsset: async (): Promise<{ mimeType: string; bytes: Uint8Array }> => {
      requests++
      return { mimeType: 'image/png', bytes: Uint8Array.from([1, 2, 3]) }
    },
  }
  const service = new ProPresenterResourcesService(client)

  const first = await service.getPreview('prop', 'prop-0')
  assert.equal(first.dataUrl, 'data:image/png;base64,AQID')
  await service.getPreview('prop', 'prop-0')
  assert.equal(requests, 1)

  for (let index = 1; index <= 100; index++) {
    await service.getPreview('prop', `prop-${index}`)
  }
  // Touch the oldest entry so prop-1 becomes the least-recently-used item.
  await service.getPreview('prop', 'prop-0')
  await service.getPreview('prop', 'prop-101')
  await service.getPreview('prop', 'prop-1')
  assert.equal(requests, 104)
})

test('invalidate clears the catalogue and preview cache for a reconnect', async () => {
  let collections = 0
  let previews = 0
  const client = {
    getResourceCollection: async (): Promise<unknown[]> => {
      collections++
      return [{ uuid: 'prop-1', name: 'Prop' }]
    },
    getResourceDetails: async (): Promise<Record<string, unknown> | null> => null,
    getBinaryAsset: async (): Promise<{ mimeType: string; bytes: Uint8Array }> => {
      previews++
      return { mimeType: 'image/png', bytes: Uint8Array.from([9]) }
    },
  }
  const service = new ProPresenterResourcesService(client)

  await service.getCatalogue()
  await service.getPreview('prop', 'prop-1')
  service.invalidate()
  await service.getCatalogue()
  await service.getPreview('prop', 'prop-1')

  assert.equal(collections, 24)
  assert.equal(previews, 2)
})

test('invalidate does not let an in-flight preview repopulate the next connection cache', async () => {
  let requests = 0
  let release: (asset: { mimeType: string; bytes: Uint8Array }) => void = () => undefined
  const firstAsset = new Promise<{ mimeType: string; bytes: Uint8Array }>((resolve) => {
    release = resolve
  })
  const client = {
    getResourceCollection: async (): Promise<unknown[]> => [],
    getResourceDetails: async (): Promise<Record<string, unknown> | null> => null,
    getBinaryAsset: async (): Promise<{ mimeType: string; bytes: Uint8Array }> => {
      requests++
      if (requests === 1) return firstAsset
      return { mimeType: 'image/png', bytes: Uint8Array.from([8]) }
    },
  }
  const service = new ProPresenterResourcesService(client)

  const pending = service.getPreview('prop', 'prop-1')
  service.invalidate()
  release({ mimeType: 'image/png', bytes: Uint8Array.from([7]) })
  await pending
  await service.getPreview('prop', 'prop-1')

  assert.equal(requests, 2)
})
