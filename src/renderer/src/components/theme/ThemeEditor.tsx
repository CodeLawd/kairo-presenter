import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Layers,
  Radio,
  Send,
  Trash2,
  Loader,
  CheckCircle,
  XCircle,
  AlertCircle,
  MonitorPlay,
  Plus,
  Copy,
  Save,
  RotateCcw,
  MoreHorizontal,
  ListChecks,
  type Icon,
} from '@/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import OutputsPanel from './OutputsPanel'
import SetupChecklist from './SetupChecklist'
import {
  contentKindLabel,
  findNdiOutput,
  overlayLayerLabel,
  hasContentOverride,
  liveOverlayTheme,
  OVERLAY_CONTENT_KINDS,
  setContentOverride,
  themeForContentKind,
  withContentPatch,
} from '@shared/overlay-outputs'
import { Slider as SliderPrimitive } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { useAppStore } from '@/stores/useAppStore'
import { renderOverlayHTML } from '@shared/overlay-template'
import { DEFAULT_OVERLAY_SETTINGS, DEFAULT_OVERLAY_THEME, normalizeOverlaySettings, normalizeOverlayTheme } from '@shared/overlay-defaults'
import type { AppSettings, CustomOverlayTheme, OverlayBox, OverlayContentKind, OverlayTextStyle, OverlayTheme, NdiStatus, PPLook, PPVideoInputInfo } from '@shared/ipc'
import { createCustomTheme, nextUntitledThemeName, themesForKind, updateLibraryTheme } from '@shared/theme-library'
import { applyLayoutPreset, placeReferenceAgainstVerse, clampOverlayBox } from '@shared/overlay-boxes'
import { clampPaneWidth } from '@/lib/paneSizing'
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

type TestStatus = 'idle' | 'testing' | 'ok' | 'fail'
type InspectorTab = 'style' | 'type' | 'layout' | 'output'
const LIBRARY_MIN = 160
const LIBRARY_MAX = 280
const INSPECTOR_MIN = 300
const INSPECTOR_MAX = 480
const PREVIEW_MIN = 300

