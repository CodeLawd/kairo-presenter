import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader, RefreshCw, Search, WifiOff } from '@/icons'
import type {
  PPResourceBindings,
  PPResourceCatalogue as PPResourceCatalogueData,
  PPResourceKind,
  PPResourceSummary,
} from '@shared/propresenter-resources'
import {
  EMPTY_PP_RESOURCE_BINDINGS,
  normalizeResourceBindings,
} from '@shared/propresenter-resources'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { useAppStore } from '@/stores/useAppStore'
import ResourceDetailPanel, {
  ESSENTIAL_RESOURCE_BINDING_ROLES,
  RESOURCE_BINDING_ROLES,
  type ResourceBindingKey,
} from './ResourceDetailPanel'
import ResourceThumbnail from './ResourceThumbnail'

export type ResourceCatalogueMode = 'settings' | 'onboarding'

const KIND_LABELS: ReadonlyArray<{ kind: PPResourceKind; label: string }> = [
  { kind: 'theme', label: 'Themes' },
  { kind: 'macro', label: 'Macros' },
  { kind: 'look', label: 'Looks' },
  { kind: 'message', label: 'Messages' },
  { kind: 'prop', label: 'Props' },
  { kind: 'media', label: 'Media' },
  { kind: 'mask', label: 'Masks' },
  { kind: 'stageLayout', label: 'Stage layouts' },
  { kind: 'videoInput', label: 'Video inputs' },
  { kind: 'clearGroup', label: 'Clear groups' },
  { kind: 'library', label: 'Libraries' },
  { kind: 'playlist', label: 'Playlists' },
]

const EMPTY_CATALOGUE: PPResourceCatalogueData = {
  refreshedAt: 0,
  resources: [],
  warnings: [],
}

function resourceMatches(resource: PPResourceSummary, query: string, kind: PPResourceKind | 'all'): boolean {
  if (kind !== 'all' && resource.kind !== kind) return false
  if (!query.trim()) return true
  const needle = query.trim().toLocaleLowerCase()
  return [resource.name, resource.subtitle, resource.collectionName, resource.id]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(needle))
}

function catalogueCounts(resources: PPResourceSummary[]): string {
  const counts = KIND_LABELS
    .map(({ kind, label }) => {
      const count = resources.filter((resource) => resource.kind === kind).length
      return count > 0 ? `${count} ${label.toLocaleLowerCase()}` : null
    })
    .filter((value): value is string => value !== null)
  return counts.join(' · ')
}

function MissingBindingsSummary({
  catalogue,
  bindings,
  visible,
}: {
  catalogue: PPResourceCatalogueData
  bindings: PPResourceBindings
  visible: boolean
}): React.ReactElement | null {
  if (!visible) return null
  const missing = RESOURCE_BINDING_ROLES.filter((role) => {
    const id = bindings[role.key]
    return Boolean(id) && !catalogue.resources.some((resource) => resource.kind === role.kind && resource.id === id)
  })
  if (missing.length === 0) return null
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3.5 py-3">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-500" aria-hidden="true" />
      <p className="text-[11px] leading-relaxed text-yellow-300">
        <span className="font-semibold">Unavailable in ProPresenter:</span> {missing.length} saved binding{missing.length === 1 ? '' : 's'} no longer appear in the catalogue. They are kept until you clear or replace them.
      </p>
    </div>
  )
}

