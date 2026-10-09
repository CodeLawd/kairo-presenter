/** A local destination safe for both browser navigation and OAuth redirects. */
export function safeReturnPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string' || value.length > 1500 || !value.startsWith('/') || value.startsWith('//')) return fallback
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || decoded.includes('\\') || [...decoded].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)) return fallback
    const url = new URL(value, 'https://kairo.invalid')
    if (url.origin !== 'https://kairo.invalid') return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}
