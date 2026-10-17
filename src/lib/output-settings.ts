import type { AppSettings, OverlayOutput } from './ipc'
import { liveOverlayTheme } from './overlay-outputs'
import { normalizeOverlaySettings } from './overlay-defaults'

type Overlay = AppSettings['overlay']
export type OutputEdit = (outputs: OverlayOutput[]) => OverlayOutput[]

/** Reads at edit time, including for debounced theme saves behind the screens modal. */
export function createOutputSettingsWriter({ read, publish, persist }: {
  read: () => Overlay
  publish: (overlay: Overlay) => void
  persist: (patch: Pick<Overlay, 'outputs' | 'theme'>) => Promise<void>
}): (edit: OutputEdit) => Promise<Overlay> {
  let revision = 0
  let pending = 0
  let confirmed: Overlay | undefined
  let confirmedRevision = 0
  let latestFailed = false
  return async (edit) => {
    const version = ++revision
    const previous = read()
    const next = normalizeOverlaySettings({ ...previous, outputs: edit(previous.outputs) })
    next.theme = liveOverlayTheme(next, 'scripture')
    if (pending === 0) {
      confirmed = previous
      confirmedRevision = version - 1
    }
    pending++
    latestFailed = false
    publish(next)
    try {
      // Other overlay controls own their own fields; never persist their stale copies.
      await persist({ outputs: next.outputs, theme: next.theme })
      if (version > confirmedRevision) {
        confirmed = next
        confirmedRevision = version
      }
      return next
    } catch (error) {
      if (revision === version) latestFailed = true
      throw error
    } finally {
      pending--
      // A failed optimistic predecessor is not a recovery snapshot. Wait for
      // the batch to settle, then restore only the last acknowledged list.
      if (pending === 0 && latestFailed && confirmed) {
        publish({ ...read(), outputs: confirmed.outputs, theme: confirmed.theme })
      }
    }
  }
}
