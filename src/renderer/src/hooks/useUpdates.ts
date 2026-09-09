import { useCallback, useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/ipc'

/**
 * Live auto-update status.
 *
 * Always 'idle' in dev and in any unpackaged build — the main-process service
 * no-ops there — so callers can render unconditionally.
 */
export function useUpdates(): {
  status: UpdateStatus
  busy: boolean
  check: () => Promise<void>
  download: () => Promise<void>
  install: () => Promise<void>
} {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void window.api.updates.getStatus().then((next) => {
      if (live) setStatus(next)
    })
    const unsubscribe = window.api.updates.onStatus(setStatus)
    return () => {
      live = false
      unsubscribe()
    }
  }, [])

  const check = useCallback(async () => {
    setBusy(true)
    try {
      setStatus(await window.api.updates.check())
    } finally {
      setBusy(false)
    }
  }, [])

  // Progress arrives on the push channel, so the resolved status is ignored.
  const download = useCallback(async () => {
    await window.api.updates.download()
  }, [])

  const install = useCallback(async () => {
    await window.api.updates.install()
  }, [])

  return { status, busy, check, download, install }
}
