import { useEffect, useRef, useState } from 'react'
import type { MediaLibrary } from '@shared/ipc'
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
  const loop = live ? (library?.playback[live.id]?.loop ?? false) : false
  const paused = library?.livePaused ?? false

  // Source: load when the live video changes, drop it when inactive.
  useEffect(() => {
    const element = elementRef.current ?? new Audio()
    elementRef.current = element
    if (!active || !live) {
      element.pause()
      element.removeAttribute('src')
      delete element.dataset.itemId
      element.load()
      return
    }
    if (element.dataset.itemId !== live.id) {
      element.dataset.itemId = live.id
      element.src = overlayMediaUrl(live.path)
      element.currentTime = 0
    }
  }, [active, live])

  // Transport, loop and level follow the program.
  useEffect(() => {
    const element = elementRef.current
    if (!element || !active) return
    element.loop = loop
    element.volume = Math.min(1, Math.max(0, audio.volume))
    if (paused) element.pause()
    else void element.play().catch(() => undefined)
  }, [active, loop, paused, audio.volume, live?.id])

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
  }, [active, audio.outputLabel])

  useEffect(() => () => {
    elementRef.current?.pause()
  }, [])

  return null
}
