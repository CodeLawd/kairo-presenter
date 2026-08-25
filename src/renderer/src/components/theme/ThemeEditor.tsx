import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
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
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
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
import { DEFAULT_OVERLAY_SETTINGS, normalizeOverlaySettings, normalizeOverlayTheme } from '@shared/overlay-defaults'
import type { AppSettings, CustomOverlayTheme, OverlayBox, OverlayTextStyle, OverlayTheme, NdiStatus, PPVideoInputInfo } from '@shared/ipc'
import { createCustomTheme } from '@shared/theme-library'
import { applyLayoutPreset, placeReferenceAgainstVerse, clampOverlayBox } from '@shared/overlay-boxes'
import { applyOverlayAutoFit } from '@shared/overlay-fit'
import { clampPaneWidth, scaleToFit } from '@/lib/paneSizing'
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

function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onChange}
    />
  )
}

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
  icon: LucideIcon
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

const BUILT_IN_THEMES: Array<{ id: string; name: string; theme: OverlayTheme }> = [
  { id: 'broadcast', name: 'Broadcast', theme: DEFAULT_OVERLAY_SETTINGS.theme },
  {
    id: 'warm-paper',
    name: 'Warm paper',
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
]

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
  const [selectedLayer, setSelectedLayer] = useState<OverlayLayerId | null>('verse')
  const [sampleLength, setSampleLength] = useState<'short' | 'long'>('short')
  const [loading, setLoading] = useState(true)
  const [saved, setSaved] = useState(false)
  const [ndiStatus, setNdiStatus] = useState<NdiStatus>({ available: false, sending: false, ppInputConfigured: false })
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
        setDraftTheme(structuredClone(normalizeOverlayTheme(fromLibrary.theme)))
        setThemeName(fromLibrary.name)
        setThemeViewState({ selectedId: fromLibrary.id, selectedName: fromLibrary.name })
      } else if (fromBuiltin) {
        setDraftTheme(structuredClone(normalizeOverlayTheme(fromBuiltin.theme)))
        setThemeName(fromBuiltin.name)
        setThemeViewState({ selectedId: rememberedId, selectedName: fromBuiltin.name })
      } else {
        const matching = library.find(
          (item) => JSON.stringify(item.theme) === JSON.stringify(storedOverlay.theme),
        )
        if (matching) {
          setDraftTheme(structuredClone(normalizeOverlayTheme(matching.theme)))
          setThemeName(matching.name)
          setThemeViewState({ selectedId: matching.id, selectedName: matching.name })
        } else {
          setDraftTheme(structuredClone(storedOverlay.theme))
          if (rememberedName) setThemeName(rememberedName)
        }
      }

      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [setThemeViewState])

  // Preview renders a real 1920×1080 frame scaled down to the panel width, so
  // proportions (font px vs frame) match the NDI output exactly.
  const previewFrameRef = useRef<HTMLDivElement>(null)
  const previewInnerRef = useRef<HTMLDivElement>(null)
  const [previewScale, setPreviewScale] = useState(0.2)
  useEffect(() => {
    const el = previewFrameRef.current
    if (!el) return
    const update = (): void => setPreviewScale(scaleToFit(el.clientWidth, 1920))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [loading])

  // Poll NDI status (availability + sender + PP video-input binding).
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      window.api.ndi
        .getStatus()
        .then((s) => {
          if (!cancelled) setNdiStatus(s)
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
        .set('overlay', {
          mode: next.mode,
          ppVideoInputUuid: next.ppVideoInputUuid,
          theme: next.theme,
        })
        .then(flashSaved)
    },
    [flashSaved]
  )

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

  const setMode = (mode: AppSettings['overlay']['mode']): void => persist({ ...overlay, mode })

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

  const selectTheme = (id: string, name: string, theme: OverlayTheme): void => {
    setThemeViewState({ selectedId: id, selectedName: name })
    setThemeName(name)
    setDraftTheme(structuredClone(normalizeOverlayTheme(theme)))
  }

  /** Persist draft into the theme library only — does not push to live output. */
  const saveAsTheme = (): void => {
    const savedTheme = createCustomTheme(themeName.trim() || 'Untitled theme', draftTheme)
    persistLibrary([...themeLibrary, savedTheme])
    setThemeViewState({ selectedId: savedTheme.id, selectedName: savedTheme.name })
    setThemeName(savedTheme.name)
  }

  /** Update the selected custom theme in the library — does not push to live output. */
  const saveThemeChanges = (): void => {
    if (!selectedThemeId || selectedThemeId.startsWith('builtin:')) {
      saveAsTheme()
      return
    }
    const nextName = themeName.trim() || themeLibrary.find((item) => item.id === selectedThemeId)?.name || 'Untitled theme'
    const next = themeLibrary.map((item) => item.id === selectedThemeId
      ? { ...item, name: nextName, updatedAt: Date.now(), theme: structuredClone(draftTheme) }
      : item)
    persistLibrary(next)
    setThemeViewState({ selectedId: selectedThemeId, selectedName: nextName })
    setThemeName(nextName)
  }

  const isCustomThemeSelected = Boolean(selectedThemeId && !selectedThemeId.startsWith('builtin:'))

  const duplicateTheme = (): void => {
    const copy = createCustomTheme(`${themeName || 'Theme'} copy`, draftTheme)
    persistLibrary([...themeLibrary, copy])
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
      setThemeViewState({ selectedId: null, selectedName: '' })
      setThemeName('')
      setDraftTheme(structuredClone(overlay.theme))
    }
  }

  const applyToOutput = (): void => {
    // Keep the selected custom theme in sync with what went live so leaving the
    // tab and coming back still shows the saved look.
    if (selectedThemeId && !selectedThemeId.startsWith('builtin:')) {
      const nextName = themeName.trim() || themeLibrary.find((item) => item.id === selectedThemeId)?.name || 'Untitled theme'
      const next = themeLibrary.map((item) => item.id === selectedThemeId
        ? { ...item, name: nextName, updatedAt: Date.now(), theme: structuredClone(draftTheme) }
        : item)
      persistLibrary(next)
      setThemeViewState({ selectedId: selectedThemeId, selectedName: nextName })
    }
    persist({ ...overlay, theme: structuredClone(draftTheme) })
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
  const previewText = sampleLength === 'long' ? SAMPLE_TEXT_LONG : SAMPLE_TEXT
  const previewHtml = renderOverlayHTML(theme, SAMPLE_REFERENCE, previewText)

  useLayoutEffect(() => {
    const root = previewInnerRef.current
    if (!root || !theme.layout.autoFitText) return
    applyOverlayAutoFit(root)
  }, [previewHtml, theme.layout.autoFitText])

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

  const hasDraftChanges = JSON.stringify(draftTheme) !== JSON.stringify(overlay.theme)

  return (
    <ResizablePanelGroup orientation="horizontal" className="h-full overflow-hidden">
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
      <aside className="h-full bg-surface-secondary/30 overflow-y-auto p-3">
        <div className="mb-4 flex items-center justify-between gap-2 px-1">
          <div>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.16em]">Themes</p>
            <p className="text-[11px] text-slate-500 mt-0.5">Select to preview</p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="shrink-0 text-slate-400 hover:text-teal-300"
            onClick={saveAsTheme}
            aria-label="Save draft as a new theme"
            title="Save as new theme"
          >
            <Plus size={14} aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-6">
          <div>
            <p className="label">Built in</p>
            <div className="space-y-2">
              {BUILT_IN_THEMES.map((item) => (
                <ThemeTile
                  key={item.id}
                  name={item.name}
                  theme={item.theme}
                  selected={selectedThemeId === `builtin:${item.id}`}
                  onClick={() => selectTheme(`builtin:${item.id}`, item.name, item.theme)}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="label mb-0">My themes</p>
              <span className="text-[10px] text-slate-500 tabular-nums">{themeLibrary.length}</span>
            </div>
            <div className="space-y-2">
              {themeLibrary.map((item) => (
                <ThemeTile
                  key={item.id}
                  name={item.name}
                  theme={item.theme}
                  selected={selectedThemeId === item.id}
                  onClick={() => selectTheme(item.id, item.name, item.theme)}
                  onDelete={() => deleteTheme(item.id, item.name)}
                />
              ))}
              {themeLibrary.length === 0 && <p className="text-xs text-slate-500 py-3">No saved themes yet.</p>}
            </div>
          </div>
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
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Editing theme</p>
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
          <TabsList className="grid h-9 w-full grid-cols-4" aria-label="Theme controls">
            {([
              ['style', 'Style'],
              ['type', 'Type'],
              ['layout', 'Layout'],
              ['output', 'Output'],
            ] as const).map(([id, label]) => (
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

          {/* ── Output mode ─────────────────────────────────────────────────── */}
          {inspectorTab === 'output' && <SectionCard icon={Radio} title="Output mode">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { value: 'auto', label: 'Auto' },
                  { value: 'ndi', label: 'NDI' },
                  { value: 'message', label: 'Message' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setMode(opt.value)}
                  className={cn(
                    'px-2 py-2 rounded-lg border text-center transition-all',
                    overlay.mode === opt.value
                      ? 'bg-teal-500/15 border-teal-500/40 text-teal-300'
                      : 'btn-secondary'
                  )}
                  aria-pressed={overlay.mode === opt.value}
                >
                  <span className="text-xs font-bold">{opt.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-slate-500">
              {overlay.mode === 'auto' && 'Uses NDI when available, then falls back to a ProPresenter message.'}
              {overlay.mode === 'ndi' && 'Always uses the custom rendered NDI output.'}
              {overlay.mode === 'message' && 'Uses ProPresenter’s native message layer.'}
            </p>

            {/* NDI video-input binding — PP hides NDI source names, so the user picks manually */}
            {overlay.mode !== 'message' && (
              <div className="mt-3">
                <label className="label" htmlFor="pa-video-input-picker">ProPresenter video input (NDI)</label>
                <div className="flex items-center gap-2">
                  <select
                    id="pa-video-input-picker"
                    className="input flex-1"
                    value={overlay.ppVideoInputUuid}
                    onChange={(e) => persist({ ...overlay, ppVideoInputUuid: e.target.value })}
                  >
                    <option value="">— not bound —</option>
                    {videoInputs.map((vi) => (
                      <option key={vi.uuid} value={vi.uuid}>{vi.name}</option>
                    ))}
                  </select>
                  <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={refreshVideoInputs}>
                    Refresh
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">
                  Pick the PP Video Input you created for the "ProAutomate Scripture" NDI source.
                  PP labels inputs "Input N" — check PP's Video Inputs list if unsure.
                </p>
              </div>
            )}
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
      <div className="h-full bg-surface-secondary/25 overflow-y-auto">
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
                  NDI sender unavailable — falling back to message overlay when selected in auto/ndi mode.
                </p>
              )}
              {ndiStatus.available && !ndiStatus.ppInputConfigured && (
                <p className="text-[10px] text-yellow-400 flex items-start gap-1.5 leading-relaxed">
                  <AlertCircle size={11} className="shrink-0 mt-0.5" aria-hidden="true" />
                  In ProPresenter: Video Inputs → add NDI source named "ProAutomate Scripture".
                </p>
              )}
            </div>
          </div>

          {/* WYSIWYG preview */}
          <div className="order-1">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest font-sans">Preview</p>
                <p className="text-xs text-slate-400 mt-1">John 3:16 · 1920 × 1080</p>
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
                        sampleLength === len ? 'bg-teal-500/20 text-teal-300' : 'text-slate-500 hover:text-slate-300'
                      )}
                    >
                      {len}
                    </button>
                  ))}
                </div>
                {hasDraftChanges && <span className="text-[10px] font-semibold text-orange-300 bg-orange-400/10 px-2 py-1 rounded-md">Unapplied changes</span>}
              </div>
            </div>
            <div
              ref={previewFrameRef}
              className="relative isolate aspect-video w-full overflow-hidden rounded-xl border border-surface-border/50 bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#0d0d0d_0%_50%)] bg-[length:16px_16px]"
            >
              <div
                ref={previewInnerRef}
                className="pointer-events-none absolute left-0 top-0 origin-top-left"
                style={{
                  width: 1920,
                  height: 1080,
                  transform: `scale(${previewScale})`,
                }}
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
              <OverlayCanvas
                theme={theme}
                selected={selectedLayer}
                onSelect={setSelectedLayer}
                onBoxChange={updateBox}
              />
            </div>
            <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
              Drag the verse or reference on the canvas. Resize from the corners. Turn on Fit text to box so long passages stay inside the frame.
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
              onClick={() => setDraftTheme(structuredClone(overlay.theme))}
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
  selected,
  onClick,
  onDelete,
}: {
  name: string
  theme: OverlayTheme
  selected: boolean
  onClick: () => void
  onDelete?: () => void
}): React.ReactElement {
  const html = renderOverlayHTML(normalizeOverlayTheme(theme), 'John 3:16', 'For God so loved the world…')
  const frameRef = useRef<HTMLSpanElement>(null)
  const [scale, setScale] = useState(0.08)
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const update = (): void => setScale(scaleToFit(frame.clientWidth, 1920))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])
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
        <span ref={frameRef} className="relative block aspect-video w-full overflow-hidden rounded-md bg-surface-tertiary">
          <span
            className="absolute left-0 top-0 block"
            style={{ width: 1920, height: 1080, transform: `scale(${scale})`, transformOrigin: 'top left' }}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </span>
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
            'absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1 text-zinc-300 opacity-0 backdrop-blur-sm transition-opacity hover:bg-rose-950/80 hover:text-rose-300 group-hover:opacity-100 focus-visible:opacity-100',
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
