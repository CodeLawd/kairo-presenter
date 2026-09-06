import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader } from '@/icons'
import type { ProPresenterConnectionState } from '@shared/ipc'
import { PP_CONNECT_SUCCESS_HOLD_MS } from '@shared/pp-connect-gate'
import ProPresenterMark from '@/components/brand/ProPresenterMark'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'

interface PpConnectGateProps {
  initialHost: string
  initialPort: number
  password: string
  ppState: ProPresenterConnectionState
  ppVersion: string | null
  onResolved: () => void
}

export default function PpConnectGate({
  initialHost,
  initialPort,
  password,
  ppState,
  ppVersion,
  onResolved,
}: PpConnectGateProps): React.ReactElement {
  const [host, setHost] = useState(initialHost)
  const [port, setPort] = useState(String(initialPort))
  /** Only a Connect click from this dialog — never background reconnect. */
  const [busy, setBusy] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const setPPStatus = useAppStore((s) => s.setPPStatus)

  const onResolvedRef = useRef(onResolved)
  onResolvedRef.current = onResolved

  const connected = ppState === 'connected'
  const failed = attempted && !busy && !connected

  // The launch probe schedules reconnects after a miss. Stop that loop so the
  // form is editable and Skip is never trapped behind "Connecting…".
  useEffect(() => {
    if (connected) return
    void window.api.propresenter.disconnect().catch(() => undefined)
  }, [connected])

  const skip = useCallback(async (): Promise<void> => {
    try {
      await window.api.propresenter.disconnect()
    } catch {
      // Skip must always get the operator into the app.
    }
    onResolvedRef.current()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [skip])

  useEffect(() => {
    if (!connected) return
    const id = window.setTimeout(() => onResolvedRef.current(), PP_CONNECT_SUCCESS_HOLD_MS)
    return () => window.clearTimeout(id)
  }, [connected])

  const connect = async (): Promise<void> => {
    const nextHost = host.trim()
    const nextPort = parseInt(port, 10)
    if (!nextHost || !Number.isFinite(nextPort) || nextPort < 1) return

    setBusy(true)
    setAttempted(true)
    const next = { host: nextHost, port: nextPort, password }
    patchSettings('propresenter', next)
    try {
      await window.api.settings.set('propresenter', next)
      await window.api.propresenter.connect({
        host: nextHost,
        port: nextPort,
        password,
      })
      const status = await window.api.propresenter.getStatus()
      setPPStatus(status)
    } catch {
      // Failed copy below carries the error — stay open so they can try again.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center bg-black/55 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pp-connect-title"
      data-pp-connect-gate="true"
    >
      <div className="relative flex min-h-[22rem] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-surface-border/60 bg-surface shadow-2xl">
        {connected ? (
          <div
            className="flex flex-1 flex-col items-center justify-center px-8 py-10 animate-spring-in"
            role="status"
          >
            <span className="grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-teal-500/15 ring-1 ring-teal-400/40">
              <Check className="h-9 w-9 text-teal-400" strokeWidth={2.5} aria-hidden="true" />
            </span>
            <h1 id="pp-connect-title" className="mt-5 text-[17px] font-semibold tracking-tight text-white">
              Connected
            </h1>
            <p className="mt-1.5 text-[13px] text-zinc-500">
              {ppVersion ?? 'ProPresenter is ready.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col p-6 animate-fade-in">
            <ProPresenterMark className="mb-4" size={32} />
            <h1 id="pp-connect-title" className="text-[17px] font-semibold tracking-tight text-white">
              Connect ProPresenter
            </h1>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">
              Skip if it is not open yet. You can connect later from Settings.
            </p>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="label" htmlFor="pp-gate-host">IP address</label>
                <input
                  id="pp-gate-host"
                  className="input font-mono"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="192.168.1.100"
                  spellCheck={false}
                  disabled={busy}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="label" htmlFor="pp-gate-port">Port</label>
                <input
                  id="pp-gate-port"
                  className="input font-mono text-center"
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  min={1}
                  max={65535}
                  disabled={busy}
                  name="pp-gate-port"
                />
              </div>
            </div>

            <p
              className={`mt-4 text-[12px] ${failed ? 'text-rose-400' : 'text-zinc-500'}`}
              aria-live="polite"
            >
              {busy ? (
                <span className="inline-flex items-center gap-2 text-zinc-400">
                  <Loader size={13} className="animate-spin" aria-hidden="true" />
                  Connecting…
                </span>
              ) : failed ? (
                'No response — is ProPresenter open?'
              ) : (
                'Same network as ProPresenter.'
              )}
            </p>

            <div className="mt-auto flex items-center justify-end gap-2 pt-5">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void skip()}
              >
                Skip
              </button>
              <button
                type="button"
                className="btn-primary min-w-[7.5rem]"
                onClick={() => void connect()}
                disabled={busy || !host.trim()}
              >
                {busy ? 'Connecting…' : failed ? 'Try again' : 'Connect'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
