/** Parse a finished ProPresenter port draft without inventing a fallback value. */
export function parseProPresenterPort(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d{1,5}$/.test(trimmed)) return null
  const port = Number(trimmed)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}
