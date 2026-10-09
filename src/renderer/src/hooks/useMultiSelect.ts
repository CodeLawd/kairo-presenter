import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One selection model for every grid of things that can go live — lyric
 * slides, verse cards, media. A plain click keeps its job (go live); these
 * gestures only ever select:
 *
 *   ⌘-click (Ctrl on Windows)  toggle one item
 *   Shift-click                select a range from the last picked item
 *   drag on empty space        rubber-band select  (⌘/Shift-drag adds)
 *   Esc                        clear
 */
export type SelectGesture = 'toggle' | 'range'

/** The select gesture a click carries, or null for a plain click. */
export function selectGesture(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): SelectGesture | null {
  if (event.shiftKey) return 'range'
  if (event.metaKey || event.ctrlKey) return 'toggle'
  return null
}

export interface MultiSelect<T> {
  selected: ReadonlySet<T>
  isSelected: (id: T) => boolean
  /** Apply a click gesture to `id`. */
  pick: (id: T, gesture: SelectGesture) => void
  clear: () => void
  /** Everything currently in the list (⌘A). */
  selectAll: () => void
  /** Rubber band: call begin once, update as it moves, end on release. */
  beginMarquee: (additive: boolean) => void
  updateMarquee: (ids: T[]) => void
}

export function useMultiSelect<T>(order: readonly T[]): MultiSelect<T> {
  const [selected, setSelected] = useState<Set<T>>(() => new Set())
  const anchorRef = useRef<T | null>(null)
  const orderRef = useRef(order)
  orderRef.current = order
  const marqueeBaseRef = useRef<Set<T>>(new Set())

  // Items that left the grid (another song, a new search) leave the selection.
  useEffect(() => {
    setSelected((current) => {
      if (current.size === 0) return current
      const present = new Set(order)
      const kept = [...current].filter((id) => present.has(id))
      return kept.length === current.size ? current : new Set(kept)
    })
  }, [order])

  const pick = useCallback((id: T, gesture: SelectGesture): void => {
    setSelected((current) => {
      const next = new Set(current)
      const anchor = anchorRef.current
      const list = orderRef.current
      if (gesture === 'range' && anchor !== null && list.includes(anchor)) {
        const a = list.indexOf(anchor)
        const b = list.indexOf(id)
        const [from, to] = a < b ? [a, b] : [b, a]
        for (let i = from; i <= to; i++) next.add(list[i])
      } else if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    if (gesture === 'toggle' || anchorRef.current === null) anchorRef.current = id
  }, [])

  const clear = useCallback((): void => {
    setSelected((current) => (current.size === 0 ? current : new Set()))
    anchorRef.current = null
  }, [])

  const selectAll = useCallback((): void => {
    setSelected(new Set(orderRef.current))
  }, [])

  const beginMarquee = useCallback((additive: boolean): void => {
    setSelected((current) => {
      marqueeBaseRef.current = additive ? new Set(current) : new Set()
      return current
    })
  }, [])

  const updateMarquee = useCallback((ids: T[]): void => {
    setSelected(new Set([...marqueeBaseRef.current, ...ids]))
    if (ids.length > 0) anchorRef.current = ids[ids.length - 1]
  }, [])

  // Esc clears — captured first so it does not also close whatever is open.
  const hasSelection = selected.size > 0
  useEffect(() => {
    if (!hasSelection) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      clear()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [hasSelection, clear])

  const isSelected = useCallback((id: T): boolean => selected.has(id), [selected])

  return { selected, isSelected, pick, clear, selectAll, beginMarquee, updateMarquee }
}

/**
 * ⌘A / Ctrl+A selects everything in a list, Delete or Backspace removes the
 * selection. Put the returned handler on the list's container: the keys only
 * act while focus is inside it, so ⌘A in a text field still selects text.
 */
export function listShortcuts({
  selectAll,
  remove,
  hasSelection,
}: {
  selectAll: () => void
  remove: () => void
  hasSelection: boolean
}): (event: React.KeyboardEvent) => void {
  return (event) => {
    const target = event.target as HTMLElement
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      event.stopPropagation()
      selectAll()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection) {
      event.preventDefault()
      event.stopPropagation()
      remove()
    }
  }
}

/** How a row that is part of a multi-selection looks — the macOS list blue. */
export const PICKED_ROW = 'bg-tint-teal text-white'

