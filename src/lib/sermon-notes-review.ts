import type { SermonReferenceMatch } from './ipc'

function comparisonKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Returns a canonical label only when the source notation needs interpretation. */
export function normalizedReferenceLabel(match: SermonReferenceMatch): string | null {
  const source = comparisonKey(match.text)
  const canonical = comparisonKey(match.reference)
  return source.startsWith(canonical) ? null : match.reference
}
