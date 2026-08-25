/**
 * Turns Electron IPC / provider errors into short operator-facing copy.
 * Never surfaces "Error invoking remote method …" wrappers.
 */
export function formatOnlineLyricsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const msg = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim()

  if (/no lyric text was found|no sections could be parsed|couldn'?t structure/i.test(msg)) {
    return "This page didn't return usable lyrics."
  }
  if (/timeout|etimedout|econn|enotfound|network|fetch failed|socket/i.test(msg)) {
    return /lrclib/i.test(msg)
      ? "Couldn't reach LRCLIB in time. Try again, or pick another result."
      : "Couldn't reach the lyrics source."
  }
  if (/403|401|429|blocked|captcha|forbidden|too many requests/i.test(msg)) {
    return 'That lyrics page blocked the request.'
  }
  if (/404|not found/i.test(msg)) {
    return "Lyrics weren't found for this result."
  }
  if (!msg || msg.length > 160) {
    return "Couldn't load lyrics from this result."
  }
  return msg
}
