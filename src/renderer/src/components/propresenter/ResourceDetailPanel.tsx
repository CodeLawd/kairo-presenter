import { useEffect, useMemo, useState } from 'react'
import { Check, CircleOff, Link2, Loader, RefreshCw, X } from '@/icons'
import type {
  PPResourceBindings,
  PPResourceCatalogue,
  PPResourceKind,
  PPResourceSummary,
} from '@shared/propresenter-resources'
import { normalizeResourceId, validateResourceBindings } from '@shared/propresenter-resources'
import { cn } from '@/lib/utils'
import ResourceThumbnail from './ResourceThumbnail'

export type ResourceBindingKey = keyof PPResourceBindings

export const RESOURCE_BINDING_ROLES: ReadonlyArray<{
  key: ResourceBindingKey
  label: string
  kind: PPResourceKind
}> = [
  { key: 'scriptureThemeId', label: 'Scripture theme', kind: 'theme' },
  { key: 'lyricsThemeId', label: 'Lyrics theme', kind: 'theme' },
  { key: 'lowerThirdMessageId', label: 'Lower-third message', kind: 'message' },
  { key: 'defaultLookId', label: 'Default look', kind: 'look' },
  { key: 'ndiVideoInputId', label: 'Kairo video input', kind: 'videoInput' },
  { key: 'confidenceStageLayoutId', label: 'Confidence stage layout', kind: 'stageLayout' },
  { key: 'clearGroupId', label: 'Clear group', kind: 'clearGroup' },
  { key: 'serviceStartMacroId', label: 'Service-start macro', kind: 'macro' },
]

export const ESSENTIAL_RESOURCE_BINDING_ROLES: ReadonlyArray<ResourceBindingKey> = [
  'scriptureThemeId',
  'lowerThirdMessageId',
  'defaultLookId',
  'ndiVideoInputId',
]

interface ResourceChild {
  id: string
  name: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function findChildList(value: unknown, depth = 0): unknown[] {
  if (depth > 3 || !isRecord(value)) return []
  for (const key of ['slides', 'children', 'items']) {
    if (Array.isArray(value[key])) return value[key]
  }
  for (const key of ['theme', 'presentation', 'data']) {
    const nested = findChildList(value[key], depth + 1)
    if (nested.length > 0) return nested
  }
  return []
}

function childrenFromDetails(details: Record<string, unknown> | null): ResourceChild[] {
  return findChildList(details)
    .map((value, index) => {
      const record = isRecord(value) ? value : {}
      const id = normalizeResourceId(value)
      if (!id) return null
      return {
        id,
        name: firstString(record.name, record.title, record.label, `Slide ${index + 1}`),
      }
    })
    .filter((value): value is ResourceChild => value !== null)
    .slice(0, 40)
}

export interface ResourceDetailPanelProps {
  resource: PPResourceSummary | null
  catalogue: PPResourceCatalogue
  bindings: PPResourceBindings
  bindingKeys?: ReadonlyArray<ResourceBindingKey>
  onBindingChange: (key: ResourceBindingKey, id: string) => Promise<void>
}

export default function ResourceDetailPanel({
  resource,
  catalogue,
  bindings,
  bindingKeys = RESOURCE_BINDING_ROLES.map((role) => role.key),
  onBindingChange,
}: ResourceDetailPanelProps): React.ReactElement {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsError, setDetailsError] = useState(false)
  const [retry, setRetry] = useState(0)

  const validation = useMemo(
    () => validateResourceBindings(bindings, catalogue),
    [bindings, catalogue],
  )
  const missing = useMemo(
    () => Object.entries(validation).filter(([, value]) => value.missing),
    [validation],
  )
  const roles = RESOURCE_BINDING_ROLES.filter((role) => bindingKeys.includes(role.key))

  useEffect(() => {
    let active = true
    setDetails(null)
    setDetailsError(false)
    if (!resource || (resource.kind !== 'theme' && resource.previewKind !== 'details')) {
      setDetailsLoading(false)
      return () => {
        active = false
      }
    }

    setDetailsLoading(true)
    window.api.propresenter
      .getResourceDetails(resource.kind, resource.id)
      .then((next) => {
        if (active) setDetails(next)
      })
      .catch(() => {
        if (active) setDetailsError(true)
      })
      .finally(() => {
        if (active) setDetailsLoading(false)
      })

    return () => {
      active = false
    }
  }, [resource?.id, resource?.kind, retry])

