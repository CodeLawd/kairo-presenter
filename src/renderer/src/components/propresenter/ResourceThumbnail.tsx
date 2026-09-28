import { useEffect, useState } from 'react'
import { AlertCircle, Eye, FileText, Loader, RefreshCw, Route, Video } from '@/icons'
import type { PPResourcePreview, PPResourceSummary } from '@shared/propresenter-resources'
import { cn } from '@/lib/utils'

export interface ResourceThumbnailProps {
  resource: PPResourceSummary
  childId?: string
  /** Preview requests are made only for selected rows or rows in the visible window. */
  selected?: boolean
  visible?: boolean
  /** Rows are buttons, so their compact thumbnails suppress the nested retry button. */
  showRetry?: boolean
  className?: string
}

function PreviewPlaceholder({ resource, className }: { resource: PPResourceSummary; className?: string }): React.ReactElement {
  const Icon = resource.previewKind === 'none'
    ? Video
    : resource.previewKind === 'text'
      ? FileText
      : resource.previewKind === 'details'
        ? Route
        : Eye

  return (
    <div
      className={cn('flex h-full min-h-16 w-full items-center justify-center rounded-lg bg-surface-secondary text-slate-600', className)}
      aria-label={`${resource.name} preview unavailable`}
    >
      <Icon size={18} aria-hidden="true" />
      {resource.previewKind === 'none' && (
        <span className="ml-2 max-w-[10rem] truncate text-[9px]">Preview unavailable</span>
      )}
    </div>
  )
}

function MessagePreview({ text }: { text: string }): React.ReactElement {
  return (
    <div className="flex h-full min-h-16 w-full items-center justify-center rounded-lg border border-surface-border/50 bg-surface-secondary px-3 py-2 text-center">
      <span className="line-clamp-3 text-[11px] font-medium leading-snug text-slate-300">{text}</span>
    </div>
  )
}

function DetailPreview({ resource, details }: { resource: PPResourceSummary; details?: Record<string, unknown> }): React.ReactElement {
  const detailCount = details ? Object.keys(details).length : 0
  return (
    <div
      className="flex h-full min-h-16 w-full flex-col justify-center rounded-lg border border-surface-border/50 bg-surface-secondary px-3 py-2"
      aria-label={`${resource.name} routing preview`}
    >
      <div className="flex items-center gap-2 text-slate-300">
        <Route size={15} aria-hidden="true" />
        <span className="text-[11px] font-semibold">Routing details</span>
      </div>
      <span className="mt-1 text-[10px] text-slate-500">
        {detailCount > 0 ? `${detailCount} safe detail fields` : 'No detail fields returned'}
      </span>
    </div>
  )
}

function PreviewContent({ resource, preview }: { resource: PPResourceSummary; preview: PPResourcePreview }): React.ReactElement {
  if (preview.previewKind === 'thumbnail' || preview.previewKind === 'icon') {
    if (preview.dataUrl?.startsWith('data:image/')) {
      return (
        <img
          src={preview.dataUrl}
          alt={`${resource.name} preview`}
          className="h-full min-h-16 w-full rounded-lg object-cover"
        />
      )
    }
    return <PreviewPlaceholder resource={resource} />
  }
  if (preview.previewKind === 'text') {
    return <MessagePreview text={preview.text || 'Preview unavailable'} />
  }
  if (preview.previewKind === 'details') {
    return <DetailPreview resource={resource} details={preview.details} />
  }
  return <PreviewPlaceholder resource={resource} />
}

/**
 * A renderer-only preview surface. The API returns either safe image data,
 * plain text, or sanitized details; no ProPresenter HTML is ever injected.
 */
export default function ResourceThumbnail({
  resource,
  childId,
  selected = false,
  visible = false,
  showRetry = true,
  className,
}: ResourceThumbnailProps): React.ReactElement {
  const [preview, setPreview] = useState<PPResourcePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const shouldLoad = selected || visible
  const canRequest = resource.previewKind !== 'none' && !(resource.kind === 'theme' && !childId)

  useEffect(() => {
    let active = true

    if (!shouldLoad || !canRequest) {
      setLoading(false)
      setError(false)
      return () => {
        active = false
      }
    }

    setLoading(true)
    setError(false)
    setPreview(null)

    window.api.propresenter
      .getResourcePreview(resource.kind, resource.id, childId)
      .then((result) => {
        if (!active) return
        if (!result) throw new Error('Preview unavailable')
        setPreview(result)
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      // IPC has no cancellation primitive; this guard prevents a late response
      // from setting state after the row or detail panel has unmounted.
      active = false
    }
  }, [attempt, canRequest, childId, resource.id, resource.kind, shouldLoad])

  if (!shouldLoad || !canRequest) {
    return <PreviewPlaceholder resource={resource} className={className} />
  }

  if (loading) {
    return (
      <div className={cn('flex h-full min-h-16 w-full items-center justify-center rounded-lg bg-surface-secondary text-slate-600', className)}>
        <Loader size={16} className="animate-spin" aria-label={`Loading ${resource.name} preview`} />
      </div>
    )
  }

  if (error || !preview) {
    return (
      <div className={cn('flex h-full min-h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border border-rose-500/20 bg-tint-rose px-2 text-center', className)}>
        <AlertCircle size={15} className="text-rose-400" aria-hidden="true" />
        <span className="text-[10px] text-slate-500">Preview unavailable</span>
        {showRetry && (
          <button
            type="button"
            className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-white"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw size={10} aria-hidden="true" />
            Retry
          </button>
        )}
      </div>
    )
  }

  return <div className={cn('h-full min-h-16 w-full', className)}><PreviewContent resource={resource} preview={preview} /></div>
}
