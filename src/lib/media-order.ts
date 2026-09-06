/**
 * Moves one id before or after another in an ordered list.
 *
 * Used by the background dock (library + playlist) so a drag lands where the
 * operator dropped it. Ids that are not in the list are left alone — a stale
 * drag must not invent entries.
 */
export function reorderIds(
  ids: readonly string[],
  draggedId: string,
  targetId: string,
  position: 'before' | 'after',
): string[] {
  if (draggedId === targetId) return [...ids]
  const fromIndex = ids.indexOf(draggedId)
  if (fromIndex < 0) return [...ids]
  const next = [...ids]
  next.splice(fromIndex, 1)
  const targetIndex = next.indexOf(targetId)
  if (targetIndex < 0) return [...ids]
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, draggedId)
  return next
}

/**
 * Applies a saved order to a scanned library.
 *
 * Known ids keep the operator's sequence. Anything new (dropped in since the
 * last rearrange) appends at the end in the order the scan found them, so a
 * fresh file is never lost just because it was not in the saved list.
 */
export function applyItemOrder<T extends { id: string }>(
  items: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0 || items.length === 0) return [...items]
  const byId = new Map(items.map((item) => [item.id, item]))
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const item = byId.get(id)
    if (!item || seen.has(id)) continue
    ordered.push(item)
    seen.add(id)
  }
  for (const item of items) {
    if (seen.has(item.id)) continue
    ordered.push(item)
  }
  return ordered
}
