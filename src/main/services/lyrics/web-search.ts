import axios from 'axios'
import log from 'electron-log/main'

export interface WebSearchCredentials {
  deepseekApiKey?: string
  braveApiKey?: string
}

export interface WebSearchResult {
  title?: string
  url: string
  description?: string
}

interface WebSearchBatch {
  provider: 'deepseek' | 'brave'
  results: WebSearchResult[]
}

const TIMEOUT_MS = 12_000
const COUNT = 8
// Shared by song and gloss lookups. Reserve slots synchronously so concurrent
// requests cannot all wake up at once and exceed the provider's rate limit.
const nextRequestAt = { deepseek: 0, brave: 0 }
async function throttle(provider: WebSearchBatch['provider']): Promise<void> {
  const now = Date.now()
  const slot = Math.max(now, nextRequestAt[provider])
  nextRequestAt[provider] = slot + (provider === 'deepseek' ? 250 : 1_100)
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now))
}

/** Remove search-index tracking artifacts without changing meaningful query parameters. */
function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|__cf_chl_|relatedposts_)/i.test(key) ||
          /^(share|like_comment|_wpnonce|replytocom|amp|noamp|random-post)$/i.test(key)) {
        url.searchParams.delete(key)
      }
    }
    return url.toString()
  } catch {
    return null
  }
}

function normalizeResults(value: unknown): WebSearchResult[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const results: WebSearchResult[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const url = cleanUrl(item.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    results.push({
      url,
      title: typeof item.title === 'string' ? item.title : undefined,
      description: typeof item.snippet === 'string' ? item.snippet :
        typeof item.description === 'string' ? item.description : undefined,
    })
    if (results.length === COUNT) break
  }
  return results
}

/**
 * Lazy batches: the caller verifies lyrics/glosses and stops on success.
 * Resuming iteration tries Brave even if DeepSeek returned nonempty but unusable hits.
 * Oversized queries bypass DeepSeek rather than silently losing words or filters.
 */
export async function* searchWebProviders(
  query: string | readonly string[],
  credentials: WebSearchCredentials = {},
): AsyncGenerator<WebSearchBatch> {
  const queries = [...new Set((typeof query === 'string' ? [query] : query).map((q) => q.trim()).filter(Boolean))]
  if (!queries.length) return
  for (const provider of ['deepseek', 'brave'] as const) {
    const key = (provider === 'deepseek' ? credentials.deepseekApiKey : credentials.braveApiKey)?.trim()
    if (!key) continue
    for (const q of queries) {
      if (provider === 'deepseek' && Array.from(q).length > 128) continue
      await throttle(provider)
      try {
        const response = provider === 'deepseek'
          ? await axios.post('https://api.deepseek.com/v1/tools/search',
            { query: q, count: COUNT, need_content: false },
            { headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, timeout: TIMEOUT_MS })
          : await axios.get('https://api.search.brave.com/res/v1/web/search', {
            params: { q, count: COUNT },
            headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
            timeout: TIMEOUT_MS,
          })
        const results = normalizeResults(provider === 'deepseek' ? response.data?.results : response.data?.web?.results)
        if (results.length) yield { provider, results }
      } catch (err) {
        // Never log the Axios error/config: it contains the provider credential.
        log.warn('[LyricsWebSearch] provider failed; trying fallback', {
          provider,
          status: axios.isAxiosError(err) ? err.response?.status : undefined,
        })
      }
    }
  }
}
