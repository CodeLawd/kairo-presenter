import { memo, useState, useEffect, useRef, useCallback, useDeferredValue, useMemo } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { Check, Copy, Film, Image, Loader, MoreHorizontal, Plus, Redo, RotateCcw, Trash2, Undo } from '@/icons'
import { cn } from '@/lib/utils'
import {
  contentKindLabel,
  liveOverlayTheme,
  OVERLAY_CONTENT_KINDS,
  primaryRenderedOutput,
} from '@shared/overlay-outputs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/stores/useAppStore'
import { overlayMediaUrl, renderOverlayHTML } from '@shared/overlay-template'
import { DEFAULT_OVERLAY_SETTINGS, DEFAULT_OVERLAY_THEME, normalizeOverlaySettings, normalizeOverlayTheme } from '@shared/overlay-defaults'
import type { AppSettings, CustomOverlayTheme, OverlayBox, OverlayContentKind, OverlayElement, OverlayOutput, OverlayTextStyle, OverlayTheme } from '@shared/ipc'
import {
  assignThemeToOutput,
  createCustomTheme,
  detachThemeFromOutputs,
  nextUntitledThemeName,
  outputUsesTheme,
  setThemeBaseline,
  syncThemeToOutputs,
  themeBaseline,
  themesForKind,
  unassignThemeFromOutput,
  updateLibraryTheme,
  BUILT_IN_THEMES,
  builtInThemesForKind,
} from '@shared/theme-library'
import { applyLayoutPreset, placeReferenceAgainstVerse, clampOverlayBox, ELEMENT_BOX_MIN } from '@shared/overlay-boxes'
import {
  createOverlayElement,
  duplicateOverlayElement,
  MAX_OVERLAY_ELEMENTS,
  overlayElementLabel,
  removeOverlayElement,
  reorderOverlayElement,
  updateOverlayElement,
} from '@shared/overlay-elements'
import { ScaledOverlayPreview } from '@/components/overlay/ScaledOverlayPreview'
import { isTextLayer, OverlayCanvas, type CanvasLayerId } from './OverlayCanvas'
import { ThemeElementPanel, type ReorderTarget } from './ThemeElementPanel'
import { ShapeMenuItems, ShapeThumb, type ShapePick } from './ShapeGallery'
import { overlayShape } from '@shared/overlay-shapes'
import { ThemeTypePanel } from './ThemeTypePanel'
import { ThemeLayoutPanel } from './ThemeLayoutPanel'
import { useThemeHistory } from './useThemeHistory'
import { LabeledSegmented, MediaAdjustments, MediaPicker, Slider, pct } from './fields'
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
  const [selectedLayer, setSelectedLayer] = useState<CanvasLayerId | null>('verse')
  const [sampleLength, setSampleLength] = useState<'short' | 'long'>('short')
  const [saved, setSaved] = useState(false)
  const setThemeViewState = useAppStore((s) => s.setThemeViewState)
  const [stageRef, frameWidth] = useFitFrame()
  const history = useThemeHistory()

  // Latest values for the debounced save, which outlives the render that scheduled it.
  const overlayRef = useRef(overlay)
  const libraryRef = useRef(library)
  const themeDefaults = useBootstrapStore((s) => s.settings.themeDefaults) ?? {}
  overlayRef.current = overlay
  libraryRef.current = library
  // The draft edits build on — read before React re-renders, so back-to-back edits chain.
  const draftRef = useRef(draft)
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
    const theme = structuredClone(normalizeOverlayTheme(item.theme))
    draftRef.current = theme
    setDraft(theme)
    history.clear()
    setThemeViewState({ selectedId: item.id, selectedName: item.name })
  }

  const select = (item: CustomOverlayTheme): void => {
    flush()
    open(item)
  }

  /** Shows `theme` and saves it, without touching undo history. */
  const showTheme = (theme: OverlayTheme): void => {
    if (!selectedId) return
    draftRef.current = theme
    setDraft(theme)
    scheduleSave(selectedId, name, theme)
  }

  const editTheme = (next: OverlayTheme | ((current: OverlayTheme) => OverlayTheme)): void => {
    if (!selectedId) return
    const current = draftRef.current
    const theme = typeof next === 'function' ? next(current) : next
    if (theme === current) return
    history.record(current)
    showTheme(theme)
  }

  const undo = (): void => {
    const theme = history.undo(draftRef.current)
    if (theme) showTheme(theme)
  }

  const redo = (): void => {
    const theme = history.redo(draftRef.current)
    if (theme) showTheme(theme)
  }

  /** Back to the theme's default. An edit like any other, so Undo brings the changes back. */
  const resetToDefault = (): void => {
    const entry = libraryRef.current.find((t) => t.id === selectedId)
    if (entry) editTheme(structuredClone(normalizeOverlayTheme(themeBaseline(entry))))
  }

  const setAsDefault = (): void => {
    if (!selectedId) return
    flush()
    writeLibrary(setThemeBaseline(libraryRef.current, selectedId, draftRef.current))
  }

  // ⌘Z / ⇧⌘Z (and ⌘Y). Text fields keep their own undo.
  const undoRef = useRef(undo)
  const redoRef = useRef(redo)
  undoRef.current = undo
  redoRef.current = redo
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const el = event.target as HTMLElement | null
      const textEntry =
        !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text'))
      if (textEntry) return
      event.preventDefault()
      if (key === 'y' || event.shiftKey) redoRef.current()
      else undoRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const updateTheme = <K extends keyof OverlayTheme>(section: K, partial: Partial<OverlayTheme[K]>): void =>
    editTheme((current) => ({ ...current, [section]: { ...current[section], ...partial } }))

  const updateElement = (id: string, patch: Partial<Omit<OverlayElement, 'id' | 'kind'>>): void =>
    editTheme((current) => ({ ...current, elements: updateOverlayElement(current.elements, id, patch) }))

  const updateBox = (id: CanvasLayerId, box: OverlayBox): void => {
    if (isTextLayer(id)) updateTheme(id, { box: clampOverlayBox(box) })
    else updateElement(id, { box: clampOverlayBox(box, ELEMENT_BOX_MIN) })
  }

  /** The canvas's Delete: hides the reference, deletes an element. */
  const deleteLayer = (id: CanvasLayerId): void => {
    if (id === 'verse') return
    if (id === 'reference') {
      editTheme((current) => ({ ...current, reference: { ...current.reference, show: false } }))
      setSelectedLayer('verse')
      return
    }
    editTheme((current) => ({ ...current, elements: removeOverlayElement(current.elements, id) }))
    setSelectedLayer(null)
  }

  const addElement = async (pick: ShapePick | { kind: 'image' | 'video' }): Promise<void> => {
    if (draftRef.current.elements.length >= MAX_OVERLAY_ELEMENTS) return
    const { kind } = pick
    let element = createOverlayElement(kind, undefined, undefined, 'shape' in pick ? pick.shape : undefined)
    if ('radiusPx' in pick && pick.radiusPx) element = { ...element, radiusPx: pick.radiusPx }
    if (kind === 'image' || kind === 'video') {
      const picked = await window.api.ndi.pickOverlayMedia(kind)
      if (!picked) return
      element = { ...element, mediaPath: picked, box: await mediaBox(picked, kind) }
    }
    editTheme((current) => ({ ...current, elements: [...current.elements, element] }))
    setSelectedLayer(element.id)
  }

  const duplicateElement = (id: string): void => {
    const { elements, id: copyId } = duplicateOverlayElement(draftRef.current.elements, id)
    if (!copyId) return
    editTheme((current) => ({ ...current, elements }))
    setSelectedLayer(copyId)
  }

  const reorderElement = (id: string, to: ReorderTarget): void =>
    editTheme((current) => ({ ...current, elements: reorderOverlayElement(current.elements, id, to) }))

  const replaceElementMedia = async (element: OverlayElement): Promise<void> => {
    const picked = await window.api.ndi.pickOverlayMedia(element.kind as 'image' | 'video')
    if (picked) updateElement(element.id, { mediaPath: picked })
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
      structuredClone(normalizeOverlayTheme(base)),
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

  /**
   * This theme becomes the default for its kind: every screen and NDI feed
   * switches to it now, and screens added later start with it.
   */
  const makeDefault = (): void => {
    flush()
    const entry = libraryRef.current.find((t) => t.id === selectedId)
    if (!entry) return
    const next = { ...useBootstrapStore.getState().settings.themeDefaults, [entry.kind]: entry.id }
    useBootstrapStore.getState().patchSettings('themeDefaults', next)
    void window.api.settings.set('themeDefaults', next)
    writeOutputs(
      overlayRef.current.outputs.map((o) =>
        o.kind === 'screen' || o.kind === 'ndi' ? assignThemeToOutput(o, entry) : o,
      ),
    )
    flashSaved()
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
  const tabs: InspectorTab[] = ['background', 'type', 'layout']
  const activeTab = tabs.includes(tab) ? tab : tabs[0]
  const selectedElement = draft.elements.find((el) => el.id === selectedLayer) ?? null
  // No edits since the reset point (the bottom "Save theme" button).
  const isDefault = !selected || sameValue(draft, normalizeOverlayTheme(themeBaseline(selected)))
  const isKindDefault = Boolean(selected) && themeDefaults[kind] === selected?.id
  const templates = builtInThemesForKind(kind)

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
              isDefault={themeDefaults[kind] === item.id}
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
              {isKindDefault ? (
                <span className="shrink-0 rounded-md bg-surface-secondary px-2.5 py-1 text-[12px] font-medium text-slate-300">
                  Default theme
                </span>
              ) : (
                <button
                  type="button"
                  className="btn-secondary shrink-0 px-3 py-1 text-[12px]"
                  onClick={makeDefault}
                  data-tooltip="Use this theme on every screen, and for screens you add later"
                >
                  Make default
                </button>
              )}
              <AddElementMenu disabled={draft.elements.length >= MAX_OVERLAY_ELEMENTS} onAdd={(pick) => void addElement(pick)} />
              <div className="flex items-center">
                {([
                  { label: 'Undo', shortcut: '⌘Z', icon: Undo, enabled: history.canUndo, run: undo },
                  { label: 'Redo', shortcut: '⇧⌘Z', icon: Redo, enabled: history.canRedo, run: redo },
                ] as const).map(({ label, shortcut, icon: Icon, enabled, run }) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={label}
                    data-tooltip={`${label} (${shortcut})`}
                    disabled={!enabled}
                    onClick={run}
                    className="grid size-7 place-items-center rounded-md text-slate-300 transition-colors hover:bg-surface-secondary hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent"
                  >
                    <Icon size={15} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <SegmentedControl
                label="Sample text"
                value={sampleLength}
                options={[
                  { value: 'short', label: 'Short' },
                  { value: 'long', label: 'Long' },
                ]}
                onChange={setSampleLength}
                fit
                className="shrink-0 bg-surface-secondary"
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
                  onRotate={(id, rotationDeg) => updateElement(id, { rotationDeg })}
                  onDeleteLayer={deleteLayer}
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
      <aside className="flex min-h-0 flex-col bg-surface-secondary">
        {selected && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {selectedElement ? (
              <ThemeElementPanel
                key={selectedElement.id}
                element={selectedElement}
                onChange={(patch) => updateElement(selectedElement.id, patch)}
                onReorder={(to) => reorderElement(selectedElement.id, to)}
                onDuplicate={() => duplicateElement(selectedElement.id)}
                onDelete={() => deleteLayer(selectedElement.id)}
                onPickMedia={() => void replaceElementMedia(selectedElement)}
              />
            ) : (
            <>
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

            {activeTab === 'layout' && draft.elements.length > 0 && (
              <ElementList elements={draft.elements} onSelect={setSelectedLayer} />
            )}
            </>
            )}
          </div>
        )}
        {selected && (
          <div className="flex shrink-0 gap-2 p-4 pt-3">
            <button
              type="button"
              className="btn-secondary flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap text-[12px]"
              disabled={isDefault}
              onClick={resetToDefault}
              data-tooltip="Undo every change since the default was set"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset
            </button>
            <button
              type="button"
              className="btn-primary flex-1 whitespace-nowrap text-[12px]"
              disabled={isDefault}
              onClick={setAsDefault}
              data-tooltip="Save these changes — Reset will return to them"
            >
              Save theme
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}

/** Deep equality for plain theme data; an absent key equals `undefined`. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (!sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
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

const MEDIA_ICONS = { image: Image, video: Film } as const

function AddElementMenu({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (pick: ShapePick | { kind: 'image' | 'video' }) => void
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-tooltip={disabled ? `A theme holds up to ${MAX_OVERLAY_ELEMENTS} elements` : 'Add a shape, image or video'}
          className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-[12px] text-slate-300 transition-colors hover:bg-surface-secondary hover:text-white disabled:text-slate-600 disabled:hover:bg-transparent"
        >
          <Plus size={13} aria-hidden="true" /> Add Element
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-[316px] overflow-y-auto p-2">
        <DropdownMenuLabel className="px-1 pb-1 pt-0.5 text-[11px] font-medium text-slate-500">Media</DropdownMenuLabel>
        <div className="grid grid-cols-2 gap-1.5">
          {(['image', 'video'] as const).map((kind) => {
            const Icon = MEDIA_ICONS[kind]
            return (
              <DropdownMenuItem
                key={kind}
                onSelect={() => onAdd({ kind })}
                className="flex h-[72px] flex-col items-center justify-center gap-1.5 rounded-md bg-surface-tertiary text-[12px] text-slate-200 focus:bg-surface-border focus:text-white"
              >
                <Icon size={22} aria-hidden="true" />
                {kind === 'image' ? 'Image' : 'Video'}
              </DropdownMenuItem>
            )
          })}
        </div>
        <ShapeMenuItems onPick={onAdd} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The element's look in a list row: its outline for shapes, an icon for media. */
function ElementIcon({ element }: { element: OverlayElement }): React.ReactElement {
  if (element.kind === 'image' || element.kind === 'video') {
    const Icon = MEDIA_ICONS[element.kind]
    return <Icon size={13} aria-hidden="true" className="shrink-0 text-slate-500" />
  }
  const def = overlayShape(element.shape)
  const path =
    element.kind === 'rectangle'
      ? 'M0 0 H100 V100 H0 Z'
      : element.kind === 'ellipse'
        ? 'M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z'
        : (def?.path ?? '')
  return (
    <span className="shrink-0 text-slate-500">
      <ShapeThumb path={path} lineOnly={def?.lineOnly} />
    </span>
  )
}

/** Every element, top of the stack first — the way to reach one hidden under another. */
function ElementList({ elements, onSelect }: { elements: OverlayElement[]; onSelect: (id: string) => void }): React.ReactElement {
  const ordered = [...elements.filter((el) => el.aboveText).reverse(), ...elements.filter((el) => !el.aboveText).reverse()]
  return (
    <div className="space-y-1">
      <p className="label">Elements</p>
      {ordered.map((el) => {
        return (
          <button
            key={el.id}
            type="button"
            onClick={() => onSelect(el.id)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-slate-300 transition-colors hover:bg-surface-tertiary hover:text-white"
          >
            <ElementIcon element={el} />
            <span className="min-w-0 flex-1 truncate">
              {el.mediaPath ? el.mediaPath.split(/[\\/]/).pop() : overlayElementLabel(el)}
            </span>
            <span className="shrink-0 text-[11px] text-slate-500">{el.aboveText ? 'Over text' : 'Under text'}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * A box for newly placed media at the file's own shape: 30% of the frame wide,
 * centred, shrunk to fit if it is tall. Falls back to the default box if the
 * file can't be measured.
 */
async function mediaBox(path: string, kind: 'image' | 'video'): Promise<OverlayBox> {
  const url = overlayMediaUrl(path)
  const aspect = await new Promise<number | null>((resolve) => {
    if (kind === 'image') {
      const img = new window.Image()
      img.onload = () => resolve(img.naturalHeight ? img.naturalWidth / img.naturalHeight : null)
      img.onerror = () => resolve(null)
      img.src = url
    } else {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.onloadedmetadata = () => resolve(video.videoHeight ? video.videoWidth / video.videoHeight : null)
      video.onerror = () => resolve(null)
      video.src = url
    }
  })
  if (!aspect) return createOverlayElement(kind).box
  // Box % → frame px: width of 1920, height of 1080.
  let widthPct = 30
  let heightPct = ((widthPct / 100) * 1920) / aspect / 1080 * 100
  if (heightPct > 70) {
    widthPct *= 70 / heightPct
    heightPct = 70
  }
  return clampOverlayBox({ xPct: 50 - widthPct / 2, yPct: 50 - heightPct / 2, widthPct, heightPct }, ELEMENT_BOX_MIN)
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
        <Slider label="Opacity" value={bg.opacity} onChange={(opacity) => onChange({ opacity })} min={0} max={1} step={0.05} format={pct} />
      )}

      {(bg.type === 'image' || bg.type === 'video') && <MediaAdjustments bg={bg} onChange={onChange} />}
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
  isDefault = false,
  onClick,
  onDuplicate,
  onDelete,
}: {
  name: string
  theme: OverlayTheme
  kind: OverlayContentKind
  selected: boolean
  isDefault?: boolean
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
        <span className="flex items-center gap-1.5 px-0.5 pt-1.5">
          <span className={cn('min-w-0 truncate text-[12px]', selected ? 'text-white' : 'text-slate-400')}>{name}</span>
          {isDefault && (
            <span className="shrink-0 rounded bg-surface-tertiary px-1.5 py-px text-[10px] font-medium text-slate-300">Default</span>
          )}
        </span>
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
