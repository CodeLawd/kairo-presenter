import { BadRequestException } from '@nestjs/common'
import type { LicensedFeature, ManagedRequest } from '@contracts/licensing'

export const FEATURES: LicensedFeature[] = ['presentation', 'transcription', 'scripture', 'summaries', 'translation', 'webSearch']
export function leaseTimes(now: number, expiry: number | null, days: number) {
  const expiresAt = Math.min(now + Math.min(14, days) * 86400, expiry ?? Infinity)
  return { issuedAt: now, refreshAfter: Math.min(now + 86400, expiresAt), expiresAt, licenseExpiresAt: expiry }
}
const bad = (): never => { throw new BadRequestException('Unsupported or unbounded managed request') }
const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : bad()
function keys(o: Record<string, unknown>, allowed: string[]) { if (Object.keys(o).some(k => !allowed.includes(k))) bad() }
function text(v: unknown, max: number) { if (typeof v !== 'string' || !v.trim().length || v.length > max) bad() }
/** Provider URLs and shapes are fixed here; never accept caller headers or arbitrary URLs. */
export function validateManagedRequest(r: ManagedRequest): { url: string; feature: LicensedFeature; body?: Record<string, unknown> } {
  if (!r || !['GET', 'POST'].includes(r.method) || typeof r.path !== 'string' || r.path.length > 300 || /[%?#\\]|\.\.|\/\//.test(r.path)) bad()
  keys(r as unknown as Record<string, unknown>, ['provider', 'path', 'method', 'query', 'body', 'purpose'])
  const purpose = (r as ManagedRequest & { purpose?: LicensedFeature }).purpose
  if (purpose !== undefined && !['scripture', 'summaries', 'translation', 'webSearch'].includes(purpose)) bad()
  if (purpose !== undefined && !['anthropic', 'deepseek'].includes(r.provider)) bad()
  const q = r.query ?? {}; obj(q)
  if (Object.keys(q).length > 10 || Object.values(q).some(v => !['string', 'boolean', 'number'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v)) || String(v).length > 2000)) bad()
  let url: string, feature: LicensedFeature
  let body: Record<string, unknown> | undefined
  switch (r.provider) {
    case 'bible':
      if (r.method !== 'GET' || r.body !== undefined || !/^\/v1\/bibles(?:\/[a-zA-Z0-9-]+(?:\/(?:books|chapters|verses|passages|search)(?:\/[a-zA-Z0-9.,-]+)?(?:\/(?:chapters|verses))?)?)?$/.test(r.path)) bad()
      keys(q, ['language', 'abbreviation', 'name', 'include-full-details', 'query', 'limit', 'offset', 'sort', 'content-type', 'include-notes', 'include-titles', 'include-chapter-numbers', 'include-verse-numbers', 'include-verse-spans'])
      if (q.sort !== undefined && (typeof q.sort !== 'string' || !['relevance', 'canonical', 'reverse-canonical'].includes(q.sort))) bad()
      if (q.limit !== undefined && (!Number.isInteger(Number(q.limit)) || Number(q.limit) < 1 || Number(q.limit) > 100)) bad()
      if (q.offset !== undefined && (!Number.isInteger(Number(q.offset)) || Number(q.offset) < 0 || Number(q.offset) > 10000)) bad()
      url = 'https://rest.api.bible' + r.path; feature = 'scripture'; break
    case 'brave':
      if (r.method !== 'GET' || r.path !== '/res/v1/web/search' || r.body !== undefined) bad()
      keys(q, ['q', 'count', 'country', 'search_lang', 'safesearch', 'freshness']); text(q.q, 400)
      if (q.count !== undefined && (!Number.isInteger(Number(q.count)) || Number(q.count) < 1 || Number(q.count) > 10)) bad()
      url = 'https://api.search.brave.com' + r.path; feature = 'webSearch'; break
    case 'googleTranslate':
      if (r.method !== 'POST' || r.path !== '/language/translate/v2' || Object.keys(q).length) bad()
      body = obj(r.body); keys(body, ['q', 'source', 'target', 'format']); if (Array.isArray(body.q)) { if (!body.q.length || body.q.length > 50 || JSON.stringify(body.q).length > 30000) bad(); for (const value of body.q) text(value, 10000) } else text(body.q, 10000); text(body.target, 12)
      if (body.source !== undefined) text(body.source, 12)
      if (body.format !== undefined && body.format !== 'text') bad()
      url = 'https://translation.googleapis.com' + r.path; feature = 'translation'; break
    case 'anthropic': case 'deepseek': {
      const anthropic = r.provider === 'anthropic'
      if (!anthropic && r.path === '/v1/tools/search') {
        if (r.method !== 'POST' || Object.keys(q).length || (purpose && purpose !== 'webSearch')) bad()
        body = obj(r.body); keys(body, ['query', 'count', 'need_content']); text(body.query, 128)
        if (!Number.isInteger(body.count) || Number(body.count) < 1 || Number(body.count) > 10 || body.need_content !== false) bad()
        url = 'https://api.deepseek.com/v1/tools/search'; feature = 'webSearch'; break
      }
      if (r.method !== 'POST' || r.path !== (anthropic ? '/v1/messages' : '/chat/completions') || Object.keys(q).length) bad()
      body = { ...obj(r.body) }; keys(body, ['model', 'max_tokens', 'messages', 'system', 'temperature', 'response_format', 'thinking', 'stream'])
      if (body.stream !== undefined && body.stream !== false) bad()
      if (body.thinking !== undefined && (anthropic || JSON.stringify(body.thinking) !== '{"type":"disabled"}')) bad()
      body.max_tokens ??= 4096
      const large = purpose === 'summaries' || purpose === 'translation'
      if (!Number.isInteger(body.max_tokens) || Number(body.max_tokens) < 1 || Number(body.max_tokens) > (large ? 8192 : 4096)) bad()
      if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 10) bad()
      for (const message of body.messages as unknown[]) { const m = obj(message); keys(m, ['role', 'content']); if (!['user', 'assistant', ...(anthropic ? [] : ['system'])].includes(String(m.role))) bad(); text(m.content, large ? 100000 : 24000) }
      if (body.system !== undefined) { if (!anthropic) bad(); text(body.system, 16000) }
      if (JSON.stringify(body).length > (large ? 120000 : 48000) || (body.temperature !== undefined && (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 1))) bad()
      if (body.response_format !== undefined) { if (anthropic || JSON.stringify(body.response_format) !== '{"type":"json_object"}') bad() }
      // Fixed inexpensive model, rather than a caller-selected arbitrary paid model.
      if (!(anthropic ? ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'] : ['deepseek-chat', 'deepseek-flash']).includes(String(body.model))) bad()
      url = (anthropic ? 'https://api.anthropic.com' : 'https://api.deepseek.com') + r.path; feature = purpose ?? 'scripture'; break
    }
    default: return bad()
  }
  const search = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]))
  return { url: url + (search.size ? '?' + search.toString() : ''), feature, body }
}
