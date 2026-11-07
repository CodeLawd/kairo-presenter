import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pause, Play } from '@/icons'
import type { MediaItem, MediaPlayback } from '@shared/ipc'
import { DEFAULT_MEDIA_PLAYBACK, formatMediaClock, mediaFilterCss } from '@shared/media-playback'
import { overlayMediaUrl } from '@shared/overlay-template'

import { formatDocumentSize } from '@shared/documents'
import { TrimTimeline } from './TrimTimeline'

const COLOR_CONTROLS = [
  { key: 'brightness', label: 'Brightness', min: 0.25, max: 1.75 },
  { key: 'contrast', label: 'Contrast', min: 0.25, max: 1.75 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2 },
] as const

export function MediaInspector({ item, playback, onClose, onSave }: {
  item: MediaItem
  playback: MediaPlayback
  onClose: () => void
  onSave: (settings: Partial<MediaPlayback>) => Promise<void>
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const previewing = useRef(false)
  const isVideo = item.kind === 'video'
  const [panel, setPanel] = useState(isVideo ? 'Playback' : 'Appearance')
  const [appearance, setAppearance] = useState({
    brightness: playback.brightness, contrast: playback.contrast, saturation: playback.saturation,
    fit: playback.fit ?? null,
  })
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [start, setStart] = useState(String(playback.startSeconds ?? 0))
  const [end, setEnd] = useState(playback.endSeconds?.toString() ?? '')
  const [rate, setRate] = useState(playback.rate ?? 1)
  const [loop, setLoop] = useState(playback.loop)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inPoint = Number(start)
  const outPoint = end === '' ? duration : Number(end)
  const trimChanged = start !== String(playback.startSeconds ?? 0) || end !== (playback.endSeconds?.toString() ?? '')
  const valid = duration > 0 && start !== '' && inPoint >= 0 && inPoint < outPoint && outPoint <= duration
  const canSave = !isVideo || !trimChanged || valid
  const trimGap = Math.min(0.01, duration / 2)
  const trackStart = valid ? inPoint : Math.max(0, Math.min(duration - trimGap, inPoint))
  const trackEnd = valid ? outPoint : Math.max(trackStart + trimGap, Math.min(duration, outPoint))
  const previewStyle = { filter: mediaFilterCss({ ...playback, ...appearance }), objectFit: appearance.fit ?? 'contain' } as const
  const previewClass = 'aspect-video w-full rounded-md bg-black'

  useLayoutEffect(() => {
    const node = dialog.current
    node?.showModal()
    return () => node?.close()
  }, [])

  const seek = (seconds: number): void => {
    if (!video.current || !duration) return
    previewing.current = false
    video.current.pause()
    const time = Math.max(0, Math.min(duration, seconds))
    video.current.currentTime = time
    setPosition(time)
  }

  const togglePreview = (): void => {
    const player = video.current
    if (!player) return
    if (!player.paused) {
      previewing.current = false
      player.pause()
      return
    }
    if (!valid) return
    if (player.currentTime < inPoint || player.currentTime >= outPoint) player.currentTime = inPoint
    player.playbackRate = rate
    previewing.current = true
    void player.play().catch((reason: DOMException) => {
      if (reason.name !== 'AbortError') {
        previewing.current = false
        setError('The video preview could not play.')
      }
    })
  }

  const updatePosition = (player: HTMLVideoElement): void => {
    setPosition(player.currentTime)
    if (!previewing.current || !valid || player.seeking || player.currentTime < outPoint) return
    if (loop) {
      player.currentTime = inPoint
      if (player.paused) void player.play().catch(() => setError('The video preview could not restart.'))
    } else {
      previewing.current = false
      if (!player.ended) {
        player.pause()
        player.currentTime = outPoint
      }
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      aria-labelledby="media-inspector-title"
      onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}
      className="m-auto max-h-[90vh] w-[calc(100%_-_2rem)] max-w-4xl overflow-y-auto rounded-xl border border-surface-border bg-surface-elevated p-0 text-slate-200 shadow-2xl backdrop:bg-black/60"
    >
      <form onSubmit={async (event) => {
        event.preventDefault()
        if (!canSave || saving) return
        setSaving(true)
        setError(null)
        try {
          await onSave({
            ...appearance,
            ...(isVideo ? { rate, loop } : {}),
            ...(isVideo && valid ? { startSeconds: inPoint, endSeconds: end === '' ? null : outPoint } : {}),
          })
          onClose()
        } catch (err) {
          setError((err as Error).message)
          setSaving(false)
        }
      }}>
        <header className="border-b border-surface-border px-5 py-4">
          <h2 id="media-inspector-title" className="text-base font-semibold">Media Inspector</h2>
          <p className="truncate text-xs text-slate-400" title={item.name}>{item.name}</p>
        </header>
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_17rem]">
          <section aria-label="Private preview" className="min-w-0">
            {isVideo ? <video
              ref={video}
              src={overlayMediaUrl(item.path)}
              muted
              playsInline
              preload="metadata"
              className={previewClass}
              style={previewStyle}
              onLoadedMetadata={({ currentTarget: player }) => {
                setDimensions({ width: player.videoWidth, height: player.videoHeight })
                if (!Number.isFinite(player.duration) || player.duration <= 0) return
                setDuration(player.duration)
                if (inPoint > 0 && inPoint < player.duration) player.currentTime = inPoint
              }}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={({ currentTarget }) => { setPlaying(false); updatePosition(currentTarget) }}
              onTimeUpdate={({ currentTarget }) => updatePosition(currentTarget)}
              onError={() => { setDuration(0); setError('This video could not be opened for preview.') }}
            /> : <img
              src={overlayMediaUrl(item.path)}
              alt={item.name}
              className={previewClass}
              style={previewStyle}
              onLoad={({ currentTarget: image }) => setDimensions({ width: image.naturalWidth, height: image.naturalHeight })}
              onError={() => setError('This image could not be opened for preview.')}
            />}
            {isVideo && <>
              <p className="mt-3 text-xs text-slate-400">Drag the handles to set the start and end.</p>
              <TrimTimeline duration={duration} start={trackStart} end={trackEnd} onTrim={(edge, time) => {
                if (edge === 'start') setStart(String(time))
                else setEnd(time >= duration ? '' : String(time))
                seek(time)
              }} />
              <input type="range" aria-label="Preview playhead" aria-valuetext={formatMediaClock(position)}
                className="mt-2 w-full accent-teal-400" min={0} max={duration} step="any"
                value={position} disabled={!duration} onChange={(event) => seek(Number(event.target.value))} />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary text-xs" disabled={!duration} onClick={() => seek(position - 10)}>−10s</button>
                <button type="button" className="btn-secondary text-xs" aria-label={playing ? 'Pause preview' : 'Play preview'}
                  disabled={!valid && !playing} onClick={togglePreview}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <button type="button" className="btn-secondary text-xs" disabled={!duration} onClick={() => seek(position + 10)}>+10s</button>
                <span className="ml-auto text-xs tabular-nums text-slate-400">{formatMediaClock(position)} / {formatMediaClock(duration)}</span>
              </div>
            </>}
          </section>
          <div className="min-w-0">
            <div role="group" aria-label="Inspector sections" className="mb-4 flex gap-1 rounded-md bg-surface-secondary p-1">
              {(isVideo ? ['Playback', 'Appearance', 'Details'] : ['Appearance', 'Details']).map((section) => (
                <button
                  key={section}
                  type="button"
                  aria-pressed={panel === section}
                  className="flex-1 rounded px-2 py-1.5 text-xs text-slate-400 hover:text-white aria-pressed:bg-surface-elevated aria-pressed:text-white"
                  onClick={() => setPanel(section)}
                >{section}</button>
              ))}
            </div>
            {panel === 'Playback' && <fieldset disabled={saving} className="min-w-0 space-y-3">
              <legend className="mb-2 text-sm font-semibold">Playback settings</legend>
              <label htmlFor="video-in-point" className="label">Start (seconds)</label>
              <div className="flex gap-2">
                <input id="video-in-point" className="input min-w-0 flex-1" type="number" min={0} step="any" value={start}
                  onChange={(event) => setStart(event.target.value)} />
                <button type="button" className="btn-secondary shrink-0 text-xs" aria-label="Set start to playhead" disabled={!duration} onClick={() => setStart(String(position))}>Use playhead</button>
              </div>
              <label htmlFor="video-out-point" className="label">End (seconds)</label>
              <div className="flex gap-2">
                <input id="video-out-point" className="input min-w-0 flex-1" type="number" min={0} step="any" placeholder="File end" value={end}
                  onChange={(event) => setEnd(event.target.value)} />
                <button type="button" className="btn-secondary shrink-0 text-xs" aria-label="Set end to playhead" disabled={!duration} onClick={() => setEnd(position >= duration ? '' : String(position))}>Use playhead</button>
              </div>
              <p className="text-xs text-slate-400">
                {valid ? `Selected duration ${(outPoint - inPoint).toFixed(2)}s` : duration > 0 ? 'Choose a start before the end, within the video.' : 'Trim requires a seekable video with a known duration.'}
              </p>
              <label className="block">
                <span className="label">Speed · {rate}×</span>
                <input type="range" className="mt-2 w-full accent-teal-400" min={0.5} max={2} step={0.05} value={rate}
                  onChange={(event) => {
                    const next = Number(event.target.value)
                    setRate(next)
                    if (video.current) video.current.playbackRate = next
                  }} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-teal-400" checked={loop} onChange={(event) => setLoop(event.target.checked)} />
                Loop selected range
              </label>
            </fieldset>}
            {panel === 'Appearance' && <fieldset disabled={saving} className="space-y-4">
              <legend className="mb-2 text-sm font-semibold">Appearance</legend>
              <label className="block">
                <span className="label">Scaling</span>
                <select className="input" value={appearance.fit ?? ''} onChange={(event) => {
                  const fit = event.target.value as MediaPlayback['fit']
                  setAppearance((current) => ({ ...current, fit: fit || null }))
                }}>
                  <option value="">Use output setting</option>
                  <option value="contain">Scale to fit</option>
                  <option value="cover">Fill and crop</option>
                  <option value="fill">Stretch to fill</option>
                </select>
              </label>
              {appearance.fit === null && <p className="text-xs text-slate-400">The preview shows the full source. Each output uses its own scaling.</p>}
              <div className="space-y-3">
                <h3 className="text-xs font-semibold">Adjust color</h3>
                {COLOR_CONTROLS.map(({ key, label, min, max }) => (
                  <label key={key} className="grid grid-cols-[5rem_minmax(0,1fr)_2.75rem] items-center gap-2 text-xs">
                    <span>{label}</span>
                    <input
                      type="range" min={min} max={max} step={0.05} value={appearance[key]}
                      className="w-full accent-teal-400"
                      onChange={(event) => {
                        const value = Number(event.target.value)
                        setAppearance((current) => ({ ...current, [key]: value }))
                      }}
                    />
                    <span className="text-right tabular-nums text-slate-400">{Math.round(appearance[key] * 100)}%</span>
                  </label>
                ))}
              </div>
              <button type="button" className="btn-secondary text-xs" onClick={() => setAppearance({
                brightness: DEFAULT_MEDIA_PLAYBACK.brightness, contrast: DEFAULT_MEDIA_PLAYBACK.contrast,
                saturation: DEFAULT_MEDIA_PLAYBACK.saturation, fit: null,
              })}>Reset appearance</button>
            </fieldset>}
            {panel === 'Details' && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-xs">
              <dt className="text-slate-400">Format</dt>
              <dd>{item.ext.toUpperCase()}</dd>
              <dt className="text-slate-400">File size</dt>
              <dd>{formatDocumentSize(item.sizeBytes)}</dd>
              <dt className="text-slate-400">Resolution</dt>
              <dd>{dimensions ? `${dimensions.width} × ${dimensions.height}` : 'Unavailable'}</dd>
              {isVideo && <>
                <dt className="text-slate-400">Duration</dt>
                <dd>{duration ? `${duration.toFixed(2)} s` : 'Unavailable'}</dd>
              </>}
              <dt className="col-span-2 mt-2 text-slate-400">File path</dt>
              <dd className="col-span-2 break-all select-text">{item.path}</dd>
            </dl>}
          </div>
        </div>
        {error && <p role="alert" className="px-5 pb-3 text-sm text-red-300">{error}</p>}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-surface-border px-5 py-3">
          <p className="mr-auto text-xs text-slate-400">Applies the next time you cue this item.</p>
          <button type="button" className="btn-secondary text-xs" disabled={saving} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary text-xs disabled:opacity-50" disabled={!canSave || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </footer>
      </form>
    </dialog>,
    document.body,
  )
}
