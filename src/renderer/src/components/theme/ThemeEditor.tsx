import { memo, useState, useEffect, useRef, useCallback, useDeferredValue, useMemo } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Check, Copy, Loader, MoreHorizontal, Plus, Trash2 } from '@/icons'
import { cn } from '@/lib/utils'
import {
  contentKindLabel,
  liveOverlayTheme,
  OVERLAY_CONTENT_KINDS,
  primaryRenderedOutput,
  themeForContentKind,
} from '@shared/overlay-outputs'
import { Slider as SliderPrimitive } from '@/components/ui/slider'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/stores/useAppStore'
import { overlayMediaUrl, renderOverlayHTML } from '@shared/overlay-template'
import { DEFAULT_OVERLAY_SETTINGS, DEFAULT_OVERLAY_THEME, normalizeOverlaySettings, normalizeOverlayTheme } from '@shared/overlay-defaults'
import type { AppSettings, CustomOverlayTheme, OverlayBox, OverlayContentKind, OverlayOutput, OverlayTextStyle, OverlayTheme } from '@shared/ipc'
import {
  assignThemeToOutput,
  createCustomTheme,
  detachThemeFromOutputs,
  nextUntitledThemeName,
  outputUsesTheme,
  syncThemeToOutputs,
  themesForKind,
  unassignThemeFromOutput,
  updateLibraryTheme,
} from '@shared/theme-library'
import { applyLayoutPreset, placeReferenceAgainstVerse, clampOverlayBox } from '@shared/overlay-boxes'
import { ScaledOverlayPreview } from '@/components/overlay/ScaledOverlayPreview'
import { OverlayCanvas, type OverlayLayerId } from './OverlayCanvas'
import { ThemeTypePanel } from './ThemeTypePanel'
import { ThemeLayoutPanel } from './ThemeLayoutPanel'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'

// ─── Sample content for the WYSIWYG preview ────────────────────────────────────

const SAMPLE_REFERENCE = 'John 3:16 (KJV)'
const SAMPLE_TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'
const SAMPLE_TEXT_LONG =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life. For God sent not his Son into the world to condemn the world; but that the world through him might be saved. He that believeth on him is not condemned: but he that believeth not is condemned already, because he hath not believed in the name of the only begotten Son of God.'

// Lyrics push a slide, not a passage — the reference line is the section label
// and the body is a couplet, so previewing one against the verse sample would
// flatter a theme that is actually far too small on stage.
const SAMPLE_LYRIC_REFERENCE = 'Amazing Grace — Verse 1'
const SAMPLE_LYRIC_TEXT = 'Amazing grace, how sweet the sound\nThat saved a wretch like me'
const SAMPLE_LYRIC_TEXT_LONG =
  'Amazing grace, how sweet the sound\nThat saved a wretch like me\nI once was lost, but now am found\nWas blind, but now I see'

interface SampleContent {
  reference: string
  short: string
  long: string
}

const SAMPLES: Record<OverlayContentKind, SampleContent> = {
  scripture: { reference: SAMPLE_REFERENCE, short: SAMPLE_TEXT, long: SAMPLE_TEXT_LONG },
  lyrics: {
    reference: SAMPLE_LYRIC_REFERENCE,
    short: SAMPLE_LYRIC_TEXT,
    long: SAMPLE_LYRIC_TEXT_LONG,
  },
}

// ─── Small reusable atoms (local to this page, mirrors Settings.tsx style) ────

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit = '',
  format,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  format?: (v: number) => string
}): React.ReactElement {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label className="label mb-0">{label}</label>
        <span className="text-[11px] tabular-nums text-slate-400">
          {format ? format(value) : value}
          {unit}
        </span>
      </div>
      <SliderPrimitive
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onChange(next[0])}
        aria-label={label}
        trackClassName="relative h-1 w-full grow overflow-hidden rounded-full bg-surface-elevated"
        rangeClassName="absolute h-full bg-slate-300"
        thumbClassName="block size-3.5 rounded-full bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
      />
    </div>
  )
}

