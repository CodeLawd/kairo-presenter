import { useEffect } from 'react'
import { create } from 'zustand'
import type { ImportKind } from '@shared/import-menu'

const useImportStore = create<{ pending: ImportKind | null }>(() => ({ pending: null }))
export function requestImport(kind: ImportKind): void {
  useImportStore.setState({ pending: kind })
}

/** Retain menu intent across route mounting; consume once, including Strict Mode. */
export function useImportRequest(
  kinds: readonly ImportKind[],
  handler: (kind: ImportKind) => void | Promise<void>,
  enabled = true,
): void {
  const pending = useImportStore(state => state.pending)
  useEffect(() => {
    if (!enabled || !pending || !kinds.includes(pending)) return
    if (useImportStore.getState().pending !== pending) return
    useImportStore.setState({ pending: null })
    void handler(pending)
  }, [pending, enabled, kinds, handler])
}
