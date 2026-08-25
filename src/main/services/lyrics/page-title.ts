/**
 * Shared page-title cleaner for web-search → catalogue re-query.
 *
 * Lives in its own module so the snippet resolver and its tests do not create
 * a circular import through the resolver class file.
 */

/**
 * Boilerplate that lyrics and download sites wrap around the song name.
 * Stripping it leaves something close enough to "artist title" to search with.
 */
const PAGE_TITLE_NOISE =
  /\b(download|d\s?load|free|full|official|new|latest|watch|listen|stream|audio|video|music|song|songs|track|mp3|mp4|m4a|hd|4k|lyrics?|lyric|letra|paroles|translation|meaning|chords|tab|karaoke|instrumental)\b/gi

/**
 * Reduces a search-result page title to a usable song-name query.
 *
 * "DOWNLOAD SONG: Nathaniel Bassey - Ese (Mp3 & Lyrics) | CeeNaija" has to come
 * out as something the catalogues can match, which means losing the site name,
 * the download-site verbs and the format tags.
 */
export function cleanPageTitle(raw: string): string {
  let title = (raw ?? '').split('|')[0]

  // Leading section labels: "DOWNLOAD SONG:", "VIDEO:", "Lyrics:".
  title = title.replace(/^[^:]{0,24}:\s*/, '')
  title = title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  title = title.replace(PAGE_TITLE_NOISE, ' ')
  // Separators left stranded once the words around them are gone.
  title = title.replace(/[–—|·:]+/g, ' ')
  title = title.replace(/\s*&\s*/g, ' ')
  title = title.replace(/[-]{1,}/g, ' ')
  title = title.replace(/\s{2,}/g, ' ').trim()

  return title
}
