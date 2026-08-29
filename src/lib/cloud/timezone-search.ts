// ─── Timezone search ──────────────────────────────────────────────────────────
// Pure — no Node/DOM APIs. The IANA list is ~420 entries, so the picker in front
// of it has to be searchable, and the search has to forgive the ways people
// actually type a zone: "new york", "lagos", "gmt", "los-angeles".

/** `America/New_York` → `america new york` — what a query is matched against. */
export function normalizeZone(zone: string): string {
  return zone.replace(/[_/-]+/g, ' ').toLowerCase()
}

/** The city half, which is what people type: `America/New_York` → `new york`. */
export function zoneCity(zone: string): string {
  const last = zone.split('/').pop() ?? zone
  return last.replace(/[_-]+/g, ' ').toLowerCase()
}

function normalizeQuery(query: string): string {
  return query.replace(/[_/-]+/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Zones matching `query`, best first, capped at `limit`.
 *
 * Ranking, highest first:
 *   0. the city starts with the query — "lagos" must not rank Africa/Lagos below
 *      America/Argentina/La_Rioja just because that one is alphabetically first
 *   1. any word in the zone starts with the query
 *   2. the zone contains the query anywhere
 *
 * An empty query returns the list unchanged (still capped), so opening the
 * picker shows the caller's own ordering — detected zone first.
 */
export function matchTimezones(
  zones: readonly string[],
  query: string,
  limit = 80,
): string[] {
  const q = normalizeQuery(query)
  if (!q) return zones.slice(0, limit)

  const ranked: { zone: string; rank: number; index: number }[] = []
  zones.forEach((zone, index) => {
    const rank = rankZone(zone, q)
    if (rank !== null) ranked.push({ zone, rank, index })
  })

  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return ranked.slice(0, limit).map((entry) => entry.zone)
}

function rankZone(zone: string, query: string): number | null {
  const city = zoneCity(zone)
  if (city.startsWith(query)) return 0

  const haystack = normalizeZone(zone)
  if (haystack.split(' ').some((word) => word.startsWith(query))) return 1
  if (haystack.includes(query)) return 2
  return null
}
