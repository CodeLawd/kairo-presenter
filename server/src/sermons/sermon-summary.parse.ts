import type { SermonSummary } from '@contracts/contracts'

export class SummaryFormatError extends Error {}

const MAX = {
  headline: 80,
  bigIdea: 700,
  pointTitle: 200,
  pointExplanation: 500,
  quote: 700,
  takeaway: 500,
  reference: 120,
  connection: 400,
  callToAction: 500,
} as const

const CAP = {
  keyPoints: 5,
  memorableQuotes: 3,
  takeaways: 4,
  keyScriptures: 5,
} as const

function text(value: unknown, limit: number): string {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, limit)
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Collapse whitespace so a quote match is not defeated by line breaks. */
function normalize(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Strip a fenced code block if the model wrapped its JSON in one.
 * Structured outputs make this unnecessary on the Anthropic path; the DeepSeek
 * path has no such guarantee.
 */
export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim()
}

/**
 * Turn whatever the model returned into a summary we are willing to publish.
 *
 * The important rule is the quote check. A fabricated quotation attributed to a
 * pastor on a public page is the worst failure this feature can produce, so any
 * `memorableQuotes` entry that is not literally present in the transcript is dropped
 * rather than trusted — the same guard the nugget code applied
 * (`extractNuggetQuotes`), which is the one piece of it worth keeping.
 */
export function parseSermonSummary(raw: string, transcriptText: string): SermonSummary {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripCodeFences(raw))
  } catch {
    throw new SummaryFormatError('The model did not return usable JSON.')
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new SummaryFormatError('The model did not return a summary object.')
  }

  const source = parsed as Record<string, unknown>
  const haystack = normalize(transcriptText)

  const headline = text(source.headline, MAX.headline)
  const bigIdea = text(source.bigIdea, MAX.bigIdea)
  if (!headline || !bigIdea) {
    throw new SummaryFormatError('The model returned a summary with no headline or big idea.')
  }

  const keyPoints = list(source.keyPoints)
    .map((entry) => {
      const point = (entry ?? {}) as Record<string, unknown>
      return {
        title: text(point.title, MAX.pointTitle),
        explanation: text(point.explanation, MAX.pointExplanation),
      }
    })
    .filter((point) => point.title.length > 0)
    .slice(0, CAP.keyPoints)

  const memorableQuotes = list(source.memorableQuotes)
    .map((quote) => text(quote, MAX.quote))
    .filter((quote) => quote.length > 0 && haystack.includes(normalize(quote)))
    .slice(0, CAP.memorableQuotes)

  const takeaways = list(source.takeaways)
    .map((entry) => text(entry, MAX.takeaway))
    .filter(Boolean)
    .slice(0, CAP.takeaways)

  const keyScriptures = list(source.keyScriptures)
    .map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>
      return {
        reference: text(item.reference, MAX.reference),
        connection: text(item.connection, MAX.connection),
      }
    })
    .filter((item) => item.reference.length > 0)
    .slice(0, CAP.keyScriptures)

  const callToAction = text(source.callToAction, MAX.callToAction) || undefined

  return { headline, bigIdea, keyPoints, memorableQuotes, takeaways, keyScriptures, callToAction }
}