function SavedBindings({ bindings }: { bindings: PPResourceBindings }): React.ReactElement | null {
  const saved = RESOURCE_BINDING_ROLES.filter((role) => Boolean(bindings[role.key]))
  if (saved.length === 0) return null
  return (
    <div className="rounded-xl border border-surface-border/60 bg-surface-secondary/20 px-3.5 py-3" aria-label="Saved ProPresenter bindings">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600">Saved bindings</p>
      <div className="mt-2 space-y-1.5">
        {saved.map((role) => (
          <div key={role.key} className="flex items-center justify-between gap-3 text-[11px]">
            <span className="text-slate-400">{role.label}</span>
            <span className="max-w-[15rem] truncate font-mono text-[10px] text-slate-600">{bindings[role.key]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ResourceCatalogue({ mode }: { mode: ResourceCatalogueMode }): React.ReactElement {
  const connected = useAppStore((state) => state.ppState === 'connected')
  const storedBindings = useBootstrapStore((state) => state.settings.propresenterResources)
  const patchSettings = useBootstrapStore((state) => state.patchSettings)
  const bindings = normalizeResourceBindings(storedBindings ?? EMPTY_PP_RESOURCE_BINDINGS)
  const [catalogue, setCatalogue] = useState<PPResourceCatalogueData>(EMPTY_CATALOGUE)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<PPResourceKind | 'all'>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<ResourceBindingKey | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadCatalogue = useCallback(async (refresh = false): Promise<void> => {
    if (!connected) {
      setCatalogue(EMPTY_CATALOGUE)
      setLoadError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const next = await window.api.propresenter.getResourceCatalogue({ refresh })
      setCatalogue(next ?? EMPTY_CATALOGUE)
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'The catalogue could not be read.')
      setCatalogue(EMPTY_CATALOGUE)
    } finally {
      setLoading(false)
    }
  }, [connected])

  useEffect(() => {
    void loadCatalogue()
  }, [loadCatalogue])

  const filteredResources = useMemo(
    () => catalogue.resources.filter((resource) => resourceMatches(resource, query, kind)),
    [catalogue.resources, kind, query],
  )
  const selected = useMemo(
    () => catalogue.resources.find((resource) => `${resource.kind}:${resource.id}` === selectedKey) ?? null,
    [catalogue.resources, selectedKey],
  )
  const bindingKeys = mode === 'onboarding'
    ? ESSENTIAL_RESOURCE_BINDING_ROLES
    : RESOURCE_BINDING_ROLES.map((role) => role.key)

  const setBinding = useCallback(async (key: ResourceBindingKey, id: string): Promise<void> => {
    setSavingKey(key)
    setSaveError(null)
    try {
      const next = { ...bindings, [key]: id }
      const confirmed = normalizeResourceBindings(await window.api.propresenter.setResourceBindings(next))
      // The renderer snapshot follows the main-process result, never the
      // optimistic button click. This keeps settings durable and consistent.
      patchSettings('propresenterResources', confirmed)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The binding could not be saved.')
    } finally {
      setSavingKey(null)
    }
  }, [bindings, patchSettings])

  return (
    <section className="space-y-4" aria-labelledby={`${mode}-resource-catalogue-title`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2
            id={`${mode}-resource-catalogue-title`}
            className={
              mode === 'settings'
                ? 'text-[11px] font-semibold tracking-tight text-white/45'
                : 'text-sm font-semibold text-white'
            }
          >
            {mode === 'settings' ? 'Resources' : 'Choose existing ProPresenter resources'}
          </h2>
          {mode === 'onboarding' ? (
            <p className="mt-1 max-w-[58ch] text-xs leading-relaxed text-slate-500">
              Browse what ProPresenter already owns and optionally connect it to a Kairo role. Nothing in ProPresenter was changed.
            </p>
          ) : (
            <p className="mt-1 text-[11px] leading-snug text-white/40">
              Bind existing ProPresenter items to Kairo roles. Nothing in ProPresenter is changed.
            </p>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px]"
          onClick={() => void loadCatalogue(true)}
          disabled={loading || !connected}
          aria-label="Refresh ProPresenter resources"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
          Refresh
        </button>
      </div>

      {!connected && (
        <div className="flex items-start gap-2.5 rounded-xl border border-surface-border/60 bg-surface-secondary/25 px-3.5 py-3">
          <WifiOff size={14} className="mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-slate-500">
            Connect ProPresenter to browse its resources. Saved bindings are still shown below and will not be erased while it is offline.
          </p>
        </div>
      )}

      {!connected && <SavedBindings bindings={bindings} />}

      <MissingBindingsSummary
        catalogue={catalogue}
        bindings={bindings}
        visible={connected && catalogue.refreshedAt > 0}
      />

      {catalogue.warnings.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3.5 py-3">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-500" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-yellow-300">
            {catalogue.warnings.length} resource type{catalogue.warnings.length === 1 ? '' : 's'} could not be read. The rest of the catalogue is still available.
          </p>
        </div>
      )}

      {connected && !loadError && catalogue.resources.length > 0 && (
        <p className="text-[10px] text-slate-600">{catalogueCounts(catalogue.resources)}</p>
      )}

      {loadError ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-5">
          <p className="text-sm font-semibold text-rose-300">Could not load ProPresenter resources</p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">{loadError}</p>
          <button type="button" className="btn-secondary mt-3 inline-flex items-center gap-1.5 px-3 py-2 text-xs" onClick={() => void loadCatalogue(true)}>
            <RefreshCw size={12} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : loading && catalogue.resources.length === 0 ? (
        <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed border-surface-border/70 text-xs text-slate-500">
          <Loader size={14} className="mr-2 animate-spin" aria-hidden="true" /> Loading ProPresenter resources…
        </div>
      ) : connected && catalogue.resources.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-border/70 px-4 py-6 text-center">
          <p className="text-sm font-semibold text-slate-400">No ProPresenter resources found</p>
          <p className="mt-1 text-xs text-slate-600">Try Refresh after opening a library or enabling the ProPresenter API.</p>
        </div>
      ) : !connected ? null : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-48 flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden="true" />
              <input
                className="input pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or collection"
                aria-label="Search ProPresenter resources"
              />
            </label>
            <div className="flex flex-wrap gap-1.5" aria-label="Filter ProPresenter resources by type">
              <button type="button" className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${kind === 'all' ? 'border-teal-500/50 bg-teal-500/10 text-teal-300' : 'border-surface-border/60 text-slate-500 hover:text-slate-300'}`} onClick={() => setKind('all')} aria-pressed={kind === 'all'}>All</button>
              {KIND_LABELS.filter(({ kind: value }) => catalogue.resources.some((resource) => resource.kind === value)).map(({ kind: value, label }) => (
                <button key={value} type="button" className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${kind === value ? 'border-teal-500/50 bg-teal-500/10 text-teal-300' : 'border-surface-border/60 text-slate-500 hover:text-slate-300'}`} onClick={() => setKind(value)} aria-pressed={kind === value}>{label}</button>
              ))}
            </div>
          </div>

          <div className={mode === 'settings' ? 'flex flex-col gap-3' : 'grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]'}>
            <div className="min-w-0 space-y-2" aria-label="ProPresenter resource results">
              {filteredResources.length === 0 ? (
                <div className="rounded-xl border border-dashed border-surface-border/70 px-4 py-6 text-center">
                  <p className="text-xs font-semibold text-slate-400">No matching resources</p>
                  <p className="mt-1 text-[11px] text-slate-600">Clear the search or choose another resource type.</p>
                </div>
              ) : filteredResources.map((resource, index) => {
                const resourceKey = `${resource.kind}:${resource.id}`
                const isSelected = selectedKey === resourceKey
                return (
                  <button
                    type="button"
                    key={resourceKey}
                    className={
                      mode === 'settings'
                        ? `flex w-full items-center gap-3 rounded-[10px] p-2 text-left transition-colors ${isSelected ? 'bg-[#454545] text-white' : 'bg-[#2c2c2c] hover:bg-[#353535]'}`
                        : `flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${isSelected ? 'border-teal-500/40 bg-teal-500/5' : 'border-surface-border/50 bg-surface-secondary/15 hover:border-surface-border hover:bg-surface-secondary/35'}`
                    }
                    onClick={() => setSelectedKey(resourceKey)}
                    aria-pressed={isSelected}
                    data-resource-id={resource.id}
                  >
                    <ResourceThumbnail resource={resource} selected={isSelected} visible={index < 8} showRetry={false} className="h-12 w-16 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-300">{resource.name}</span>
                      <span className="mt-1 block truncate text-[10px] uppercase tracking-[0.08em] text-slate-600">{resource.kind}{resource.collectionName ? ` · ${resource.collectionName}` : ''}</span>
                      {resource.subtitle && <span className="mt-1 block truncate text-[10px] text-slate-600">{resource.subtitle}</span>}
                    </span>
                    {savingKey && resource.id === bindings[savingKey] && <Loader size={12} className="animate-spin text-slate-600" aria-label="Saving resource binding" />}
                  </button>
                )
              })}
            </div>

            <ResourceDetailPanel
              resource={selected}
              catalogue={catalogue}
              bindings={bindings}
              bindingKeys={bindingKeys}
              onBindingChange={setBinding}
            />
          </div>
        </>
      )}

      {saveError && <p className="text-xs text-rose-400" role="alert">{saveError}</p>}
      {mode === 'onboarding' && (
        <p className="text-[11px] leading-relaxed text-slate-600">This step is optional. Continue without a binding if discovery is unavailable.</p>
      )}
    </section>
  )
}