function expandHex(value: string): string | null {
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return null
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.ReactElement {
  const swatch = expandHex(value) ?? '#000000'
  return (
    <div className="min-w-0 w-full">
      <label className="label">{label}</label>
      <div className="relative">
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="absolute left-2 top-1/2 z-10 h-6 w-6 -translate-y-1/2 cursor-pointer rounded-md bg-surface p-0.5"
          aria-label={`${label} color swatch`}
          title={expandHex(value) ? undefined : 'Swatch writes 6-digit hex — edit the text field for rgba()'}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          className="input h-9 w-full pl-11 font-mono text-xs"
          placeholder="#rrggbb or rgba(...)"
          aria-label={`${label} value`}
        />
      </div>
    </div>
  )
}

function LabeledSegmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.ReactElement {
  return (
    <div>
      <p className="label">{label}</p>
      <SegmentedControl
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        itemClassName={options.length > 4 ? 'px-0 text-[11px]' : undefined}
      />
    </div>
  )
}

// ─── Built-in themes ──────────────────────────────────────────────────────────

const BUILT_IN_THEMES: Array<{
  id: string
  name: string
  kind: OverlayContentKind
  theme: OverlayTheme
}> = [
  { id: 'broadcast', name: 'Broadcast', kind: 'scripture', theme: DEFAULT_OVERLAY_SETTINGS.theme },
  {
    id: 'warm-paper',
    name: 'Warm paper',
    kind: 'scripture',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'color', color: '#e8dfcf' },
        verse: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.verse,
          fontFamily: "Georgia, 'Times New Roman', serif",
          color: '#201d19',
          align: 'left',
          shadow: { ...DEFAULT_OVERLAY_SETTINGS.theme.verse.shadow, enabled: false },
        },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, color: '#8b4b32', position: 'above' },
        layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, backdropBox: false },
      },
      'center',
      72
    ),
  },
  {
    id: 'midnight',
    name: 'Midnight',
    kind: 'scripture',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'gradient', color: '#07111f', color2: '#18324b', angleDeg: 135 },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, color: '#f2a36f' },
        layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, backdropBox: false },
      },
      'center',
      76
    ),
  },

  // ── Lyrics ────────────────────────────────────────────────────────────────
  // Lyric slides are read at a glance from the back of a room, so these start
  // full-frame with a transparent background — the motion background belongs to
  // ProPresenter's media layer underneath, not baked into our frame.
  {
    id: 'lyrics-stage',
    name: 'Stage lyrics',
    kind: 'lyrics',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'transparent' },
        verse: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.verse,
          fontSizePx: 96,
          fontWeight: 700,
          align: 'center',
          verticalAlign: 'middle',
          lineHeight: 1.25,
        },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, show: false },
        layout: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.layout,
          backdropBox: false,
          autoFitText: true,
        },
      },
      'full',
      92
    ),
  },
  {
    id: 'lyrics-lower',
    name: 'Lyrics lower third',
    kind: 'lyrics',
    theme: applyLayoutPreset(
      {
        ...DEFAULT_OVERLAY_SETTINGS.theme,
        background: { ...DEFAULT_OVERLAY_SETTINGS.theme.background, type: 'transparent' },
        verse: {
          ...DEFAULT_OVERLAY_SETTINGS.theme.verse,
          fontSizePx: 64,
          fontWeight: 600,
          align: 'center',
          verticalAlign: 'bottom',
        },
        reference: { ...DEFAULT_OVERLAY_SETTINGS.theme.reference, show: false },
        layout: { ...DEFAULT_OVERLAY_SETTINGS.theme.layout, autoFitText: true },
      },
      'lower-third',
      84
    ),
  },
]

/** Built-in starters for one content kind. */
function builtInsForKind(kind: OverlayContentKind): typeof BUILT_IN_THEMES {
  return BUILT_IN_THEMES.filter((item) => item.kind === kind)
}

// ─── Main page ──────────────────────────────────────────────────────────────────
// Like ProPresenter: a theme is a library item, edits save as you make them,
// and every screen using the theme follows. Built-ins are templates for + New.

type InspectorTab = 'background' | 'type' | 'layout'

const SAVE_DELAY_MS = 400

