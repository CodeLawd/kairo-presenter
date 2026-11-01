/** Empty/changed pages must become an actionable failure, even after earlier success. */
export function slidoReadStale(lastGoodAt: number | null, now: number): boolean {
  return lastGoodAt !== null && now - lastGoodAt >= 30_000
}