function storedPaneWidth(key: string, fallback: number, min: number, max: number): number {
  const stored = Number(window.localStorage.getItem(key))
  return clampPaneWidth(Number.isFinite(stored) && stored > 0 ? stored : fallback, min, max)
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
      <div className="flex items-center justify-between mb-2">
        <label className="label mb-0">{label}</label>
        <span className="text-xs font-bold font-mono text-teal-400 tabular-nums">
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
          className="absolute left-2 top-1/2 z-10 h-6 w-6 -translate-y-1/2 cursor-pointer rounded-md border border-surface-border bg-surface p-0.5"
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

function SegmentedControl<T extends string>({
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
  const columns = options.length >= 5
    ? 'grid-cols-3'
    : options.length === 4
      ? 'grid-cols-2'
      : options.length === 3
        ? 'grid-cols-3'
        : 'grid-cols-2'
  return (
    <div>
      <label className="label">{label}</label>
      <ToggleGroup
        type="single"
        value={value}
        onValueChange={(next) => next && onChange(next as T)}
        variant="outline"
        className={cn('grid w-full gap-1 rounded-lg bg-surface p-1', columns)}
      >
        {options.map((opt) => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            className="min-h-8 w-full px-2 py-1.5 text-xs font-semibold leading-tight data-[state=on]:border-primary/50 data-[state=on]:bg-primary/15 data-[state=on]:text-orange-300"
          >
            {opt.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function SectionCard({
  icon: Icon,
  title,
  children,
}: {
  icon: Icon
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="space-y-4 rounded-xl bg-surface-secondary/35 p-4">
      <div className="flex items-center gap-2">
        <Icon size={14} className="shrink-0 text-orange-400" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-tight text-white">{title}</h2>
      </div>
      {children}
    </section>
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

export default function ThemeEditor(): React.ReactElement {
  const libraryWidth = storedPaneWidth('theme-library-width', 192, LIBRARY_MIN, LIBRARY_MAX)
  const inspectorWidth = storedPaneWidth('theme-inspector-width', 330, INSPECTOR_MIN, INSPECTOR_MAX)
  const [overlay, setOverlay] = useState<AppSettings['overlay']>(DEFAULT_OVERLAY_SETTINGS)
  const [draftTheme, setDraftTheme] = useState<OverlayTheme>(DEFAULT_OVERLAY_SETTINGS.theme)
  const [themeLibrary, setThemeLibrary] = useState<CustomOverlayTheme[]>(() => {
    const library = useBootstrapStore.getState().settings.themeLibrary
    return Array.isArray(library) ? library : []
  })
  const selectedThemeId = useAppStore((s) => s.themeSelectedId)
  const themeSelectedName = useAppStore((s) => s.themeSelectedName)
  const setThemeViewState = useAppStore((s) => s.setThemeViewState)
  const [themeName, setThemeName] = useState(themeSelectedName)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('style')
  /** Which kind of push the editor is currently styling. */
  const [contentKind, setContentKind] = useState<OverlayContentKind>('scripture')
  /**
   * The theme each kind was last pointed at, so flipping the toggle returns you
   * to the lyric theme you were building rather than to whatever scripture is
   * using. Only the active kind is mirrored into the app store.
   */
  const kindSelectionRef = useRef<Record<OverlayContentKind, { id: string | null; name: string }>>({
    scripture: { id: null, name: '' },
    lyrics: { id: null, name: '' },
  })
  const [selectedLayer, setSelectedLayer] = useState<OverlayLayerId | null>('verse')
  const [sampleLength, setSampleLength] = useState<'short' | 'long'>('short')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [ndiStatus, setNdiStatus] = useState<NdiStatus>({ available: false, sending: false, ppInputConfigured: false, outputs: [] })
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testMsg, setTestMsg] = useState('')
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ppState = useAppStore((s) => s.ppState)
  const ppConnected = ppState === 'connected'

  // Reload from disk on mount so HMR / a stale bootstrap snapshot cannot wipe
  // the My themes list. Also restore the last selected custom/builtin theme.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const boot = useBootstrapStore.getState().settings
      let storedOverlay = normalizeOverlaySettings(boot.overlay)
      let library = Array.isArray(boot.themeLibrary) ? boot.themeLibrary : []

      try {
        const [diskLibrary, diskOverlay] = await Promise.all([
          window.api.settings.get('themeLibrary'),
          window.api.settings.get('overlay'),
        ])
        if (cancelled) return
        if (Array.isArray(diskLibrary)) {
          library = diskLibrary
          useBootstrapStore.getState().patchSettings('themeLibrary', diskLibrary)
        }
        if (diskOverlay) {
          storedOverlay = normalizeOverlaySettings(diskOverlay)
          useBootstrapStore.getState().patchSettings('overlay', {
            ...useBootstrapStore.getState().settings.overlay,
            ...storedOverlay,
          })
        }
      } catch {
        // Bootstrap snapshot is enough if IPC fails mid-session.
      }
      if (cancelled) return

      setOverlay(storedOverlay)
      setThemeLibrary(library)

      const rememberedId = useAppStore.getState().themeSelectedId
      const rememberedName = useAppStore.getState().themeSelectedName
      const fromLibrary = rememberedId
        ? library.find((item) => item.id === rememberedId)
        : undefined
      const fromBuiltin = rememberedId?.startsWith('builtin:')
        ? BUILT_IN_THEMES.find((item) => `builtin:${item.id}` === rememberedId)
        : undefined

      if (fromLibrary) {
        // A remembered lyric theme must reopen the editor in lyrics mode.
        setContentKind(fromLibrary.kind)
        kindSelectionRef.current[fromLibrary.kind] = { id: fromLibrary.id, name: fromLibrary.name }
        setDraftTheme(themeForContentKind(structuredClone(normalizeOverlayTheme(fromLibrary.theme)), fromLibrary.kind))
        setThemeName(fromLibrary.name)
        setThemeViewState({ selectedId: fromLibrary.id, selectedName: fromLibrary.name })
      } else if (fromBuiltin) {
        setContentKind(fromBuiltin.kind)
        kindSelectionRef.current[fromBuiltin.kind] = { id: rememberedId, name: fromBuiltin.name }
        setDraftTheme(themeForContentKind(structuredClone(normalizeOverlayTheme(fromBuiltin.theme)), fromBuiltin.kind))
        setThemeName(fromBuiltin.name)
        setThemeViewState({ selectedId: rememberedId, selectedName: fromBuiltin.name })
      } else {
        const liveTheme = liveOverlayTheme(storedOverlay, 'scripture')
        const matching = library.find(
          (item) =>
            item.kind === 'scripture' && JSON.stringify(item.theme) === JSON.stringify(liveTheme),
        )
        if (matching) {
          kindSelectionRef.current.scripture = { id: matching.id, name: matching.name }
          setDraftTheme(structuredClone(normalizeOverlayTheme(matching.theme)))
          setThemeName(matching.name)
          setThemeViewState({ selectedId: matching.id, selectedName: matching.name })
        } else {
          setDraftTheme(structuredClone(liveTheme))
          if (rememberedName) setThemeName(rememberedName)
        }
      }

      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [setThemeViewState])

  // Preview paints a real 1920×1080 frame scaled into the panel. OverlayCanvas
  // sits on the same aspect-video slot so box handles line up with the pixels.

  // Poll NDI status (availability + sender + PP video-input binding).
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      window.api.ndi
        .getStatus()
        .then((next) => {
          // Bail when nothing changed: this fires every 4s, and storing a fresh
          // object re-renders the preview and every theme tile — each one a full
          // renderOverlayHTML that recreates the DOM and restarts background video.
          if (!cancelled) {
            setNdiStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
          }
        })
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 4000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const flashSaved = useCallback(() => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    setSaved(true)
    savedTimerRef.current = setTimeout(() => setSaved(false), 1500)
  }, [])

  // Persist only the fields this page owns — main merges onto the freshly-read
  // stored overlay, so a stale copy here can never clobber the phase-1 fields
  // the Settings modal owns (template, showTranslation, …).
  const persist = useCallback(
    (next: AppSettings['overlay']) => {
      setOverlay(next)
      const store = useBootstrapStore.getState()
      store.patchSettings('overlay', { ...store.settings.overlay, ...next })
      window.api.settings
        .set('overlay', { outputs: next.outputs, theme: next.theme })
        .then(flashSaved)
    },
    [flashSaved]
  )

  // Lyrics has no Style tab — leaving it selected would render an empty panel.
  useEffect(() => {
    if (contentKind === 'lyrics' && inspectorTab === 'style') setInspectorTab('type')
  }, [contentKind, inspectorTab])

  const updateTheme = useCallback(
    <K extends keyof OverlayTheme>(section: K, partial: Partial<OverlayTheme[K]>) => {
      setDraftTheme((current) => ({
        ...current,
        [section]: { ...current[section], ...partial },
      }))
    },
    []
  )

  const updateBox = (id: OverlayLayerId, box: OverlayBox): void => {
    updateTheme(id, { box: clampOverlayBox(box) })
  }

  /**
   * Removing a box from the canvas hides that layer. The box itself is kept so
   * turning the layer back on restores its position rather than resetting it.
   */
  const hideLayer = useCallback((id: OverlayLayerId): void => {
    if (id !== 'reference') return
    setDraftTheme((current) => ({ ...current, reference: { ...current.reference, show: false } }))
    setSelectedLayer('verse')
  }, [])

  const handlePickMedia = useCallback(
    async (kind: 'image' | 'video'): Promise<void> => {
      const picked = await window.api.ndi.pickOverlayMedia(kind)
      if (!picked) return
      setDraftTheme((current) => ({
        ...current,
        background: { ...current.background, mediaPath: picked },
      }))
    },
    []
  )

  const persistLibrary = useCallback((next: CustomOverlayTheme[]) => {
    setThemeLibrary(next)
    useBootstrapStore.getState().patchSettings('themeLibrary', next)
    void window.api.settings.set('themeLibrary', next).then(flashSaved)
  }, [flashSaved])

  const selectTheme = (
    id: string,
    name: string,
    theme: OverlayTheme,
    kind: OverlayContentKind = contentKind,
  ): void => {
    // Picking from the other group moves the editor there — a lyric theme
    // opened in scripture mode would edit and apply to the wrong output slot.
    if (kind !== contentKind) {
      kindSelectionRef.current[contentKind] = { id: selectedThemeId, name: themeName }
      setContentKind(kind)
    }
    kindSelectionRef.current[kind] = { id, name }
    setThemeViewState({ selectedId: id, selectedName: name })
    setThemeName(name)
    setDraftTheme(themeForContentKind(structuredClone(normalizeOverlayTheme(theme)), kind))
  }

  /** Persist draft into the theme library only — does not push to live output. */
  const saveAsTheme = (): void => {
    const savedTheme = createCustomTheme(themeName.trim() || 'Untitled theme', draftTheme, contentKind)
    persistLibrary([...themeLibrary, savedTheme])
    kindSelectionRef.current[contentKind] = { id: savedTheme.id, name: savedTheme.name }
    setThemeViewState({ selectedId: savedTheme.id, selectedName: savedTheme.name })
    setThemeName(savedTheme.name)
  }

  /** Start a blank theme for the current kind — plus is create, not save. */
  const createNewTheme = (): void => {
    const name = nextUntitledThemeName(themeLibrary, contentKind)
    const theme = themeForContentKind(structuredClone(DEFAULT_OVERLAY_THEME), contentKind)
    const created = createCustomTheme(name, theme, contentKind)
    persistLibrary([...themeLibrary, created])
    kindSelectionRef.current[contentKind] = { id: created.id, name: created.name }
    setThemeViewState({ selectedId: created.id, selectedName: created.name })
    setThemeName(created.name)
    // Clone the stored snapshot, not the object createCustomTheme copied from,
    // so later Type/Layout edits cannot alias the library row.
    setDraftTheme(structuredClone(created.theme))
  }

  /** Update the selected custom theme in the library — does not push to live output. */
  const saveThemeChanges = (): void => {
    if (!selectedThemeId || selectedThemeId.startsWith('builtin:')) {
      saveAsTheme()
      return
    }
    const nextName = themeName.trim() || themeLibrary.find((item) => item.id === selectedThemeId)?.name || 'Untitled theme'
    persistLibrary(updateLibraryTheme(themeLibrary, selectedThemeId, { name: nextName, theme: draftTheme }))
    setThemeViewState({ selectedId: selectedThemeId, selectedName: nextName })
    setThemeName(nextName)
  }

  const isCustomThemeSelected = Boolean(selectedThemeId && !selectedThemeId.startsWith('builtin:'))

  const duplicateTheme = (): void => {
    const copy = createCustomTheme(`${themeName || 'Theme'} copy`, draftTheme, contentKind)
    persistLibrary([...themeLibrary, copy])
    kindSelectionRef.current[contentKind] = { id: copy.id, name: copy.name }
    setThemeViewState({ selectedId: copy.id, selectedName: copy.name })
    setThemeName(copy.name)
  }

  const deleteTheme = (themeId = selectedThemeId, name = themeName): void => {
    if (!themeId || themeId.startsWith('builtin:')) return
    const label = name.trim() || themeLibrary.find((item) => item.id === themeId)?.name || 'Untitled theme'
    if (!window.confirm(`Delete “${label}”? This cannot be undone.`)) return
    const next = themeLibrary.filter((item) => item.id !== themeId)
    persistLibrary(next)
    if (selectedThemeId === themeId) {
      kindSelectionRef.current[contentKind] = { id: null, name: '' }
      const picked = pickThemeForKind(contentKind)
      setThemeViewState({ selectedId: picked.id, selectedName: picked.name })
      setThemeName(picked.name)
      setDraftTheme(themeForContentKind(structuredClone(normalizeOverlayTheme(picked.theme)), contentKind))
    }
  }

  /**
   * Writes the draft theme onto one output. Themes are per-output now, so
   * "apply" needs a target — `applyToOutput` sends it to the NDI output (the
   * only kind this app renders itself), and the Outputs panel can target one
   * explicitly.
   */
  const applyDraftThemeToOutput = (outputId: string): void => {
    // Keep the selected custom theme in sync with what went live so leaving the
    // tab and coming back still shows the saved look.
    if (selectedThemeId && !selectedThemeId.startsWith('builtin:')) {
      const nextName = themeName.trim() || themeLibrary.find((item) => item.id === selectedThemeId)?.name || 'Untitled theme'
      persistLibrary(updateLibraryTheme(themeLibrary, selectedThemeId, { name: nextName, theme: draftTheme }))
      setThemeViewState({ selectedId: selectedThemeId, selectedName: nextName })
    }

    const themeId = selectedThemeId && !selectedThemeId.startsWith('builtin:') ? selectedThemeId : null
    persist({
      ...overlay,
      outputs: overlay.outputs.map((output) => {
        if (output.id !== outputId) return output
        // Applying a lyrics theme is itself the intent to stop inheriting, so
        // the override is switched on rather than the apply silently landing on
        // the scripture theme.
        const target = setContentOverride(output, contentKind, true)
        return withContentPatch(target, contentKind, {
          themeId,
          theme: themeForContentKind(structuredClone(draftTheme), contentKind),
        })
      }),
      // The legacy field still feeds verse-card previews elsewhere in the app,
      // which are scripture-only — a lyrics theme must not overwrite it.
      theme: contentKind === 'scripture' ? structuredClone(draftTheme) : overlay.theme,
    })
  }

  /**
   * Flips the editor between scripture and lyrics. The draft is per-kind, so
   * switching loads that kind's live theme — and unapplied work would be lost,
   * hence the confirm.
   */
  const selectContentKind = (next: OverlayContentKind): void => {
    if (next === contentKind) return
    if (
      hasDraftChanges &&
      !window.confirm(
        `Switch to ${contentKindLabel(next)}? Unapplied changes to the ${contentKindLabel(contentKind).toLowerCase()} theme will be lost.`,
      )
    ) return

    kindSelectionRef.current[contentKind] = { id: selectedThemeId, name: themeName }
    setContentKind(next)

    const picked = pickThemeForKind(next)
    setThemeViewState({ selectedId: picked.id, selectedName: picked.name })
    setThemeName(picked.name)
    setDraftTheme(themeForContentKind(structuredClone(normalizeOverlayTheme(picked.theme)), next))
  }

  /**
   * What to show when the editor lands on `kind`. In order: whatever that kind
   * was last pointed at, then its configured live theme (only when an override
   * actually exists — inheriting scripture is not a lyrics theme), then its
   * first saved theme, then its first built-in starter.
   */
  const pickThemeForKind = (
    kind: OverlayContentKind,
  ): { id: string | null; name: string; theme: OverlayTheme } => {
    const remembered = kindSelectionRef.current[kind]
    if (remembered.id) {
      const fromLibrary = themeLibrary.find((item) => item.id === remembered.id)
      if (fromLibrary) return { id: fromLibrary.id, name: fromLibrary.name, theme: fromLibrary.theme }
      const builtin = builtInsForKind(kind).find((item) => `builtin:${item.id}` === remembered.id)
      if (builtin) return { id: remembered.id, name: builtin.name, theme: builtin.theme }
    }

    if (kind === 'scripture' || overlay.outputs.some((o) => hasContentOverride(o, kind))) {
      const live = liveOverlayTheme(overlay, kind)
      const matching = themeLibrary.find(
        (item) => item.kind === kind && JSON.stringify(item.theme) === JSON.stringify(live),
      )
      return matching
        ? { id: matching.id, name: matching.name, theme: matching.theme }
        : { id: null, name: remembered.name, theme: live }
    }

    const saved = themeLibrary.find((item) => item.kind === kind)
    if (saved) return { id: saved.id, name: saved.name, theme: saved.theme }

    const [starter] = builtInsForKind(kind)
    return starter
      ? { id: `builtin:${starter.id}`, name: starter.name, theme: starter.theme }
      : { id: null, name: '', theme: DEFAULT_OVERLAY_SETTINGS.theme }
  }

  /**
   * Turns the lyrics override on or off across every output at once. Per-output
   * granularity would mean a lyric push styled one way on the main screen and
   * another on stage for no reason an operator would ask for.
   */
  const setKindOverride = (on: boolean): void => {
    const outputs = overlay.outputs.map((output) => setContentOverride(output, contentKind, on))
    persist({ ...overlay, outputs })
    if (!on) setDraftTheme(structuredClone(liveOverlayTheme({ ...overlay, outputs }, contentKind)))
  }

  const applyToOutput = (): void => {
    const target = findNdiOutput(overlay.outputs)
    if (!target) {
      window.alert('No rendered (NDI) output exists yet — add one on the Output tab first.')
      return
    }
    applyDraftThemeToOutput(target.id)
  }

  // PP video inputs for the manual NDI binding picker. PP names inputs
  // "Input N" and never exposes the NDI source name, so auto-discovery can't
  // identify ours — the user picks it once and we persist the uuid.
  const [videoInputs, setVideoInputs] = useState<PPVideoInputInfo[]>([])
  const refreshVideoInputs = useCallback((): void => {
    window.api.ndi
      .getVideoInputs()
      .then(setVideoInputs)
      .catch(() => setVideoInputs([]))
  }, [])
  useEffect(() => {
    refreshVideoInputs()
  }, [refreshVideoInputs])

  // PP Looks — a Look is what decides which layers each screen shows, so it is
  // the only lever this app has over per-screen routing.
  const [looks, setLooks] = useState<PPLook[]>([])
  const refreshLooks = useCallback((): void => {
    window.api.propresenter
      .getLooks()
      .then(setLooks)
      .catch(() => setLooks([]))
  }, [])
  useEffect(() => {
    refreshLooks()
  }, [refreshLooks])

  const handleSendTest = async (): Promise<void> => {
    setTestStatus('testing')
    setTestMsg('Sending…')
    try {
      const ok = await window.api.propresenter.testOverlay()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Sent to ProPresenter' : 'Push failed — check logs')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleClear = async (): Promise<void> => {
    setTestStatus('testing')
    setTestMsg('Clearing…')
    try {
      const ok = await window.api.propresenter.clearOverlay()
      setTestStatus(ok ? 'ok' : 'fail')
      setTestMsg(ok ? 'Cleared' : 'Clear failed — check logs')
    } catch (err) {
      setTestStatus('fail')
      setTestMsg(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const theme = draftTheme
  const sample = SAMPLES[contentKind]
  const previewText = sampleLength === 'long' ? sample.long : sample.short
  const previewHtml = renderOverlayHTML(theme, sample.reference, previewText)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader size={16} className="animate-spin" />
          <span className="text-sm">Loading theme…</span>
        </div>
      </div>
    )
  }

  // Style is only the Background section, and a song theme has no background to
  // configure — so the tab is absent rather than empty for lyrics.
  const inspectorTabs = (
    contentKind === 'lyrics'
      ? ([['type', 'Type'], ['layout', 'Layout'], ['output', 'Output']] as const)
      : ([['style', 'Style'], ['type', 'Type'], ['layout', 'Layout'], ['output', 'Output']] as const)
  ) as ReadonlyArray<readonly [InspectorTab, string]>

  const liveTheme = liveOverlayTheme(overlay, contentKind)
  // Any output carrying the override counts — `setKindOverride` writes them all.
  const kindOverrideOn = overlay.outputs.some((output) => hasContentOverride(output, contentKind))
  const hasDraftChanges = JSON.stringify(draftTheme) !== JSON.stringify(liveTheme)

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full overflow-hidden bg-surface">
      {/* Theme library */}
      <ResizablePanel
        id="theme-library"
        data-pane="library"
        defaultSize={libraryWidth}
        minSize={LIBRARY_MIN}
        maxSize={LIBRARY_MAX}
        onResize={({ inPixels }, _id, previous) => {
          if (previous) window.localStorage.setItem('theme-library-width', String(Math.round(inPixels)))
        }}
      >
      <aside className="h-full overflow-y-auto bg-surface-secondary p-3">
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em]">Themes</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Select to preview</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 text-slate-400 hover:text-teal-300"
            onClick={createNewTheme}
            aria-label="New theme"
            title="New theme"
          >
            <Plus size={14} aria-hidden="true" />
          </Button>
        </div>
        {/* Grouped by what the theme is for. The active kind leads; clicking
            into the other group moves the whole editor there. */}
        <div className="space-y-7">
          {[contentKind, ...OVERLAY_CONTENT_KINDS.filter((k) => k !== contentKind)].map((kind) => {
            const saved = themesForKind(themeLibrary, kind)
            const builtIns = builtInsForKind(kind)
            const active = kind === contentKind
            return (
              <div key={kind} className={cn('space-y-4', !active && 'opacity-60 hover:opacity-100 transition-opacity')}>
                <div className="flex items-center justify-between gap-2 px-1">
                  <p className={cn(
                    'text-[10px] font-bold uppercase tracking-[0.16em]',
                    active ? 'text-teal-400' : 'text-slate-500'
                  )}>
                    {contentKindLabel(kind)}
                  </p>
                  <span className="text-[10px] text-slate-500 tabular-nums">{saved.length}</span>
                </div>

                <div>
                  <p className="label">Built in</p>
                  <div className="space-y-2">
                    {builtIns.map((item) => (
                      <ThemeTile
                        key={item.id}
                        name={item.name}
                        theme={
                          kind === contentKind && selectedThemeId === `builtin:${item.id}`
                            ? draftTheme
                            : item.theme
                        }
                        kind={kind}
                        selected={selectedThemeId === `builtin:${item.id}`}
                        onClick={() => selectTheme(`builtin:${item.id}`, item.name, item.theme, kind)}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="label">My themes</p>
                  <div className="space-y-2">
                    {saved.map((item) => (
                      <ThemeTile
                        key={item.id}
                        name={item.name}
                        theme={
                          kind === contentKind && selectedThemeId === item.id
                            ? draftTheme
                            : item.theme
                        }
                        kind={kind}
                        selected={selectedThemeId === item.id}
                        onClick={() => selectTheme(item.id, item.name, item.theme, kind)}
                        onDelete={() => deleteTheme(item.id, item.name)}
                      />
                    ))}
                    {saved.length === 0 && (
                      <p className="text-xs text-slate-500 py-3">
                        No saved {contentKindLabel(kind).toLowerCase()} themes yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </aside>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize theme library" />
      <ResizablePanel id="theme-workspace" minSize={PREVIEW_MIN + INSPECTOR_MIN}>
      <ResizablePanelGroup orientation="horizontal" className="flex-row-reverse">

      {/* Controls column */}
      <ResizablePanel
        id="theme-inspector"
        data-pane="inspector"
        defaultSize={inspectorWidth}
        minSize={INSPECTOR_MIN}
        maxSize={INSPECTOR_MAX}
        onResize={({ inPixels }, _id, previous) => {
          if (previous) window.localStorage.setItem('theme-inspector-width', String(Math.round(inPixels)))
        }}
        className="theme-inspector"
      >
      <div className="h-full overflow-y-auto">
        <div className="w-full p-4 space-y-4">
          {/* ── What this theme styles ───────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex rounded-md border border-surface-border/60 p-0.5" role="group" aria-label="Content type">
              {OVERLAY_CONTENT_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => selectContentKind(kind)}
                  aria-pressed={contentKind === kind}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors',
                    contentKind === kind
                      ? 'chip-selected'
                      : 'text-slate-500 hover:text-slate-300'
                  )}
                >
                  {contentKindLabel(kind)}
                </button>
              ))}
            </div>

            {contentKind !== 'scripture' && (
              <div className="flex items-start justify-between gap-3 rounded-lg bg-surface-secondary/35 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-200">Separate {contentKindLabel(contentKind).toLowerCase()} theme</p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">
                    {kindOverrideOn
                      ? 'Lyric pushes use this theme and template.'
                      : 'Off — lyric pushes reuse the scripture theme.'}
                  </p>
                </div>
                <Switch
                  checked={kindOverrideOn}
                  onCheckedChange={setKindOverride}
                  aria-label={`Use a separate ${contentKindLabel(contentKind).toLowerCase()} theme`}
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
                Editing {contentKindLabel(contentKind).toLowerCase()} theme
              </p>
              <div className="mt-1 flex items-center gap-1">
                <input
                  id="theme-name"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base font-semibold text-white outline-none placeholder:text-slate-600"
                  value={themeName}
                  placeholder="Untitled theme"
                  onChange={(event) => {
                    const next = event.target.value
                    setThemeName(next)
                    if (selectedThemeId) setThemeViewState({ selectedName: next })
                  }}
                  aria-label="Theme name"
                />
                {isCustomThemeSelected && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-slate-500 hover:text-teal-300"
                    onClick={saveThemeChanges}
                    aria-label="Save theme changes"
                    title="Save theme to library (does not change live output)"
                  >
                    <Save size={14} aria-hidden="true" />
                  </Button>
                )}
                {isCustomThemeSelected && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-slate-500 hover:text-rose-300"
                    onClick={() => deleteTheme()}
                    aria-label="Delete theme"
                    title="Delete theme from library"
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="text-slate-500 hover:text-white" aria-label="Theme actions">
                    <MoreHorizontal size={15} aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onSelect={duplicateTheme}>
                      <Copy size={13} /> Duplicate
                    </DropdownMenuItem>
                    {isCustomThemeSelected && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => deleteTheme()}>
                          <Trash2 size={13} /> Delete
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">Adjustments preview privately</p>
            </div>
            {saved && (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-400 animate-fade-in">
                <CheckCircle size={13} aria-hidden="true" />
                Saved
              </span>
            )}
          </div>

          <Tabs value={inspectorTab} onValueChange={(value) => setInspectorTab(value as InspectorTab)}>
          <TabsList
            className={cn('grid h-9 w-full', inspectorTabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}
            aria-label="Theme controls"
          >
            {inspectorTabs.map(([id, label]) => (
              <TabsTrigger
                key={id}
                value={id}
                className="text-[11px]"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          </Tabs>

          {contentKind === 'lyrics' && (
            <p className="rounded-lg bg-surface-secondary/40 px-3 py-2 text-[10px] leading-relaxed text-slate-400">
              A song theme sets type and placement only. Backgrounds change every song, so they are
              pushed live from the Media section instead of being saved into the theme.
            </p>
          )}

          {/* ── Setup checklist ──────────────────────────────────────────────── */}
          {inspectorTab === 'output' && <SectionCard icon={ListChecks} title="Setup">
            <SetupChecklist
              ppConnected={ppConnected}
              ndiStatus={ndiStatus}
              outputs={overlay.outputs}
              looks={looks}
              onSendTest={handleSendTest}
              testStatus={testStatus}
              testMsg={testMsg}
            />
          </SectionCard>}

          {/* ── Outputs ──────────────────────────────────────────────────────── */}
          {inspectorTab === 'output' && <SectionCard icon={Radio} title="Outputs">
            <OutputsPanel
              outputs={overlay.outputs}
              onChange={(outputs) => persist({ ...overlay, outputs })}
              contentKind={contentKind}
              videoInputs={videoInputs}
              onRefreshVideoInputs={refreshVideoInputs}
              looks={looks}
              onRefreshLooks={refreshLooks}
              themeLibrary={themeLibrary}
              status={ndiStatus.outputs}
              onApplyDraftTheme={applyDraftThemeToOutput}
              hasDraftChanges={hasDraftChanges}
            />
          </SectionCard>}

          {/* ── Background ───────────────────────────────────────────────────── */}
          {inspectorTab === 'style' && <SectionCard icon={Layers} title="Background">
            <SegmentedControl
              label="Type"
              value={theme.background.type}
              options={[
                { value: 'transparent', label: 'Transparent' },
                { value: 'color', label: 'Solid color' },
                { value: 'gradient', label: 'Gradient' },
                { value: 'image', label: 'Image' },
                { value: 'video', label: 'Video' },
              ]}
              onChange={(type) => updateTheme('background', { type })}
            />

            {(theme.background.type === 'color' || theme.background.type === 'gradient') && (
              <>
                <div className="border-t border-surface-border/50" />
                <div className={cn('grid gap-4', theme.background.type === 'gradient' ? 'grid-cols-2' : 'grid-cols-1')}>
                  <ColorField
                    label={theme.background.type === 'gradient' ? 'Start color' : 'Color'}
                    value={theme.background.color}
                    onChange={(color) => updateTheme('background', { color })}
                  />
                  {theme.background.type === 'gradient' && (
                    <ColorField
                      label="End color"
                      value={theme.background.color2 ?? theme.background.color}
                      onChange={(color2) => updateTheme('background', { color2 })}
                    />
                  )}
                </div>
                {theme.background.type === 'gradient' && (
                  <Slider
                    label="Gradient angle"
                    value={theme.background.angleDeg ?? 0}
                    onChange={(angleDeg) => updateTheme('background', { angleDeg })}
                    min={0}
                    max={360}
                    unit="°"
                  />
                )}
              </>
            )}

            {(theme.background.type === 'image' || theme.background.type === 'video') && (
              <>
                <div className="border-t border-surface-border/50" />
                <div>
                  <label className="label">
                    {theme.background.type === 'video' ? 'Video file' : 'Image file'}
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary px-3 py-2 text-xs shrink-0"
                      onClick={() => handlePickMedia(theme.background.type as 'image' | 'video')}
                    >
                      Choose file…
                    </button>
                    <span
                      className="text-xs text-slate-400 font-mono truncate min-w-0"
                      title={theme.background.mediaPath}
                    >
                      {theme.background.mediaPath
                        ? theme.background.mediaPath.split('/').pop()
                        : 'No file selected'}
                    </span>
                  </div>
                  {theme.background.type === 'video' && (
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
                      Plays muted on a loop behind the text. Keep clips short and lightweight —
                      the NDI output repaints every frame.
                    </p>
                  )}
                </div>
                <SegmentedControl
                  label="Fit"
                  value={theme.background.mediaFit ?? 'cover'}
                  options={[
                    { value: 'cover', label: 'Cover' },
                    { value: 'contain', label: 'Contain' },
                    { value: 'fill', label: 'Stretch' },
                  ]}
                  onChange={(mediaFit) => updateTheme('background', { mediaFit })}
                />
              </>
            )}

            {theme.background.type !== 'transparent' && (
              <Slider
                label="Opacity"
                value={theme.background.opacity}
                onChange={(opacity) => updateTheme('background', { opacity })}
                min={0}
                max={1}
                step={0.05}
                format={(v) => v.toFixed(2)}
              />
            )}
          </SectionCard>}

          {/* ── Type (Scripture / Reference + Effects) ───────────────────────── */}
          {inspectorTab === 'type' && (
            <ThemeTypePanel
              theme={theme}
              contentKind={contentKind}
              selectedLayer={selectedLayer === 'reference' ? 'reference' : 'verse'}
              onSelectLayer={setSelectedLayer}
              onUpdateLayer={(id, partial) => updateTheme(id, partial as Partial<OverlayTextStyle>)}
              onUpdateReferenceMeta={(partial) => {
                if (partial.position) {
                  setDraftTheme((current) => ({
                    ...current,
                    reference: {
                      ...current.reference,
                      ...partial,
                      box: placeReferenceAgainstVerse(
                        current.verse.box,
                        current.reference.box,
                        partial.position ?? current.reference.position
                      ),
                    },
                  }))
                  return
                }
                updateTheme('reference', partial)
              }}
              onAutoFitChange={(autoFitText) => updateTheme('layout', { autoFitText })}
            />
          )}

          {/* ── Layout ───────────────────────────────────────────────────────── */}
          {inspectorTab === 'layout' && (
            <ThemeLayoutPanel
              theme={theme}
              contentKind={contentKind}
              selectedLayer={selectedLayer === 'reference' ? 'reference' : 'verse'}
              onSelectLayer={setSelectedLayer}
              onApplyPreset={(position) => {
                setDraftTheme((current) => applyLayoutPreset(current, position))
                setSelectedLayer('verse')
              }}
              onUpdateLayout={(partial) => updateTheme('layout', partial)}
              onUpdateBox={updateBox}
              onUpdatePresetWidth={(maxWidthPct) => {
                setDraftTheme((current) =>
                  applyLayoutPreset(current, current.layout.position, maxWidthPct)
                )
              }}
            />
          )}
        </div>
      </div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize theme inspector" />

      {/* Preview + status column */}
      <ResizablePanel id="theme-preview" minSize={PREVIEW_MIN}>
      <div className="h-full overflow-y-auto bg-transparent">
        <div className="flex min-h-full flex-col gap-5 p-5">
          {/* NDI / PP status line */}
          <div className="double-bezel-outer order-3">
            <div className="double-bezel-inner p-4 space-y-3">
              <div className="flex items-center gap-2">
                <MonitorPlay size={14} className="text-teal-400 shrink-0" aria-hidden="true" />
                <p className="text-xs font-bold text-white tracking-tight uppercase tracking-wider">NDI status</p>
              </div>
              <div className="space-y-2 text-xs">
                <StatusRow label="Sender available" ok={ndiStatus.available} />
                <StatusRow label="Sending frames" ok={ndiStatus.sending} />
                <StatusRow label="PP video input bound" ok={ndiStatus.ppInputConfigured} />
              </div>
              {!ndiStatus.available && (
                <p className="text-[10px] text-yellow-400 flex items-start gap-1.5 leading-relaxed">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
                  NDI sender unavailable — the rendered output cannot push. Other enabled outputs are unaffected.
                </p>
              )}
              {ndiStatus.available && !ndiStatus.ppInputConfigured && (
                <p className="text-[10px] text-yellow-400 flex items-start gap-1.5 leading-relaxed">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
                  In ProPresenter: add a Video Input for the "Kairo Scripture" NDI source, then bind it on the Output tab.
                </p>
              )}
            </div>
          </div>

          {/* WYSIWYG preview */}
          <div className="order-1">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">Preview</p>
                <p className="text-xs text-slate-400 mt-1">{sample.reference} · 1920 × 1080</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-md border border-surface-border/60 p-0.5">
                  {(['short', 'long'] as const).map((len) => (
                    <button
                      key={len}
                      type="button"
                      onClick={() => setSampleLength(len)}
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                        sampleLength === len ? 'chip-selected' : 'text-slate-500 hover:text-slate-300'
                      )}
                    >
                      {len}
                    </button>
                  ))}
                </div>
                {hasDraftChanges && <span className="text-[10px] font-semibold text-orange-300 bg-orange-400/10 px-2 py-1 rounded-md">Unapplied changes</span>}
              </div>
            </div>
            <div className="relative isolate overflow-hidden rounded-xl border border-surface-border/50">
              <ScaledOverlayPreview
                html={previewHtml}
                autoFit={theme.layout.autoFitText}
              />
              <OverlayCanvas
                theme={theme}
                contentKind={contentKind}
                selected={selectedLayer}
                onSelect={setSelectedLayer}
                onBoxChange={updateBox}
                onDeleteLayer={hideLayer}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Drag a box on the canvas. Resize from the corners. Select the{' '}
              {overlayLayerLabel(contentKind, 'reference').toLowerCase()} and press Delete (or its ×) to hide it.
              Turn on Type → Fit to box so long verses shrink to the box. Short verses stay a natural size.
            </p>
          </div>

          <div className="order-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
                onClick={saveThemeChanges}
                title={
                  isCustomThemeSelected
                    ? 'Save this theme to My themes (does not change live output)'
                    : 'Save draft as a new theme in My themes (does not change live output)'
                }
              >
                <Save size={14} />
                {isCustomThemeSelected ? 'Save theme' : 'Save as theme'}
              </button>
              <button
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={applyToOutput}
                disabled={!hasDraftChanges}
                title="Push the current draft to live NDI / message output"
              >
                <MonitorPlay size={14} /> Apply to output
              </button>
            </div>
            <button
              className="btn-secondary flex items-center justify-center gap-2"
              onClick={() => setDraftTheme(structuredClone(liveTheme))}
              disabled={!hasDraftChanges}
            >
              <RotateCcw size={13} /> Discard draft
            </button>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Save stores the theme in your library. Apply pushes it to the live output.
            </p>
          </div>

          {/* Test / clear */}
          <div className="order-4 space-y-2">
            <div className="flex items-center gap-2">
              <button
                className="btn-primary flex items-center gap-2 flex-1 justify-center"
                onClick={handleSendTest}
                disabled={!ppConnected || testStatus === 'testing'}
              >
                <Send size={13} aria-hidden="true" />
                Send test verse
              </button>
              <button
                className="btn-secondary flex items-center gap-2 justify-center"
                onClick={handleClear}
                disabled={!ppConnected || testStatus === 'testing'}
              >
                <Trash2 size={13} aria-hidden="true" />
                Clear
              </button>
            </div>
            {testStatus !== 'idle' && (
              <div
                className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold',
                  testStatus === 'testing' && 'text-yellow-400',
                  testStatus === 'ok' && 'text-teal-400',
                  testStatus === 'fail' && 'text-red-400'
                )}
              >
                {testStatus === 'testing' && <Loader size={11} className="animate-spin" aria-hidden="true" />}
                {testStatus === 'ok' && <CheckCircle size={11} aria-hidden="true" />}
                {testStatus === 'fail' && <XCircle size={11} aria-hidden="true" />}
                <span>{testMsg}</span>
              </div>
            )}
            {!ppConnected && (
              <p className="text-[10px] text-slate-500 leading-relaxed">
                Connect to ProPresenter (Settings → ProPresenter) to test live.
              </p>
            )}
          </div>
        </div>
      </div>
      </ResizablePanel>
      </ResizablePanelGroup>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }): React.ReactElement {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-400">{label}</span>
      <span className={cn('flex items-center gap-1.5 font-semibold', ok ? 'text-teal-400' : 'text-slate-500')}>
        <span className={cn('w-1.5 h-1.5 rounded-full', ok ? 'bg-teal-400 shadow-glow-teal/40' : 'bg-slate-600')} />
        {ok ? 'Ready' : 'Not ready'}
      </span>
    </div>
  )
}

function ThemeTile({
  name,
  theme,
  kind,
  selected,
  onClick,
  onDelete,
}: {
  name: string
  theme: OverlayTheme
  kind: OverlayContentKind
  selected: boolean
  onClick: () => void
  onDelete?: () => void
}): React.ReactElement {
  const previewTheme = normalizeOverlayTheme(theme)
  const sample = SAMPLES[kind]
  const html = renderOverlayHTML(previewTheme, sample.reference, sample.short)
  return (
    <div
      className={cn(
        'group relative w-full rounded-lg border p-1 text-left transition-all duration-200',
        selected
          ? 'border-teal-500/50 bg-teal-500/10 shadow-[0_0_0_1px_rgb(var(--control-accent)/0.12)]'
          : 'border-surface-border/60 bg-surface hover:border-slate-500'
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        className="w-full text-left"
      >
        <div className="overflow-hidden rounded-md">
          <ScaledOverlayPreview
            html={html}
            autoFit={previewTheme.layout.autoFitText}
          />
        </div>
        <span className={cn('block truncate px-1.5 pb-1 pt-1.5 text-[11px] font-semibold', selected ? 'text-orange-300' : 'text-slate-300')}>
          {name}
        </span>
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          className={cn(
            'absolute right-1.5 top-1.5 rounded-md bg-black/70 p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-rose-950/80 hover:text-rose-300 group-hover:opacity-100 focus-visible:opacity-100',
            selected && 'opacity-100'
          )}
          aria-label={`Delete ${name}`}
          title="Delete theme"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