  if (!resource) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-surface-border/70 bg-surface-secondary px-6 text-center">
        <Link2 size={20} className="text-slate-600" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-slate-400">Select a resource</p>
        <p className="mt-1 max-w-[26ch] text-xs leading-relaxed text-slate-600">
          Choose an existing ProPresenter resource to inspect it or bind it to a Kairo role.
        </p>
        {missing.length > 0 && (
          <p className="mt-4 text-[11px] text-yellow-500">Unavailable in ProPresenter: {missing.length} saved binding{missing.length === 1 ? '' : 's'}.</p>
        )}
      </div>
    )
  }

  const children = resource.kind === 'theme' ? childrenFromDetails(details) : []

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-surface-border/60 bg-surface-secondary p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">{resource.kind}</p>
            <h3 className="mt-1 truncate text-base font-semibold text-white">{resource.name}</h3>
            <p className="mt-1 break-all font-mono text-[10px] text-slate-600">{resource.id}</p>
          </div>
          <span className="rounded-full border border-surface-border/60 px-2 py-1 text-[10px] text-slate-500">
            {resource.previewKind}
          </span>
        </div>

        <div className="mt-4">
          <ResourceThumbnail resource={resource} selected visible showRetry />
        </div>

        {resource.subtitle && <p className="mt-3 text-xs leading-relaxed text-slate-500">{resource.subtitle}</p>}
        {resource.collectionName && <p className="mt-1 text-[11px] text-slate-600">Collection · {resource.collectionName}</p>}
      </div>

      {resource.kind === 'theme' && (
        <div className="rounded-xl border border-surface-border/60 bg-surface-secondary p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-slate-300">Theme slides</h4>
              <p className="mt-1 text-[11px] text-slate-600">Slide thumbnails load only as they become visible.</p>
            </div>
            {detailsLoading && <Loader size={13} className="animate-spin text-slate-600" aria-label="Loading theme slides" />}
          </div>
          {detailsError && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-rose-500/20 bg-tint-rose px-3 py-2">
              <span className="text-[11px] text-rose-300">Theme slides could not be loaded.</span>
              <button type="button" className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-white" onClick={() => setRetry((value) => value + 1)}>
                <RefreshCw size={10} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {!detailsLoading && !detailsError && children.length === 0 && (
            <p className="mt-3 text-[11px] text-slate-600">No slide thumbnails were returned for this theme.</p>
          )}
          {children.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {children.map((child, index) => (
                <div key={child.id} className="space-y-1">
                  <ResourceThumbnail
                    resource={resource}
                    childId={child.id}
                    selected={index < 4}
                    visible={index < 4}
                  />
                  <p className="truncate text-[10px] text-slate-600">{child.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-surface-border/60 bg-surface-secondary p-4">
        <div className="flex items-center gap-2">
          <Link2 size={14} className="text-slate-500" aria-hidden="true" />
          <h4 className="text-xs font-semibold text-slate-300">Use this resource as</h4>
        </div>
        <div className="mt-3 space-y-2">
          {roles.map((role) => {
            const savedId = bindings[role.key]
            const compatible = role.kind === resource.kind
            const bound = savedId === resource.id
            return (
              <div key={role.key} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', compatible ? 'border-surface-border/60 bg-surface-secondary' : 'border-transparent opacity-45')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium text-slate-300">{role.label}</p>
                  {compatible && savedId && !bound && <p className="truncate text-[10px] text-yellow-500">Another resource is currently bound</p>}
                  {!compatible && <p className="text-[10px] text-slate-600">Not compatible with {resource.kind}</p>}
                </div>
                {compatible && (
                  bound ? (
                    <button type="button" className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-teal-400 hover:text-white" onClick={() => void onBindingChange(role.key, '')}>
                      <Check size={12} aria-hidden="true" /> Bound · Clear
                    </button>
                  ) : (
                    <button type="button" className="btn-secondary px-2.5 py-1 text-[10px]" onClick={() => void onBindingChange(role.key, resource.id)}>
                      Bind
                    </button>
                  )
                )}
              </div>
            )
          })}
        </div>
      </div>

      {missing.length > 0 && (
        <div className="rounded-xl border border-yellow-500/20 bg-tint-yellow p-4">
          <div className="flex items-start gap-2.5">
            <CircleOff size={14} className="mt-0.5 shrink-0 text-yellow-500" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold text-yellow-300">Unavailable in ProPresenter</p>
              <p className="mt-1 text-[11px] leading-relaxed text-yellow-500/80">
                A saved binding no longer exists. It was kept so you can choose a replacement manually; nothing was replaced automatically.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            {missing.map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-3 text-[10px] text-yellow-500/70">
                <span>{RESOURCE_BINDING_ROLES.find((role) => role.key.replace(/Id$/, '') === key)?.label ?? key}</span>
                <span className="max-w-[12rem] truncate font-mono">{value.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {resource.kind === 'theme' && details && (
        <div className="rounded-xl border border-surface-border/60 bg-surface-secondary p-3 text-[10px] text-slate-600">
          <span className="font-semibold text-slate-500">Safe details loaded:</span> {Object.keys(details).join(', ') || 'none'}
        </div>
      )}
      <button type="button" className="inline-flex items-center gap-1.5 text-[10px] text-slate-600 hover:text-slate-300" onClick={() => setDetails(null)}>
        <X size={11} aria-hidden="true" /> Close details
      </button>
    </div>
  )
}
