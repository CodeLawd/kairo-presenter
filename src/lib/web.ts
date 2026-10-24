/**
 * Web pages on the screens: what the operator types becomes an address, and
 * the saved bookmarks. Shared by the operator panel and the main process,
 * which re-checks every address before a screen loads it.
 */

/** The `name` of the operator's preview frame — how the main process tells its navigations apart. */
export const WEB_PREVIEW_FRAME = 'kairo-web-preview'
/** The live page on a screen (overlay.html), which follows the preview's scrolling. */
export const WEB_SCREEN_FRAME = 'kairo-web-screen'
/** The live page drawn under the slide in the operator's main screen preview. */
export const WEB_MIRROR_FRAME = 'kairo-web-mirror'
/**
 * posted by the preview frame to the operator window as it scrolls, loads or
 * resizes: { type, x, y, adaptive } — `adaptive` when the page's layout depends
 * on the window's height (full-height sections, large pinned ones), so a
 * preview taller than the screens would lay it out differently.
 */
export const WEB_SCROLL_MESSAGE = 'kairo:web-scroll'
/** The page size screens lay a web page out at; previews draw it at this size, scaled down. */
export const WEB_FRAME_WIDTH = 1920
export const WEB_FRAME_HEIGHT = 1080

/** Both web frames — on screens and in the preview — may run the page, never reach Kairo. */
export const WEB_FRAME_SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation'
export const WEB_FRAME_ALLOW = 'autoplay; fullscreen; encrypted-media; picture-in-picture'

export interface WebBookmark {
  id: string
  name: string
  url: string
}

export interface WebSettings {
  bookmarks: WebBookmark[]
}

export const DEFAULT_WEB_SETTINGS: WebSettings = { bookmarks: [] }

const MAX_BOOKMARKS = 50
const MAX_URL = 2048

/**
 * An http(s) address for `input`, or null. A bare host gets https
 * (`youtube.com` → `https://youtube.com/`); anything that is not an address —
 * words, or a scheme other than http(s) like `file:` or `javascript:` — is a
 * search when `search` is set, otherwise null.
 */
export function webAddress(input: string, search = true): string | null {
  const text = input.trim()
  if (!text || text.length > MAX_URL) return null
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(text)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https' && !/^[^\s/:]+:\d+(\/|$)/.test(text)) {
    return search && !text.includes('://') ? searchAddress(text) : null
  }
  const looksLikeHost = !/\s/.test(text) && (scheme !== undefined || /^[^/]+\.[^/.]+(?:[:/?#]|$)/.test(text) || /^localhost(?:[:/]|$)/i.test(text))
  if (!looksLikeHost) return search ? searchAddress(text) : null
  try {
    const url = new URL(scheme === 'http' || scheme === 'https' ? text : `https://${text}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return search ? searchAddress(text) : null
  }
}

/** A CSP with its `frame-ancestors` directive taken out (the rest of the policy stands). */
export function withoutFrameAncestors(policy: string): string {
  return policy
    .split(';')
    .filter((directive) => directive.trim().split(/\s+/)[0]?.toLowerCase() !== 'frame-ancestors')
    .join(';')
}

function searchAddress(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}

/** The address bar's short form: host and path, without `https://` or a lone `/`. */
export function displayAddress(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    return `${parsed.host}${path}${parsed.search}`
  } catch {
    return url
  }
}

export function normalizeWebSettings(raw: unknown): WebSettings {
  const source = raw && typeof raw === 'object' ? (raw as Partial<WebSettings>) : {}
  const bookmarks: WebBookmark[] = []
  for (const entry of Array.isArray(source.bookmarks) ? source.bookmarks : []) {
    const url = typeof entry?.url === 'string' ? webAddress(entry.url, false) : null
    if (!url || typeof entry.id !== 'string' || !entry.id) continue
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 80) : displayAddress(url)
    bookmarks.push({ id: entry.id, name, url })
    if (bookmarks.length >= MAX_BOOKMARKS) break
  }
  return { bookmarks }
}
