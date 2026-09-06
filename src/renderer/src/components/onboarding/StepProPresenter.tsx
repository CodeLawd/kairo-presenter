import { useState } from 'react'
import { Check, Loader } from '@/icons'
import { isLocalProPresenterHost } from '@shared/pp-http'
import ProPresenterMark from '@/components/brand/ProPresenterMark'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import PasswordInput from '@/components/ui/password-input'
import { useAppStore } from '@/stores/useAppStore'
import StepShell from './StepShell'

/**
 * Same handshake as `PpConnectGate`, in wizard form: write the settings first,
 * then connect, so a failed attempt still leaves the operator's typed host
 * saved for the next try.
 */
export default function StepProPresenter({
  onConnected,
}: {
  onConnected: () => void
}): React.ReactElement {
  const settings = useBootstrapStore((s) => s.settings)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const setPPStatus = useAppStore((s) => s.setPPStatus)

  const [host, setHost] = useState(settings.propresenter.host)
  const [port, setPort] = useState(String(settings.propresenter.port))
  const [password, setPassword] = useState(settings.propresenter.password)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<'idle' | 'connected' | 'failed'>('idle')
  // Most ProPresenter installs have no network password, so the field stays
  // folded until someone says they need it.
  const [showPassword, setShowPassword] = useState(settings.propresenter.password !== '')

  const connect = async (override?: string): Promise<void> => {
    const nextHost = (override ?? host).trim()
    const nextPort = parseInt(port, 10)
    if (!nextHost || !Number.isFinite(nextPort) || nextPort < 1) return

    setBusy(true)
    if (override) setHost(override)
    const next = { host: nextHost, port: nextPort, password }
    patchSettings('propresenter', next)
    try {
      await window.api.settings.set('propresenter', next)
      await window.api.propresenter.connect(next)
      const status = await window.api.propresenter.getStatus()
      setPPStatus(status)
      const ok = status.state === 'connected'
      setResult(ok ? 'connected' : 'failed')
      if (ok) onConnected()
    } catch {
      setResult('failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <StepShell
      // The one step that is about someone else's software — the mark says so
      // faster than the heading does.
      mark={<ProPresenterMark className="h-7 w-auto" />}
      title="Connect ProPresenter"
      blurb="Kairo drives ProPresenter over your network. Both machines must be on the same one."
    >
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <label className="label" htmlFor="ob-pp-host">IP address</label>
          <input
            id="ob-pp-host"
            className="input font-mono"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.100"
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
          />
        </div>
        <div>
          <label className="label" htmlFor="ob-pp-port">Port</label>
          <input
            id="ob-pp-port"
            className="input font-mono text-center"
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            min={1}
            max={65535}
            disabled={busy}
          />
        </div>
      </div>

      {showPassword ? (
        <div>
          <label className="label" htmlFor="ob-pp-password">Network password</label>
          <PasswordInput
            id="ob-pp-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            disabled={busy}
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-[12px] text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline focus-visible:outline-none focus-visible:text-slate-300"
          onClick={() => setShowPassword(true)}
        >
          ProPresenter asks for a password
        </button>
      )}

      {/* The commonest failure by far is a host saved on another network — the
          church Wi-Fi address, still in the box at home. One tap beats making
          someone find their own IP. */}
      {!isLocalProPresenterHost(host) && (
        <button
          type="button"
          className="self-start text-[12px] text-slate-500 underline-offset-2 transition-colors hover:text-slate-300 hover:underline focus-visible:outline-none focus-visible:text-slate-300"
          onClick={() => void connect('localhost')}
          disabled={busy}
        >
          ProPresenter is running on this computer
        </button>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void connect()}
          disabled={busy || !host.trim()}
        >
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        <p className="min-w-0 flex-1 text-[12px]" aria-live="polite">
          {busy ? (
            <span className="inline-flex items-center gap-2 text-slate-400">
              <Loader size={13} className="animate-spin" aria-hidden="true" />
              Connecting…
            </span>
          ) : result === 'connected' ? (
            <span className="inline-flex items-center gap-1.5 text-teal-400">
              <Check size={13} aria-hidden="true" />
              Connected
            </span>
          ) : result === 'failed' ? (
            <span className="text-rose-400">No response — is ProPresenter open?</span>
          ) : (
            <span className="text-slate-600">Enable the network API in ProPresenter preferences.</span>
          )}
        </p>
      </div>
    </StepShell>
  )
}
