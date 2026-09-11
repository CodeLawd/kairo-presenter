import type { SermonSummary } from '@/lib/sermons'

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {}
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : ''
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * Keep readers compatible with recaps saved before the compact summary schema.
 * This is also the runtime guard for cached or partially generated API data.
 */
export function normalizeSermonSummary(value: unknown): SermonSummary {
  const source = record(value)
  const rawPoints = list(source.keyPoints).length ? list(source.keyPoints) : list(source.mainPoints)
  const rawQuotes = list(source.memorableQuotes).length
    ? list(source.memorableQuotes)
    : list(source.keyQuotes)
  const rawScriptures = list(source.keyScriptures).length
    ? list(source.keyScriptures)
    : list(source.scriptures)

  const callToAction = text(source.callToAction, 500) || undefined

  return {
    headline: text(source.headline, 80),
    bigIdea: text(source.bigIdea, 700) || text(source.overview, 700),
    keyPoints: rawPoints
      .map((value) => {
        const point = record(value)
        return {
          title: text(point.title, 200),
          explanation: text(point.explanation, 500) || text(point.detail, 500),
        }
      })
      .filter((point) => point.title)
      .slice(0, 5),
    memorableQuotes: rawQuotes.map((quote) => text(quote, 700)).filter(Boolean).slice(0, 3),
    takeaways: list(source.takeaways)
      .map((takeaway) => text(takeaway, 500))
      .filter(Boolean)
      .slice(0, 4),
    keyScriptures: rawScriptures
      .map((value) => {
        const scripture = record(value)
        return {
          reference: text(scripture.reference, 120),
          connection: text(scripture.connection, 400) || text(scripture.note, 400),
        }
      })
      .filter((scripture) => scripture.reference)
      .slice(0, 5),
    ...(callToAction ? { callToAction } : {}),
  }
}
