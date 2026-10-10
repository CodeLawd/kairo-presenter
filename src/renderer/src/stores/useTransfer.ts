import { create } from 'zustand'
import type {
  TransferCommitRequest,
  TransferCommitResult,
  TransferExportRequest,
  TransferPreview,
} from '@shared/kairo-bundle'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

export interface TransferNotice {
  tone: 'ok' | 'error'
  text: string
}

interface TransferStore {
  /** The file being reviewed before import, or null. */
  preview: TransferPreview | null
  notice: TransferNotice | null
  /** Songs export picker; `preselect` ticks songs on open. */
  songExport: { preselect: string[] } | null
  setPreview: (preview: TransferPreview | null) => void
  notify: (notice: TransferNotice | null) => void
  openSongExport: (preselect?: string[]) => void
  closeSongExport: () => void
}

export const useTransferStore = create<TransferStore>((set) => ({
  preview: null,
  notice: null,
  songExport: null,
  setPreview: (preview) => set({ preview }),
  notify: (notice) => set({ notice }),
  openSongExport: (preselect = []) => set({ songExport: { preselect } }),
  closeSongExport: () => set({ songExport: null }),
}))

function message(err: unknown): string {
  return err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)
}

/** Save dialog → `.kairo` file. Reports the outcome in the notice. */
export async function exportKairo(request: TransferExportRequest): Promise<boolean> {
  const { notify } = useTransferStore.getState()
  try {
    const result = await window.api.transfer.export(request)
    if (result.saved) notify({ tone: 'ok', text: `Exported ${result.fileName}` })
    return result.saved
  } catch (err) {
    notify({ tone: 'error', text: message(err) })
    return false
  }
}

/** Open dialog → review screen. */
export async function importKairo(): Promise<void> {
  const { notify, setPreview } = useTransferStore.getState()
  try {
    const preview = await window.api.transfer.pickAndPreview()
    if (preview) setPreview(preview)
  } catch (err) {
    notify({ tone: 'error', text: message(err) })
  }
}

/** Applies the operator's choices, then refreshes every screen that shows them. */
export async function commitKairoImport(request: TransferCommitRequest): Promise<TransferCommitResult> {
  const result = await window.api.transfer.commit(request)
  const [songs, plans] = await Promise.all([
    window.api.lyrics.getLibrary(),
    window.api.scripture.listSermonPlans(),
  ])
  const bootstrap = useBootstrapStore.getState()
  bootstrap.setLyrics(songs)
  bootstrap.setSermonPlans(plans)
  return result
}

export function describeCommit(result: TransferCommitResult): string {
  const parts: string[] = []
  if (result.added) parts.push(`${result.added} song${result.added === 1 ? '' : 's'} added`)
  if (result.replaced) parts.push(`${result.replaced} replaced`)
  if (result.setlistName) parts.push(`playlist “${result.setlistName}” created`)
  if (result.playlistTitle) parts.push(`playlist “${result.playlistTitle}” added`)
  if (parts.length === 0) return 'Nothing was imported.'
  const text = parts.join(', ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}
