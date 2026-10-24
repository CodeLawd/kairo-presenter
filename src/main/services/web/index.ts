import { session, webFrameMain, type WebContents } from 'electron'
import log from 'electron-log/main'
import { WEB_MIRROR_FRAME, WEB_PREVIEW_FRAME, WEB_SCREEN_FRAME, WEB_SCROLL_MESSAGE, webAddress, withoutFrameAncestors } from '@shared/web'

/**
 * Pages framed in Kairo's own windows — the web layer on screens and the
 * operator's preview — may load even when the site refuses to be framed.
 *
 * Sites send `X-Frame-Options` or a CSP `frame-ancestors` to stop other sites
 * embedding them (clickjacking). Kairo's pages are local and never ask anyone
 * to click inside a framed site under false pretences, so for frames in this
 * session those two are dropped. Top-level pages keep every header.
 */
export function allowFramedPages(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== 'subFrame' || !details.responseHeaders) {
      callback({})
      return
    }
    const headers: Record<string, string[]> = {}
    let changed = false
    for (const [name, values] of Object.entries(details.responseHeaders)) {
      const key = name.toLowerCase()
      if (key === 'x-frame-options') {
        changed = true
        continue
      }
      if (key === 'content-security-policy') {
        const kept = values.map(withoutFrameAncestors)
        changed ||= kept.some((value, i) => value !== values[i])
        headers[name] = kept
        continue
      }
      headers[name] = values
    }
    callback(changed ? { responseHeaders: headers } : {})
  })
}

/**
 * Silences a framed page: the operator's previews must not sound, because the
 * screens already carry the page's sound and the booth is often the room's
 * sound source. Catches media playing now, added later, or unmuted by the site.
 */
const MUTE_SCRIPT = `(() => {
  if (window.__kairoMuted) return;
  window.__kairoMuted = true;
  const hush = (media) => { media.muted = true; };
  const sweep = () => document.querySelectorAll('video, audio').forEach(hush);
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { hush(this); return play.apply(this, arguments); };
  document.addEventListener('volumechange', (e) => {
    if (e.target instanceof HTMLMediaElement && !e.target.muted) hush(e.target);
  }, true);
  sweep();
  new MutationObserver(sweep).observe(document, { childList: true, subtree: true });
})()`

/**
 * Tells the operator window where the preview page is scrolled — once a frame
 * at most — and whether its layout depends on the window's height, checked on
 * load and after a resize (not per scroll: it reads every element's style).
 * Full-height sections and large pinned (sticky) ones give it away; a small
 * sticky header doesn't, it behaves the same at any height.
 */
const SCROLL_SCRIPT = `(() => {
  if (window.__kairoScroll) return;
  window.__kairoScroll = true;
  const measureAdaptive = () => {
    const h = innerHeight;
    if (!document.body || h < 200) return false;
    const all = document.body.getElementsByTagName('*');
    const n = Math.min(all.length, 4000);
    for (let i = 0; i < n; i++) {
      const el = all[i];
      const height = el.offsetHeight;
      if (height < h * 0.5 || el.offsetWidth < innerWidth * 0.5) continue;
      if (Math.abs(height - h) <= 2) return true;
      if (getComputedStyle(el).position === 'sticky') return true;
    }
    return false;
  };
  let adaptive = measureAdaptive();
  let queued = false;
  const report = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      parent.postMessage({ type: ${JSON.stringify(WEB_SCROLL_MESSAGE)}, x: scrollX, y: scrollY, adaptive }, '*');
    });
  };
  let settle = 0;
  new ResizeObserver(() => {
    clearTimeout(settle);
    settle = setTimeout(() => { adaptive = measureAdaptive(); report(); }, 250);
  }).observe(document.documentElement);
  addEventListener('scroll', report, { passive: true });
  report();
})()`

/**
 * Lets a page follow the preview's scrolling smoothly. Updates arrive about
 * once a frame but unevenly (preview → main → each screen), and jumping to
 * each one judders; instead the page eases toward the latest position.
 *
 * On a 16 ms timer, not requestAnimationFrame: Chromium stops animation frames
 * for a window it thinks is covered — a screen window behind the operator's on
 * a one-display setup — and the page would never move. Screen windows run with
 * background throttling off, so the timer keeps going. `instant` overrides a
 * site's `scroll-behavior: smooth`, which would animate every step against this.
 */
