import { useLayoutEffect, useRef, useState } from 'react'
import type { DocumentPlaybackStatus, DocumentVideoCommand, ProjectionDocument } from '@shared/documents'
import { overlayMediaUrl } from '@shared/overlay-template'

/** Muted monitor follows the actual program transports; only program outputs play audio. */
export function DocumentSlidePreview({ doc, page, playback, local = false, command, onPlayback }: {
  doc: ProjectionDocument; page: number; playback: DocumentPlaybackStatus | null
  local?: boolean
  command?: { video: number; command: DocumentVideoCommand; sequence: number } | null
  onPlayback?: (status: DocumentPlaybackStatus) => void
}): React.ReactElement {
  const container = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const videos = useRef<Array<HTMLVideoElement | null>>([])
  const [bounds, setBounds] = useState({ width: 0, height: 0, left: 0, top: 0 })
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const fit = (): void => {
      const size = doc.slideSize ?? { width: image.current?.naturalWidth ?? 1920, height: image.current?.naturalHeight ?? 1080 }
      if (!size.width || !size.height) return
      const scale = Math.min(root.clientWidth / size.width, root.clientHeight / size.height)
      const width = size.width * scale, height = size.height * scale
      setBounds({ width, height, left: (root.clientWidth - width) / 2, top: (root.clientHeight - height) / 2 })
    }
    const observer = new ResizeObserver(fit)
    observer.observe(root)
    image.current?.addEventListener('load', fit)
    fit()
    return () => { observer.disconnect(); image.current?.removeEventListener('load', fit) }
  }, [doc.id, doc.slideSize, page])

  useLayoutEffect(() => {
    if (local) return
    const matches = playback?.id === doc.id && playback.page === page
    videos.current.forEach((video, index) => {
      if (!video) return
      const state = matches ? playback.videos[index] : undefined
      const start = doc.videos?.[page]?.[index]?.start ?? 0
      const target = start + (state?.currentTime ?? 0)
      const tolerance = state?.paused || state?.ended ? 0.04 : 0.4
      if (video.readyState >= 1 && Math.abs(video.currentTime - target) > tolerance) video.currentTime = target
      if (!state || state.paused || state.ended || state.error) video.pause()
      else void video.play().catch(() => undefined)
    })
  }, [playback, doc.id, doc.videos, page, local])

  const publish = (): void => {
    if (!local) return
    onPlayback?.({ id: doc.id, page, videos: (doc.videos?.[page] ?? []).map((clip, index) => {
      const video = videos.current[index]
      const end = Math.min(clip.end ?? Infinity, video?.duration || Infinity)
      const ended = !!video && (video.ended || video.currentTime >= end - 0.03)
      if (ended && video && !video.paused) video.pause()
      return { currentTime: Math.max(0, (video?.currentTime ?? clip.start) - clip.start), duration: Number.isFinite(end) ? Math.max(0, end - clip.start) : 0,
        paused: video?.paused ?? true, ended, visible: video?.dataset.visible === 'true', error: video?.error ? 'This video could not be played.' : null }
    }) })
  }
  useLayoutEffect(() => {
    if (local) publish()
  }, [local, doc.id, page])
  useLayoutEffect(() => {
    if (!local || !command) return
    const video = videos.current[command.video]
    const clip = doc.videos?.[page]?.[command.video]
    if (!video || !clip) return
    const action = command.command
    if (action.action === 'pause') video.pause()
    else {
      video.dataset.visible = 'true'
      if (action.action === 'seek') video.currentTime = Math.min(clip.end ?? video.duration, clip.start + Math.max(0, action.seconds))
      else {
        if (action.action === 'restart' || video.ended || video.currentTime >= (clip.end ?? video.duration) - 0.03) video.currentTime = clip.start
        void video.play().catch(publish)
      }
    }
    publish()
  // Transport commands are consumed once; playback updates must not replay them.
  }, [command, local, doc.id, page])

  return (
    <div ref={container} className="relative min-h-0 flex-1 overflow-hidden bg-black">
      <img ref={image} className="h-full w-full object-contain" src={overlayMediaUrl(doc.pages[page])} alt={`${doc.name}, page ${page + 1}`} />
      <div className="absolute overflow-hidden" style={bounds}>
        {(doc.videos?.[page] ?? []).map((clip, index) => {
          const state = playback?.id === doc.id && playback.page === page ? playback.videos[index] : undefined
          // The public document contains cached filenames, not paths. Pages and media share a document directory.
          const slash = Math.max(doc.pages[page].lastIndexOf('/'), doc.pages[page].lastIndexOf('\\'))
          const file = `${doc.pages[page].slice(0, slash)}/media/${clip.file}`
          return (
            <video key={`${doc.id}:${page}:${index}`} ref={(node) => { videos.current[index] = node }}
              src={overlayMediaUrl(file)} muted={!local} playsInline preload="metadata"
              onLoadedMetadata={(event) => { if (local) { event.currentTarget.currentTime = clip.start; publish() } }}
              onTimeUpdate={publish} onPlay={publish} onPause={publish} onEnded={publish} onError={publish}
              className="absolute object-fill"
              style={{ left: `${clip.box.x * 100}%`, top: `${clip.box.y * 100}%`, width: `${clip.box.width * 100}%`, height: `${clip.box.height * 100}%`, visibility: state?.visible && !state.error ? 'visible' : 'hidden' }}
            />
          )
        })}
      </div>
    </div>
  )
}