export default function ThemeEditor(): React.ReactElement {
  const [overlay, setOverlay] = useState<AppSettings['overlay']>(DEFAULT_OVERLAY_SETTINGS)
  const [library, setLibrary] = useState<CustomOverlayTheme[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState<OverlayContentKind>('scripture')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<OverlayTheme>(DEFAULT_OVERLAY_THEME)
  const [name, setName] = useState('')
  const [tab, setTab] = useState<InspectorTab>('background')
  const [selectedLayer, setSelectedLayer] = useState<OverlayLayerId | null>('verse')
  const [sampleLength, setSampleLength] = useState<'short' | 'long'>('short')
  const [saved, setSaved] = useState(false)
  const setThemeViewState = useAppStore((s) => s.setThemeViewState)
  const [stageRef, frameWidth] = useFitFrame()

  // Latest values for the debounced save, which outlives the render that scheduled it.
  const overlayRef = useRef(overlay)
  const libraryRef = useRef(library)
  overlayRef.current = overlay
  libraryRef.current = library
  const lastByKind = useRef<Record<OverlayContentKind, string | null>>({ scripture: null, lyrics: null })
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ id: string; name: string; theme: OverlayTheme } | null>(null)

  // ─── Load ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const boot = useBootstrapStore.getState().settings
      let storedOverlay = normalizeOverlaySettings(boot.overlay)
      let storedLibrary: CustomOverlayTheme[] = Array.isArray(boot.themeLibrary) ? boot.themeLibrary : []
      try {
        const [diskLibrary, diskOverlay] = await Promise.all([
          window.api.settings.get('themeLibrary'),
          window.api.settings.get('overlay'),
        ])
        if (Array.isArray(diskLibrary)) storedLibrary = diskLibrary
        if (diskOverlay) storedOverlay = normalizeOverlaySettings(diskOverlay)
      } catch {
        // The bootstrap snapshot is enough if IPC fails mid-session.
      }
      if (cancelled) return
      setOverlay(storedOverlay)
      setLibrary(storedLibrary)

      const remembered = storedLibrary.find((item) => item.id === useAppStore.getState().themeSelectedId)
      const primary = primaryRenderedOutput(storedOverlay.outputs)
      const live = primary ? storedLibrary.find((item) => item.id === primary.themeId) : undefined
      const first = remembered ?? live ?? themesForKind(storedLibrary, 'scripture')[0] ?? storedLibrary[0]
      if (first) open(first)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ─── Persistence ────────────────────────────────────────────────────────────

  const flashSaved = useCallback(() => {
    if (savedTimer.current) clearTimeout(savedTimer.current)
    setSaved(true)
    savedTimer.current = setTimeout(() => setSaved(false), 1200)
  }, [])

  const writeLibrary = useCallback((next: CustomOverlayTheme[]) => {
    libraryRef.current = next
    setLibrary(next)
    useBootstrapStore.getState().patchSettings('themeLibrary', next)
    void window.api.settings.set('themeLibrary', next).then(flashSaved)
  }, [flashSaved])

  // Only the fields this page owns; main merges them onto the stored overlay.
  const writeOutputs = useCallback((outputs: OverlayOutput[]) => {
    const current = overlayRef.current
    const next = { ...current, outputs, theme: liveOverlayTheme({ ...current, outputs }, 'scripture') }
    overlayRef.current = next
    setOverlay(next)
    const store = useBootstrapStore.getState()
    store.patchSettings('overlay', { ...store.settings.overlay, ...next })
    void window.api.settings.set('overlay', { outputs: next.outputs, theme: next.theme })
  }, [])

  /** Writes the pending edit to the library and to every screen using the theme. */
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    const edit = pending.current
    pending.current = null
    if (!edit) return
    const nextLibrary = updateLibraryTheme(libraryRef.current, edit.id, {
      name: edit.name.trim() || 'Untitled theme',
      theme: edit.theme,
    })
    writeLibrary(nextLibrary)
    const entry = nextLibrary.find((item) => item.id === edit.id)
    if (!entry) return
    const outputs = overlayRef.current.outputs
    if (outputs.some((o) => outputUsesTheme(o, entry))) writeOutputs(syncThemeToOutputs(outputs, entry))
  }, [writeLibrary, writeOutputs])

  useEffect(() => () => flush(), [flush])

  const scheduleSave = (id: string, nextName: string, theme: OverlayTheme): void => {
    pending.current = { id, name: nextName, theme }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS)
  }

  // ─── Editing ────────────────────────────────────────────────────────────────

  function open(item: CustomOverlayTheme): void {
    lastByKind.current[item.kind] = item.id
    setKind(item.kind)
    setSelectedId(item.id)
    setName(item.name)
    setDraft(themeForContentKind(structuredClone(normalizeOverlayTheme(item.theme)), item.kind))
    setThemeViewState({ selectedId: item.id, selectedName: item.name })
    if (item.kind === 'lyrics') setTab((t) => (t === 'background' ? 'type' : t))
  }

  const select = (item: CustomOverlayTheme): void => {
    flush()
    open(item)
  }

  const editTheme = (next: OverlayTheme | ((current: OverlayTheme) => OverlayTheme)): void => {
    if (!selectedId) return
    setDraft((current) => {
      const theme = typeof next === 'function' ? next(current) : next
      scheduleSave(selectedId, name, theme)
      return theme
    })
  }

  const updateTheme = <K extends keyof OverlayTheme>(section: K, partial: Partial<OverlayTheme[K]>): void =>
    editTheme((current) => ({ ...current, [section]: { ...current[section], ...partial } }))

  const updateBox = (id: OverlayLayerId, box: OverlayBox): void => updateTheme(id, { box: clampOverlayBox(box) })

  const hideLayer = (id: OverlayLayerId): void => {
    if (id !== 'reference') return
    editTheme((current) => ({ ...current, reference: { ...current.reference, show: false } }))
    setSelectedLayer('verse')
  }

  const rename = (nextName: string): void => {
    setName(nextName)
    if (selectedId) {
      scheduleSave(selectedId, nextName, draft)
      setThemeViewState({ selectedName: nextName })
    }
  }

  const pickMedia = async (type: 'image' | 'video'): Promise<void> => {
    const picked = await window.api.ndi.pickOverlayMedia(type)
    if (picked) updateTheme('background', { mediaPath: picked })
  }

  // ─── Library actions ────────────────────────────────────────────────────────

  const create = (base: OverlayTheme, baseName: string): void => {
    flush()
    const item = createCustomTheme(
      baseName,
      themeForContentKind(structuredClone(normalizeOverlayTheme(base)), kind),
      kind,
    )
    writeLibrary([...libraryRef.current, item])
    open(item)
  }

  const duplicate = (item: CustomOverlayTheme): void => {
    flush()
    const source = libraryRef.current.find((t) => t.id === item.id) ?? item
    const copy = createCustomTheme(`${source.name} copy`, source.theme, source.kind)
    writeLibrary([...libraryRef.current, copy])
    open(copy)
  }

  const remove = (item: CustomOverlayTheme): void => {
    const users = overlayRef.current.outputs.filter((o) => outputUsesTheme(o, item))
    const note = users.length > 0 ? ` ${users.map((o) => o.name).join(', ')} will keep its current look.` : ''
    if (!window.confirm(`Delete “${item.name}”?${note}`)) return
    flush()
    const next = libraryRef.current.filter((t) => t.id !== item.id)
    writeLibrary(next)
    if (users.length > 0) writeOutputs(detachThemeFromOutputs(overlayRef.current.outputs, item))
    if (selectedId === item.id) {
      const fallback = themesForKind(next, kind)[0]
      if (fallback) open(fallback)
      else setSelectedId(null)
    }
  }

  const switchKind = (next: OverlayContentKind): void => {
    if (next === kind) return
    flush()
    const items = themesForKind(libraryRef.current, next)
    const target = items.find((t) => t.id === lastByKind.current[next]) ?? items[0]
    setKind(next)
    if (target) open(target)
    else setSelectedId(null)
  }

  const toggleOutput = (output: OverlayOutput): void => {
    flush()
    const entry = libraryRef.current.find((t) => t.id === selectedId)
    if (!entry) return
    const outputs = overlayRef.current.outputs.map((o) => {
      if (o.id !== output.id) return o
      return outputUsesTheme(o, entry) ? unassignThemeFromOutput(o, entry) : assignThemeToOutput(o, entry)
    })
    writeOutputs(outputs)
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const previewTheme = useDeferredValue(draft)
  const sample = SAMPLES[kind]
  const previewHtml = useMemo(
    () => renderOverlayHTML(previewTheme, sample.reference, sampleLength === 'long' ? sample.long : sample.short),
    [previewTheme, sample, sampleLength],
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-slate-500">
        <Loader size={16} className="animate-spin" />
        <span className="text-sm">Loading themes…</span>
      </div>
    )
  }

  const themes = themesForKind(library, kind)
  const selected = themes.find((t) => t.id === selectedId) ?? null
  const screens = overlay.outputs.filter((o) => o.kind === 'screen' || o.kind === 'ndi')
  const tabs: InspectorTab[] = kind === 'lyrics' ? ['type', 'layout'] : ['background', 'type', 'layout']
  const activeTab = tabs.includes(tab) ? tab : tabs[0]
  const templates = builtInsForKind(kind)

  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)_320px] overflow-hidden bg-surface">
      {/* Library */}
      <aside className="flex min-h-0 flex-col bg-surface-secondary">
        <div className="space-y-3 p-3">
          <SegmentedControl
            role="tablist"
            label="Theme kind"
            value={kind}
            options={OVERLAY_CONTENT_KINDS.map((k) => ({ value: k, label: contentKindLabel(k) }))}
            onChange={switchKind}
          />

          <NewThemeMenu templates={templates} blankName={nextUntitledThemeName(library, kind)} onCreate={create} />
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {themes.map((item) => (
            <ThemeTile
              key={item.id}
              name={item.id === selectedId ? name || 'Untitled theme' : item.name}
              theme={item.id === selectedId ? previewTheme : item.theme}
              kind={kind}
              selected={item.id === selectedId}
              onClick={() => select(item)}
              onDuplicate={() => duplicate(item)}
              onDelete={() => remove(item)}
            />
          ))}
        </div>
      </aside>

      {/* Preview */}
      <main className="flex min-h-0 min-w-0 flex-col">
        {selected ? (
          <>
            <div className="flex h-14 shrink-0 items-center gap-3 px-6">
              <input
                className="min-w-0 flex-1 bg-transparent text-[17px] font-semibold text-white outline-none placeholder:text-slate-500"
                value={name}
                placeholder="Untitled theme"
                aria-label="Theme name"
                onChange={(e) => rename(e.target.value)}
                onBlur={flush}
              />
              <span className={cn('text-[11px] text-slate-400 transition-opacity', saved ? 'opacity-100' : 'opacity-0')}>Saved</span>
              <SegmentedControl
                label="Sample text"
                value={sampleLength}
                options={[
                  { value: 'short', label: 'Short' },
                  { value: 'long', label: 'Long' },
                ]}
                onChange={setSampleLength}
                className="bg-surface-secondary"
                itemClassName="px-2.5 py-0.5 text-[11px]"
              />

            </div>

            <div
              ref={stageRef}
              className="min-h-0 flex-1 overflow-y-auto px-6"
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) setSelectedLayer(null)
              }}
            >
              <div className="relative isolate overflow-hidden rounded-lg" style={{ width: frameWidth || undefined }}>
                <ScaledOverlayPreview html={previewHtml} autoFit={draft.layout.autoFitText} motion />
                <OverlayCanvas
                  theme={draft}
                  contentKind={kind}
                  selected={selectedLayer}
                  onSelect={setSelectedLayer}
                  onBoxChange={updateBox}
                  onDeleteLayer={hideLayer}
                  onEditLayer={(id) => {
                    setSelectedLayer(id)
                    setTab('type')
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5 py-4">
                <span className="mr-1 text-[12px] text-slate-400">Used on</span>
                {screens.length === 0 && <span className="text-[12px] text-slate-500">no screens yet — add one in Screens</span>}
                {screens.map((output) => {
                  const on = outputUsesTheme(output, selected)
                  // Scripture always needs a theme: pick another theme to move a screen off this one.
                  const locked = on && kind === 'scripture'
                  return (
                    <button
                      key={output.id}
                      type="button"
                      aria-pressed={on}
                      disabled={locked}
                      title={
                        locked
                          ? 'Choose another theme to move this screen off it'
                          : kind === 'lyrics' && !on
                            ? 'Use this theme for lyrics on this screen'
                            : undefined
                      }
                      onClick={() => toggleOutput(output)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition-colors',
                        on ? 'bg-slate-200 text-surface' : 'bg-surface-secondary text-slate-300 hover:bg-surface-tertiary hover:text-white',
                        locked && 'cursor-default',
                      )}
                    >
                      {on && <Check size={12} aria-hidden="true" />}
                      {output.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="m-auto max-w-sm space-y-4 p-8 text-center">
            <p className="text-[15px] font-semibold text-white">No {contentKindLabel(kind).toLowerCase()} themes yet</p>
            <p className="text-[12px] text-slate-500">Start from a template.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button type="button" className="btn-secondary text-[12px]" onClick={() => create(DEFAULT_OVERLAY_THEME, nextUntitledThemeName(library, kind))}>
                Blank
              </button>
              {templates.map((t) => (
                <button key={t.id} type="button" className="btn-secondary text-[12px]" onClick={() => create(t.theme, t.name)}>
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Inspector */}
      <aside className="min-h-0 overflow-y-auto bg-surface-secondary">
        {selected && (
          <div className="space-y-4 p-4">
            <SegmentedControl
              role="tablist"
              label="Theme settings"
              value={activeTab}
              options={tabs.map((t) => ({ value: t, label: t === 'background' ? 'Background' : t === 'type' ? 'Text' : 'Layout' }))}
              onChange={setTab}
            />


            {activeTab === 'background' && (
              <BackgroundFields theme={draft} onChange={(partial) => updateTheme('background', partial)} onPickMedia={pickMedia} />
            )}

            {activeTab === 'type' && (
              <ThemeTypePanel
                theme={draft}
                contentKind={kind}
                selectedLayer={selectedLayer === 'reference' ? 'reference' : 'verse'}
                onSelectLayer={setSelectedLayer}
                onUpdateLayer={(id, partial) => updateTheme(id, partial as Partial<OverlayTextStyle>)}
                onUpdateReferenceMeta={(partial) => {
                  if (partial.position) {
                    editTheme((current) => ({
                      ...current,
                      reference: {
                        ...current.reference,
                        ...partial,
                        box: placeReferenceAgainstVerse(current.verse.box, current.reference.box, partial.position ?? current.reference.position),
                      },
                    }))
                    return
                  }
                  updateTheme('reference', partial)
                }}
                onAutoFitChange={(autoFitText) => updateTheme('layout', { autoFitText })}
              />
            )}

            {activeTab === 'layout' && (
              <ThemeLayoutPanel
                theme={draft}
                contentKind={kind}
                selectedLayer={selectedLayer === 'reference' ? 'reference' : 'verse'}
                onSelectLayer={setSelectedLayer}
                onApplyPreset={(position) => {
                  editTheme((current) => applyLayoutPreset(current, position))
                  setSelectedLayer('verse')
                }}
                onUpdateLayout={(partial) => updateTheme('layout', partial)}
                onUpdateBox={updateBox}
                onUpdatePresetWidth={(maxWidthPct) => editTheme((current) => applyLayoutPreset(current, current.layout.position, maxWidthPct))}
              />
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

/**
 * The widest 16:9 frame that fits the stage both ways, so the canvas fills
 * whatever room the window gives it instead of only following its width.
 */
const USED_ON_ROOM = 64

function useFitFrame(): [React.RefCallback<HTMLDivElement>, number] {
  const [width, setWidth] = useState(0)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return
    const measure = (): void => {
      const style = getComputedStyle(node)
      const w = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const h = node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      // Leave room under the frame for the "Used on" row.
      setWidth(Math.max(0, Math.floor(Math.min(w, ((h - USED_ON_ROOM) * 16) / 9))))
    }
    observer.current = new ResizeObserver(measure)
    observer.current.observe(node)
    measure()
  }, [])
  return [ref, width]
}

function NewThemeMenu({
  templates,
  blankName,
  onCreate,
}: {
  templates: typeof BUILT_IN_THEMES
  blankName: string
  onCreate: (theme: OverlayTheme, name: string) => void
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="btn-secondary flex w-full items-center justify-center gap-1.5 text-[12px]">
          <Plus size={13} aria-hidden="true" /> New theme
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onSelect={() => onCreate(DEFAULT_OVERLAY_THEME, blankName)}>Blank</DropdownMenuItem>
        {templates.length > 0 && <DropdownMenuSeparator />}
        {templates.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => onCreate(t.theme, t.name)}>
            {t.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function BackgroundFields({
  theme,
  onChange,
  onPickMedia,
}: {
  theme: OverlayTheme
  onChange: (partial: Partial<OverlayTheme['background']>) => void
  onPickMedia: (type: 'image' | 'video') => Promise<void>
}): React.ReactElement {
  const bg = theme.background
  return (
    <div className="space-y-4">
      <LabeledSegmented
        label="Type"
        value={bg.type}
        options={[
          { value: 'transparent', label: 'None' },
          { value: 'color', label: 'Color' },
          { value: 'gradient', label: 'Gradient' },
          { value: 'image', label: 'Image' },
          { value: 'video', label: 'Video' },
        ]}
        onChange={(type) => onChange({ type })}
      />

      {(bg.type === 'color' || bg.type === 'gradient') && (
        <div className={cn('grid gap-4', bg.type === 'gradient' ? 'grid-cols-2' : 'grid-cols-1')}>
          <ColorField label={bg.type === 'gradient' ? 'From' : 'Color'} value={bg.color} onChange={(color) => onChange({ color })} />
          {bg.type === 'gradient' && (
            <ColorField label="To" value={bg.color2 ?? bg.color} onChange={(color2) => onChange({ color2 })} />
          )}
        </div>
      )}
      {bg.type === 'gradient' && (
        <Slider label="Angle" value={bg.angleDeg ?? 0} onChange={(angleDeg) => onChange({ angleDeg })} min={0} max={360} unit="°" />
      )}

      {(bg.type === 'image' || bg.type === 'video') && (
        <>
          <MediaPicker type={bg.type} path={bg.mediaPath ?? ''} onPick={() => void onPickMedia(bg.type as 'image' | 'video')} />
          <LabeledSegmented
            label="Fit"
            value={bg.mediaFit ?? 'cover'}
            options={[
              { value: 'cover', label: 'Fill' },
              { value: 'contain', label: 'Fit' },
              { value: 'fill', label: 'Stretch' },
            ]}
            onChange={(mediaFit) => onChange({ mediaFit })}
          />
        </>
      )}

      {bg.type !== 'transparent' && (
        <Slider label="Opacity" value={bg.opacity} onChange={(opacity) => onChange({ opacity })} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} />
      )}
    </div>
  )
}

/** The chosen image or video as a thumbnail, with its name and a way to change it. */
function MediaPicker({ type, path, onPick }: { type: 'image' | 'video'; path: string; onPick: () => void }): React.ReactElement {
  const url = path ? overlayMediaUrl(path) : ''
  return (
    <div>
      <p className="label">{type === 'video' ? 'Video' : 'Image'}</p>
      <button
        type="button"
        onClick={onPick}
        className="group flex w-full items-center gap-3 rounded-lg bg-surface p-1.5 text-left transition-colors hover:bg-surface-tertiary"
      >
        <span className="grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-md bg-black">
          {url && type === 'video' && <video src={`${url}#t=0.1`} muted preload="metadata" className="h-full w-full object-cover" />}
          {url && type === 'image' && <img src={url} alt="" className="h-full w-full object-cover" />}
          {!url && <Plus size={14} className="text-slate-500" aria-hidden="true" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] text-slate-200" title={path || undefined}>
            {path ? path.split(/[\\/]/).pop() : `Choose ${type === 'video' ? 'a video' : 'an image'}`}
          </span>
          {path && <span className="block text-[11px] text-slate-500 group-hover:text-slate-400">Change…</span>}
        </span>
      </button>
    </div>
  )
}

/**
 * The tile's slide, memoised on its html: only the selected tile follows the
 * draft, so the rest never rebuild their 1920×1080 frame while editing.
 */
const TileSlide = memo(function TileSlide({ html, autoFit }: { html: string; autoFit: boolean }) {
  return <ScaledOverlayPreview html={html} autoFit={autoFit} />
})

function ThemeTile({
  name,
  theme,
  kind,
  selected,
  onClick,
  onDuplicate,
  onDelete,
}: {
  name: string
  theme: OverlayTheme
  kind: OverlayContentKind
  selected: boolean
  onClick: () => void
  onDuplicate: () => void
  onDelete: () => void
}): React.ReactElement {
  const previewTheme = useMemo(() => normalizeOverlayTheme(theme), [theme])
  const sample = SAMPLES[kind]
  const html = useMemo(
    () => renderOverlayHTML(previewTheme, sample.reference, sample.short),
    [previewTheme, sample.reference, sample.short],
  )
  return (
    <div className={cn('group relative rounded-lg p-1.5 transition-colors', selected ? 'bg-surface-elevated' : 'hover:bg-surface-tertiary')}>
      <button type="button" onClick={onClick} aria-pressed={selected} className="w-full text-left">
        <div className="overflow-hidden rounded-md">
          <TileSlide html={html} autoFit={previewTheme.layout.autoFitText} />
        </div>
        <span className={cn('block truncate px-0.5 pt-1.5 text-[12px]', selected ? 'text-white' : 'text-slate-400')}>{name}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${name} actions`}
            className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-md bg-black/70 text-slate-200 opacity-0 transition-opacity hover:bg-black group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal size={14} aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy size={13} /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 size={13} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
