import test from 'node:test'
import assert from 'node:assert/strict'
import { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { CloudApiClient } from '../src/main/services/cloud/api-client'

const primary = 'https://primary.example'
const fallback = 'https://fallback.example'

function client(adapter: AxiosInstance['defaults']['adapter']): CloudApiClient {
  const api = new CloudApiClient(primary, async () => null, fallback)
  ;(api as unknown as { http: AxiosInstance }).http.defaults.adapter = adapter
  return api
}

function response(config: InternalAxiosRequestConfig, data: unknown) {
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

test('a failed primary health check selects the reachable API before sending a write', async () => {
  const calls: string[] = []
  const api = client(async (config) => {
    const url = new URL(config.url!, config.baseURL).href
    calls.push(`${config.method} ${url}`)
    if (url === `${primary}/v1/health`) throw new AxiosError('connect timeout', 'ETIMEDOUT', config)
    return response(config, { ok: true })
  })

  assert.deepEqual(
    await api.request('post', `${primary}/v1/engage`, {}, { authenticated: false }),
    { ok: true },
  )
  assert.deepEqual(calls, [
    `get ${primary}/v1/health`,
    `get ${fallback}/v1/health`,
    `post ${fallback}/v1/engage`,
  ])

  await api.request('get', '/v1/licensing', undefined, { authenticated: false })
  assert.equal(calls.at(-1), `get ${fallback}/v1/licensing`)
})

test('a timed-out write is not repeated at the fallback address', async () => {
  const calls: string[] = []
  const api = client(async (config) => {
    const url = new URL(config.url!, config.baseURL).href
    calls.push(`${config.method} ${url}`)
    if (config.method === 'post') throw new AxiosError('timeout', 'ETIMEDOUT', config)
    return response(config, { ok: true })
  })

  await assert.rejects(api.request('post', '/v1/engage', {}, { authenticated: false }))
  assert.deepEqual(calls, [`get ${primary}/v1/health`, `post ${primary}/v1/engage`])
})
