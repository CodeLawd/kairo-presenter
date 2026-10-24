import { useEffect, useState } from 'react'
import { X } from '@/icons'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useCaptureStore } from '@/stores/useCaptureStore'
import {
  CAPTURE_BITRATES,
  CAPTURE_CODECS,
  CAPTURE_FRAME_RATES,
  CAPTURE_RESOLUTIONS,
  captureSourceFor,
  captureSources,
  gigabytesPerHour,
  normalizeCaptureSettings,
  type CaptureAudioInput,
  type CaptureSettings as Settings,
} from '@shared/capture'
import type { OverlayOutput } from '@shared/ipc'

const KIND_LABEL: Record<OverlayOutput['kind'], string> = {
  screen: 'Screen',
  ndi: 'NDI',
  syphon: 'Syphon',
  device: 'Video card',
}

const SELECT = 'input h-7 w-[220px] py-0 text-[13px]'

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-[44px] items-center justify-between gap-3 px-3.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-none text-white">{label}</p>
        {hint && <p className="mt-1 text-[11px] leading-snug text-white/40">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="space-y-2">
      <h3 className="px-0.5 text-[13px] font-semibold tracking-tight text-white">{title}</h3>
      <div className="pref-group overflow-hidden rounded-xl bg-surface-tertiary">{children}</div>
    </section>
  )
}

/** "~/Movies/Kairo" style: the last two folders, which is what tells them apart. */
function shortFolder(folder: string): string {
  if (!folder) return 'Movies › Kairo'
  const parts = folder.split(/[\\/]/).filter(Boolean)
  return parts.slice(-2).join(' › ') || folder
}

/**
 * Capture Settings, as in ProPresenter: what is recorded (an output), how it
 * is encoded, where the file goes and which sound goes with it.
 */
export function CaptureSettings({ onClose }: { onClose: () => void }): React.ReactElement {
  const stored = useBootstrapStore((s) => s.settings.capture)
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs)
  const settings = normalizeCaptureSettings(stored)
  const { status } = useCaptureStore()
  const [inputs, setInputs] = useState<CaptureAudioInput[]>([])

  useEffect(() => {
    void window.api.capture.audioInputs().then(setInputs).catch(() => setInputs([]))
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = (patch: Partial<Settings>): void => {
    const next = normalizeCaptureSettings({ ...settings, ...patch })
    useBootstrapStore.getState().patchSettings('capture', next)
    void window.api.settings.set('capture', next)
  }

  const chooseFolder = async (): Promise<void> => {
    const folder = await window.api.capture.chooseFolder()
    if (folder) useBootstrapStore.getState().patchSettings('capture', { ...settings, folder })
  }

  const sources = captureSources(outputs)
  const source = captureSourceFor(settings, outputs)
  const codec = CAPTURE_CODECS.find((c) => c.value === settings.codec) ?? CAPTURE_CODECS[0]
  const compressed = settings.codec === 'h264' || settings.codec === 'hevc'
  const audioMissing = !!settings.audioDeviceId && inputs.length > 0 && !inputs.some((i) => i.id === settings.audioDeviceId)
  const recording = status.recording

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/35 p-4 animate-fade-in" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-settings-title"
        className="flex max-h-[min(720px,92vh)] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl modal-glass shadow-2xl animate-spring-in"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 px-5 pb-2 pt-4">
          <h2 id="capture-settings-title" className="min-w-0 flex-1 text-[15px] font-semibold tracking-tight text-white">Capture Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-md text-white/40 hover:bg-surface-tertiary hover:text-white">
            <X size={14} aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5 pt-2">
          {recording && (
            <p className="rounded-lg bg-surface-tertiary px-3.5 py-2.5 text-[12px] text-white/60">
              Recording {status.sourceName} — changes here apply to the next recording.
            </p>
          )}

          <Group title="Picture">
            <Row label="Source" hint={source && !source.enabled ? `${source.name} is off — turn it on in Screens` : undefined}>
              {sources.length === 0 ? (
                <span className="text-[12px] text-white/40">No screens yet</span>
              ) : (
                <select className={SELECT} value={source?.id ?? ''} onChange={(e) => save({ sourceOutputId: e.target.value })} aria-label="Source">
                  {sources.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {KIND_LABEL[o.kind]}{o.enabled ? '' : ' (off)'}
                    </option>
                  ))}
                </select>
              )}
            </Row>
            <Row label="Size">
              <select className={SELECT} value={settings.resolution} onChange={(e) => save({ resolution: e.target.value as Settings['resolution'] })} aria-label="Size">
                {CAPTURE_RESOLUTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </Row>
            <Row label="Frame rate">
              <select className={SELECT} value={settings.frameRate} onChange={(e) => save({ frameRate: Number(e.target.value) as Settings['frameRate'] })} aria-label="Frame rate">
                {CAPTURE_FRAME_RATES.map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
              </select>
            </Row>
          </Group>

          <Group title="File">
            <Row label="Format" hint={codec.hint}>
              <select className={SELECT} value={settings.codec} onChange={(e) => save({ codec: e.target.value as Settings['codec'] })} aria-label="Format">
                {CAPTURE_CODECS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </Row>
            {compressed && (
              <Row label="Quality">
                <select className={SELECT} value={settings.bitrateMbps} onChange={(e) => save({ bitrateMbps: Number(e.target.value) })} aria-label="Quality">
                  {CAPTURE_BITRATES.some((b) => b.value === settings.bitrateMbps) ? null : (
                    <option value={settings.bitrateMbps}>{settings.bitrateMbps} Mbps</option>
                  )}
                  {CAPTURE_BITRATES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                </select>
              </Row>
            )}
            <Row label="Save to" hint={`About ${gigabytesPerHour(settings).toFixed(gigabytesPerHour(settings) < 10 ? 1 : 0)} GB per hour`}>
              <div className="flex items-center gap-2">
                <span className="max-w-[150px] truncate text-[12px] text-white/60" title={settings.folder || 'Movies/Kairo in your home folder'}>
                  {shortFolder(settings.folder)}
                </span>
                <button type="button" className="btn-secondary h-7 px-2.5 text-[12px]" onClick={() => void chooseFolder()}>
                  Choose…
                </button>
              </div>
            </Row>
          </Group>

          <Group title="Sound">
            <Row
              label="Audio input"
              hint={audioMissing
                ? `${settings.audioDeviceName || 'The chosen input'} isn’t connected`
                : 'Plug the sound desk into this Mac to record the service sound.'}
            >
              <select
                className={SELECT}
                value={settings.audioDeviceId}
                onChange={(e) => save({
                  audioDeviceId: e.target.value,
                  audioDeviceName: inputs.find((i) => i.id === e.target.value)?.name ?? '',
                })}
                aria-label="Audio input"
              >
                <option value="">No sound</option>
                {audioMissing && <option value={settings.audioDeviceId}>{settings.audioDeviceName || 'Disconnected input'}</option>}
                {inputs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </Row>
          </Group>

          {status.error && !recording && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3.5 py-2.5 text-[12px] text-red-300">{status.error}</p>
          )}
        </div>

        <footer className="flex items-center gap-2 bg-surface-tertiary px-5 py-3.5">
          <button type="button" className="btn-secondary h-8 px-3 text-[12px]" onClick={() => void window.api.capture.reveal()}>
            Show in Finder
          </button>
          <span className="flex-1" />
          <button
            type="button"
            className="btn-primary h-8 px-3.5 text-[12px]"
            onClick={onClose}
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  )
}
