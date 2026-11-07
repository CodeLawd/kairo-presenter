import { useEffect, useRef, useState } from 'react'
import type { MediaLibrary } from '@shared/ipc'
import { overlayVideoTime, prepareOverlayMedia } from '@shared/overlay-fit'
import { overlayMediaUrl } from '@shared/overlay-template'
import { DEFAULT_PRESENTATION_SETTINGS } from '@shared/program'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

/**
 * Plays the live background video's sound from this window when no Kairo
 * screen (or NDI feed) is live to play it.
 *
 * Program sound normally comes from the first live screen, so it stays in
 * lip-sync with the picture on the wall. With no screen connected — a
 * rehearsal on a laptop, a projector that dropped out — that would mean
 * silence while the operator watches the video play in the preview. This
 * hands the sound to the operator's machine instead; the moment a screen is
 * live again, it steps back so the room never hears two copies.
 *
 * Not synced: scrubbing (media seek is not broadcast to this window).
 */
export function ProgramAudioFallback(): null {
  const [library, setLibrary] = useState<MediaLibrary | null>(null)
  const audio = useBootstrapStore((s) => (s.settings.presentation ?? DEFAULT_PRESENTATION_SETTINGS).audio)
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs)
  const status = useBootstrapStore((s) => s.ndiStatus)
  const elementRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.media
      .getLibrary()
      .then((next) => {
        if (!cancelled) setLibrary(next)
      })
      .catch(() => undefined)
    const off = window.api.media.onLibraryChange(setLibrary)
    return () => {
      cancelled = true
      off()
    }
  }, [])

  const live = library?.items.find((item) => item.id === library.liveItemId) ?? null
  // A screen that follows the service and shows backgrounds is where program
  // sound lives. Readiness comes from the status the header already polls.
  const surfaceLive = outputs.some((output) => {
    if (!output.enabled || !output.show?.backgrounds) return false
    if (output.kind === 'screen' && output.source === 'playlist') return false
    if (output.kind !== 'screen' && output.kind !== 'ndi') return false
    return status?.outputs.find((s) => s.id === output.id)?.ready === true
  })
  const active = audio.enabled && live?.kind === 'video' && !surfaceLive
  const playback = library?.livePlayback
  const loop = playback?.loop ?? false
  const start = playback?.startSeconds
  const end = playback?.endSeconds
  const rate = playback?.rate
  const paused = library?.livePaused ?? false
  const cue = library?.liveCue
  const path = active ? live?.path : undefined

  // Load a fresh player on every cue, including a cue of the same clip.
  useEffect(() => {
    if (!path) return
    const element = new Audio(overlayMediaUrl(path))
    elementRef.current = element
    if (start !== undefined || end != null || rate !== undefined) {
      element.dataset.mediaStart = String(start ?? 0)
      element.dataset.mediaEnd = end?.toString() ?? ''
      element.dataset.mediaRate = String(rate ?? 1)
    }
    return () => {
      element.pause()
      element.removeAttribute('src')
      element.load()
      elementRef.current = null
    }
  }, [path, cue, start, end, rate])

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    element.loop = loop
    prepareOverlayMedia(element, loop)
  }, [path, cue, start, end, rate, loop])

  useEffect(() => {
    const element = elementRef.current
    if (!element) return
    element.dataset.paPaused = paused ? '1' : ''
    if (paused) {
      element.pause()
    } else {
      if (overlayVideoTime(element).ended) element.currentTime = start ?? 0
      void element.play().catch(() => undefined)
    }
  }, [path, cue, start, end, rate, paused])

  useEffect(() => {
    if (elementRef.current) elementRef.current.volume = Math.min(1, Math.max(0, audio.volume))
  }, [path, cue, start, end, rate, audio.volume])

  // Output device, matched by label the way the Show panel stores it.
  useEffect(() => {
    const element = elementRef.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!element?.setSinkId || !active) return
    let cancelled = false
    void navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        if (cancelled) return
        const match = audio.outputLabel
          ? devices.find((d) => d.kind === 'audiooutput' && d.label === audio.outputLabel)
          : null
        return element.setSinkId?.(match?.deviceId ?? '')
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [active, path, cue, start, end, rate, audio.outputLabel])

  return null
}