const FOLLOW_SCRIPT = `(() => {
  if (window.__kairoScrollTo) return;
  let targetX = scrollX, targetY = scrollY, running = false;
  const step = () => {
    const dx = targetX - scrollX, dy = targetY - scrollY;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
      scrollTo({ left: targetX, top: targetY, behavior: 'instant' });
      running = false;
      return;
    }
    scrollTo({ left: scrollX + dx * 0.35, top: scrollY + dy * 0.35, behavior: 'instant' });
    setTimeout(step, 16);
  };
  window.__kairoScrollTo = (x, y) => {
    targetX = x;
    targetY = y;
    if (!running) { running = true; setTimeout(step, 16); }
  };
})()`

/** Where the live page was last scrolled, by its address — a copy that loads later starts there. */
let lastScroll: { url: string; x: number; y: number } | null = null

export function rememberWebScroll(url: string, x: number, y: number): void {
  lastScroll = { url, x: Math.round(x), y: Math.round(y) }
}

/** Gives a page the scroll follower and, if it is the page last scrolled, puts it there. */
function prepareFollower(frame: Electron.WebFrameMain, extra = ''): void {
  const restore = lastScroll && webAddress(frame.url, false) === lastScroll.url
    ? `;scrollTo({ left: ${lastScroll.x}, top: ${lastScroll.y}, behavior: 'instant' })`
    : ''
  frame.executeJavaScript(`${extra}${FOLLOW_SCRIPT}${restore}`).catch(() => undefined)
}

/**
 * The web frames of that name directly inside the window's page. Several in the
 * operator window: every page stays mounted, and each has its own live panel
 * with its own copy of the main screen preview.
 */
function webFrames(contents: WebContents, name: string): Electron.WebFrameMain[] {
  if (contents.isDestroyed()) return []
  return contents.mainFrame.frames.filter((frame) => frame.name === name)
}

/** Scrolls every web frame `name` in `contents` to (x, y). */
export function scrollWebFrame(contents: WebContents, name: string, x: number, y: number): void {
  const left = Math.round(x)
  const top = Math.round(y)
  for (const frame of webFrames(contents, name)) {
    // No follower yet (the page is still loading): jump, even on a smooth-scrolling site.
    frame
      .executeJavaScript(
        `window.__kairoScrollTo ? __kairoScrollTo(${left}, ${top}) : scrollTo({ left: ${left}, top: ${top}, behavior: 'instant' })`,
      )
      .catch(() => undefined)
  }
}

/** Gives a screen window's web frame the scroll follower each time a page loads in it. */
export function prepareScreenWebFrame(contents: WebContents): void {
  contents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
    if (isMainFrame) return
    try {
      const frame = webFrameMain.fromId(processId, routingId)
      if (frame?.name !== WEB_SCREEN_FRAME || frame.parent !== contents.mainFrame) return
      prepareFollower(frame)
    } catch (err) {
      log.warn('[Web] screen frame not prepared', (err as Error).message)
    }
  })
}

/**
 * The operator window's web frames: the preview reports where it goes (a link,
 * a redirect, a search, or an in-page route change on sites like YouTube) and
 * where it is scrolled; it and the main screen preview's copy are muted.
 */
export function watchWebPreview(contents: WebContents, onNavigate: (url: string) => void): void {
  const frameOf = (isMainFrame: boolean, processId: number, routingId: number): Electron.WebFrameMain | null => {
    if (isMainFrame) return null
    const frame = webFrameMain.fromId(processId, routingId)
    // Only Kairo's own frames: pages they embed (ads, players) load and navigate too.
    return frame && frame.parent === contents.mainFrame ? frame : null
  }
  const report = (url: string, isMainFrame: boolean, processId: number, routingId: number): void => {
    try {
      if (frameOf(isMainFrame, processId, routingId)?.name !== WEB_PREVIEW_FRAME) return
      const address = webAddress(url, false)
      if (address) onNavigate(address)
    } catch (err) {
      log.warn('[Web] preview navigation not followed', (err as Error).message)
    }
  }
  contents.on('did-frame-navigate', (_event, url, _code, _status, isMainFrame, processId, routingId) =>
    report(url, isMainFrame, processId, routingId),
  )
  contents.on('did-navigate-in-page', (_event, url, isMainFrame, processId, routingId) =>
    report(url, isMainFrame, processId, routingId),
  )
  contents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) => {
    try {
      const frame = frameOf(isMainFrame, processId, routingId)
      if (frame?.name !== WEB_PREVIEW_FRAME && frame?.name !== WEB_MIRROR_FRAME) return
      // The preview reports its scrolling; the main screen preview's copy follows it.
      if (frame.name === WEB_PREVIEW_FRAME) frame.executeJavaScript(`${MUTE_SCRIPT};${SCROLL_SCRIPT}`).catch(() => undefined)
      else prepareFollower(frame, `${MUTE_SCRIPT};`)
    } catch (err) {
      log.warn('[Web] preview frame not prepared', (err as Error).message)
    }
  })
}
