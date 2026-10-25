import { validateManagedRequest, leaseTimes } from './managed-policy'

describe('managed request boundary', () => {
  it('rejects proxy escape paths and expensive unbounded requests', () => {
    for (const path of ['https://evil.test', '//evil.test', '/v1/messages?x=1', '/v1/../messages']) {
      expect(() => validateManagedRequest({ provider: 'anthropic', path, method: 'POST', body: {} })).toThrow()
    }
    expect(() => validateManagedRequest({ provider: 'anthropic', path: '/v1/messages', method: 'POST', body: { model: 'arbitrary', max_tokens: 900000, messages: [] } })).toThrow()
  })
  it('allows bounded Bible queries only', () => {
    expect(validateManagedRequest({ provider: 'bible', method: 'GET', path: '/v1/bibles', query: { language: 'eng' } }).feature).toBe('scripture')
    expect(() => validateManagedRequest({ provider: 'bible', method: 'GET', path: '/v1/bibles', query: { arbitrary: 'yes' } })).toThrow()
  })
  it('clips leases to licence expiry and a 14 day maximum', () => {
    expect(leaseTimes(1000, null, 999).expiresAt).toBe(1000 + 14 * 86400)
    expect(leaseTimes(1000, 1100, 14).expiresAt).toBe(1100)
  })
})

describe('managed feature routing', () => {
  const llm = { provider: 'deepseek' as const, path: '/chat/completions', method: 'POST' as const, body: { model: 'deepseek-flash', max_tokens: 8192, messages: [{ role: 'user', content: 'review song' }], thinking: { type: 'disabled' } } }
  it('allows bounded LLM review for its stated licensed feature', () => {
    expect(validateManagedRequest({ ...llm, purpose: 'translation' }).feature).toBe('translation')
    expect(() => validateManagedRequest(llm)).toThrow()
  })
  it('prevents purpose overrides for dedicated APIs', () => {
    expect(() => validateManagedRequest({ provider: 'bible', path: '/v1/bibles', method: 'GET', purpose: 'summaries' })).toThrow()
    expect(() => validateManagedRequest({ provider: 'deepseek', path: '/v1/tools/search', method: 'POST', purpose: 'translation', body: { query: 'song', count: 5, need_content: false } })).toThrow()
  })
  it('bounds dedicated search and batched translation', () => {
    expect(validateManagedRequest({ provider: 'deepseek', path: '/v1/tools/search', method: 'POST', body: { query: 'song', count: 5, need_content: false } }).feature).toBe('webSearch')
    expect(validateManagedRequest({ provider: 'googleTranslate', path: '/language/translate/v2', method: 'POST', body: { q: ['hello', 'world'], target: 'fr' } }).feature).toBe('translation')
    expect(() => validateManagedRequest({ provider: 'googleTranslate', path: '/language/translate/v2', method: 'POST', body: { q: Array(51).fill('hello'), target: 'fr' } })).toThrow()
  })
  it('rejects empty, nonfinite, and unknown request fields', () => {
    for (const body of [{ ...llm.body, max_tokens: NaN }, { ...llm.body, messages: [] }, { ...llm.body, tools: [{ name: 'expensive' }] }]) {
      expect(() => validateManagedRequest({ ...llm, body })).toThrow()
    }
    expect(() => validateManagedRequest({ ...llm, query: { count: Infinity } })).toThrow()
  })
})

describe('desktop API.Bible client compatibility', () => {
  it('accepts keyword search with the desktop relevance sort and bounds sort values', () => {
    const request = { provider: 'bible' as const, method: 'GET' as const, path: '/v1/bibles/de4e12af7f28f599-02/search', query: { query: 'love one another', limit: 10, sort: 'relevance' } }
    expect(validateManagedRequest(request).url).toContain('sort=relevance')
    for (const sort of ['canonical', 'reverse-canonical']) expect(validateManagedRequest({ ...request, query: { ...request.query, sort } }).url).toContain(`sort=${sort}`)
    expect(() => validateManagedRequest({ ...request, query: { ...request.query, sort: 'unbounded' } })).toThrow()
  })
  it('accepts the desktop catalogue, chapter and JSON content request shapes', () => {
    const paths = ['/v1/bibles', '/v1/bibles/de4e12af7f28f599-02', '/v1/bibles/de4e12af7f28f599-02/books', '/v1/bibles/de4e12af7f28f599-02/books/JHN/chapters']
    for (const path of paths) expect(validateManagedRequest({ provider: 'bible', method: 'GET', path, ...(path === '/v1/bibles' ? { query: { language: 'eng' } } : {}) }).feature).toBe('scripture')
    for (const resource of ['passages/JHN.3.16-JHN.3.18', 'chapters/JHN.3']) {
      const result = validateManagedRequest({ provider: 'bible', method: 'GET', path: `/v1/bibles/de4e12af7f28f599-02/${resource}`, query: { 'content-type': 'json', 'include-notes': false, 'include-titles': false, 'include-chapter-numbers': false } })
      expect(result.url).toContain('content-type=json')
    }
  })
})
