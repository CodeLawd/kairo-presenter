import { useEffect, useRef } from 'react'
import { overlayMediaUrl } from '@shared/overlay-template'
import { useImportRequest } from '@/hooks/useImportRequest'
import { useBoothToolboxStore } from '@/stores/useBoothToolboxStore'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'

/**
 * Hidden local player. Lives at the app root so walk-in music survives tab
 * switches. The NDI overlay never hears this.
 */
export function TracksPlayer(): null {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const library = useTracksPlaybackStore((state) => state.library)
  const seekToken = useTracksPlaybackStore((state) => state.seekToken)
  const seekSeconds = useTracksPlaybackStore((state) => state.seekSeconds)

  const live = library.items.find((item) => item.id === library.liveId) ?? null

  useImportRequest(['audio'], () => {
    useBoothToolboxStore.getState().setTab('audio')
    void window.api.tracks.importFiles().catch(() => undefined)
  })

  useEffect(() => {
    let cancelled = false
    window.api.tracks
      .getLibrary()
      .then((next) => {
        if (!cancelled) useTracksPlaybackStore.getState().setLibrary(next)
      })
      .catch(() => undefined)
    const off = window.api.tracks.onLibraryChange((next) => {
      useTracksPlaybackStore.getState().setLibrary(next)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current ?? new Audio()
    audioRef.current = audio
    audio.preload = 'auto'
    const emit = (): void => {
      useTracksPlaybackStore.getState().setTime({
        currentTime: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : 0,
        ended: audio.ended,
      })
    }
    audio.addEventListener('timeupdate', emit)
    audio.addEventListener('durationchange', emit)
    audio.addEventListener('ended', emit)
    return () => {
      audio.removeEventListener('timeupdate', emit)
      audio.removeEventListener('durationchange', emit)
      audio.removeEventListener('ended', emit)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!live) {
      audio.pause()
      audio.removeAttribute('src')
      delete audio.dataset.trackId
      audio.load()
      useTracksPlaybackStore.getState().setTime({ currentTime: 0, duration: 0, ended: false })
      return
    }
    const next = overlayMediaUrl(live.path)
    if (audio.dataset.trackId !== live.id) {
      audio.dataset.trackId = live.id
      audio.src = next
      audio.currentTime = 0
      audio.load()
    }
    if (library.livePaused) {
      audio.pause()
      return
    }
    if (audio.ended) audio.currentTime = 0
    void audio.play().catch(() => undefined)
  }, [live, library.livePaused])

  useEffect(() => {
    if (seekToken === 0) return
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = seekSeconds
  }, [seekToken, seekSeconds])

  return null
}
