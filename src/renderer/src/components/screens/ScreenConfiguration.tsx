import { useEffect, useMemo, useRef, useState } from 'react'
import { MacTrafficLights } from '@/components/shared/MacTrafficLights'
import { PRODUCT_NAME } from '@shared/brand'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
import { RowContextMenu } from '@/components/shared/RowContextMenu'
import { saveOutputSettings } from '@/lib/output-settings'
import type { OutputEdit } from '@shared/output-settings'
import { Check, Loader, Plus, Trash2, X, XCircle } from '@/icons'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScaledOverlayPreview } from '@/components/overlay/ScaledOverlayPreview'
import SetupChecklist from '@/components/theme/SetupChecklist'
import { TransitionPanel } from '@/components/theme/PresentationPanels'
import { FieldRow, FitField, LookFields, NdiSoundField, ScreenSourceFields } from './RenderedOutputFields'
import { LooksGrid } from './LooksGrid'
import { useSettings } from '@/hooks/useSettings'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { makeOverlayOutput } from '@shared/overlay-defaults'
import {
  isLocalKind,
  isRenderedKind,
  OVERLAY_OUTPUT_KINDS,
  MAX_NDI_OUTPUTS,
  MAX_SYPHON_OUTPUTS,
  outputThemeFor,
  setContentOverride,
} from '@shared/overlay-outputs'
import { renderOverlayHTML } from '@shared/overlay-template'
import { assignThemeToOutput, normalizeThemeLibrary, themesForKind, withDefaultThemes } from '@shared/theme-library'
import { bindingForDisplay, describeDisplay, resolveDisplay } from '@shared/displays'
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type OutputShowFilter,
  type StageDisplayConfig,
  type StageDisplayStatus,
} from '@shared/program'
import type {
  CustomOverlayTheme,
  DisplayInfo,
  NdiStatus,
  OverlayOutput,
  OverlayOutputKind,
} from '@shared/ipc'
import { ArrangementCanvas, type CanvasBinding } from './ArrangementCanvas'
import { DisplayPicker, useDisplays, type DisplayBound } from './displays'
import { VideoConnectorTile, VideoDeviceFields } from './VideoDeviceFields'
import type { VideoDeviceSnapshot } from '@shared/video-devices'

const IS_MAC = navigator.platform.startsWith('Mac')

// ─── Screens ──────────────────────────────────────────────────────────────────
// Where things go, kept apart from how they look. Modelled on ProPresenter's
// Screen Configuration: destinations on the left grouped by who sees them, one
// detail page on the right. Themes are only *chosen* here; they are designed
// on the Theme page.

const SAMPLE_REFERENCE = 'John 3:16 (KJV)'
const SAMPLE_TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'

const STAGE_PREFIX = 'stage:'
const TRANSITION_KEY = 'show:transition'
const CHECK_KEY = 'show:check'
const LOOKS_KEY = 'show:looks'
/** One page for what applies to every screen: looks, transition, setup check. */
const SHOW_KEY = 'show:setup'
const isShowPage = (key: string | null): boolean =>
  key === SHOW_KEY || key === LOOKS_KEY || key === TRANSITION_KEY || key === CHECK_KEY

type Status = { tone: 'live' | 'warn' | 'off'; text: string }

const KIND_TITLE: Record<OverlayOutputKind, string> = {
  screen: 'Kairo screen',
  device: 'Video card',
  ndi: 'NDI feed',
  syphon: 'Syphon',
}

export default function ScreenConfiguration({
  initialSelect,
  onClose,
}: {
  initialSelect: string | null
  onClose: () => void
}): React.ReactElement {
  const overlay = useBootstrapStore((s) => s.settings.overlay)
  const [saveError, setSaveError] = useState('')
  const [presentation, savePresentation] = useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
  const rawLibrary = useBootstrapStore((s) => s.settings.themeLibrary)
  const themeLibrary = useMemo(
    () => normalizeThemeLibrary(rawLibrary, overlay.theme),
    [rawLibrary, overlay.theme],
  )
  const displays = useDisplays()
  const ndiStatus = useNdiStatus()
  const devices = useVideoDevices()
  const stageStatus = useStageStatus(presentation.stageDisplays.length)
  const outputs = overlay.outputs
  const stages = presentation.stageDisplays
  const screens = outputs.filter((o) => o.kind === 'screen')
  const cards = outputs.filter((o) => o.kind === 'device')
  const feeds = outputs.filter((o) => o.kind === 'ndi')
  const syphons = outputs.filter((o) => o.kind === 'syphon')
  /** The only audience output left: it can't be deleted. */
  const lastAudience = outputs.filter((o) => isRenderedKind(o.kind)).length <= 1

  // Opened on: an item id, `kind:<kind>` (that kind's first output), `add:<kind>`
  // (a new one, made on open), or nothing — the first output or stage display,
  // and with nothing set up yet, the welcome pane.
  const [selected, setSelected] = useState<string | null>(() => {
    if (initialSelect?.startsWith('kind:')) return outputs.find((o) => o.kind === initialSelect.slice(5))?.id ?? null
    if (initialSelect?.startsWith('add:')) return null
    return initialSelect
      ?? outputs.find((o) => isRenderedKind(o.kind))?.id
      ?? (stages[0] ? STAGE_PREFIX + stages[0].id : null)
  })

  const [tab, setTab] = useState<DetailTab>('display')

  const selectedOutput = outputs.find((o) => o.id === selected) ?? null
  const selectedStage = selected?.startsWith(STAGE_PREFIX)
    ? stages.find((s) => STAGE_PREFIX + s.id === selected) ?? null
    : null

  // ─── Writes ─────────────────────────────────────────────────────────────────

  const setOutputs = (edit: OutputEdit): void => {
    setSaveError('')
    void saveOutputSettings(edit).catch(() => setSaveError('Screen changes could not be saved. Please try again.'))
  }
  const updateOutput = (id: string, patch: Partial<OverlayOutput> | ((o: OverlayOutput) => OverlayOutput)): void => {
    setOutputs((current) => current.map((o) => (o.id === id ? (typeof patch === 'function' ? patch(o) : { ...o, ...patch }) : o)))
  }
  /** A group switch: every listed output on or off in one save. */
  const setGroupEnabled = (ids: string[], enabled: boolean): void => {
    const pick = new Set(ids)
    setOutputs((current) => current.map((o) => (pick.has(o.id) ? { ...o, enabled } : o)))
  }
  const setStages = (next: StageDisplayConfig[]): void => {
    setSaveError('')
    void savePresentation({ ...useBootstrapStore.getState().settings.presentation, stageDisplays: next })
      .catch(() => setSaveError('Stage display changes could not be saved. Please try again.'))
  }
  const updateStage = (id: string, patch: Partial<StageDisplayConfig>): void => {
    setStages(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addOutput = (kind: OverlayOutputKind): void => {
    const id = `${kind}-${Date.now().toString(36)}`
    const current = useBootstrapStore.getState().settings.overlay.outputs
    const count = current.filter((o) => o.kind === kind).length
    setOutputs((latest) => [
      ...latest,
      withDefaultThemes(
        makeOverlayOutput(id, kind, {
          name: count === 0 ? KIND_TITLE[kind] : `${KIND_TITLE[kind]} ${count + 1}`,
          enabled: true,
          order: latest.length,
        }),
        themeLibrary,
        useBootstrapStore.getState().settings.themeDefaults,
      ),
    ])
    setSelected(id)
  }
  // Opened from "Set up Syphon for OBS…" and the like: make the output now —
  // once, even though React runs mount effects twice in development.
  const addedOnOpen = useRef(false)
  useEffect(() => {
    if (addedOnOpen.current) return
    addedOnOpen.current = true
    const kind = initialSelect?.startsWith('add:') ? initialSelect.slice(4) : null
    if (kind && OVERLAY_OUTPUT_KINDS.includes(kind as OverlayOutputKind)) addOutput(kind as OverlayOutputKind)
  }, [])

  const addStage = (): void => {
    const id = `stage-${Date.now().toString(36)}`
    setStages([
      ...stages,
      {
        id,
        name: stages.length === 0 ? 'Stage display' : `Stage display ${stages.length + 1}`,
        enabled: true,
        displayId: null,
        displayLabel: '',
        displaySize: null,
        showNext: true,
        showClock: true,
        showTimer: true,
      },
    ])
    setSelected(STAGE_PREFIX + id)
  }
  const removeScreen = (key: string): void => {
    const settings = useBootstrapStore.getState().settings
    const output = settings.overlay.outputs.find((o) => o.id === key)
    const stage = key.startsWith(STAGE_PREFIX)
      ? settings.presentation.stageDisplays.find((s) => STAGE_PREFIX + s.id === key) : undefined
    const target = output ?? stage
    if (!target) return
    // Audience always keeps one screen, as in ProPresenter.
    if (output && isRenderedKind(output.kind) && settings.overlay.outputs.filter((o) => isRenderedKind(o.kind)).length <= 1) {
      setSaveError('Audience needs at least one screen. Add another before deleting this one.')
      return
    }
    if (!window.confirm(`Delete “${target.name}”?`)) return
    if (output) {
      setOutputs((current) => current.filter((o) => o.id !== output.id))
    } else if (stage) {
      setStages(settings.presentation.stageDisplays.filter((s) => s.id !== stage.id))
    }
    if (selected === key) setSelected(null)
  }
  const removeSelected = (): void => { if (selected) removeScreen(selected) }

  // ─── Status ─────────────────────────────────────────────────────────────────

  const outputStatus = (o: OverlayOutput): Status => {
    if (!o.enabled) return { tone: 'off', text: 'Off' }
    const s = ndiStatus.outputs.find((x) => x.id === o.id)
    if (!s) return { tone: 'warn', text: 'Checking…' }
    if (!s.ready) return { tone: 'warn', text: s.reason ?? 'Not ready' }
    // A lobby screen or card on its own playlist is doing exactly what it was set to do.
    if (isLocalKind(o.kind) && o.source === 'playlist') return { tone: 'live', text: 'Playing its own playlist' }
    if (s.reason && s.reason !== 'Live') return { tone: 'warn', text: s.reason }
    return { tone: 'live', text: o.kind === 'screen' ? 'Live' : 'Ready' }
  }
  const stageDisplayStatus = (s: StageDisplayConfig): Status => {
    if (!s.enabled) return { tone: 'off', text: 'Off' }
    const st = stageStatus.find((x) => x.id === s.id)
    if (!st) return { tone: 'warn', text: 'Checking…' }
    if (st.ready && st.reason === 'Live') return { tone: 'live', text: 'Live' }
    return { tone: 'warn', text: st.reason }
  }

  // ─── Displays ───────────────────────────────────────────────────────────────

  const bindings: CanvasBinding[] = [
    ...outputs
      .filter((o) => o.kind === 'screen')
      .map((o) => ({ key: o.id, role: 'Audience' as const, name: o.name, enabled: o.enabled, displayId: o.displayId, displayLabel: o.displayLabel, displaySize: o.displaySize })),
    ...stages.map((s) => ({ key: STAGE_PREFIX + s.id, role: 'Stage' as const, name: s.name, enabled: s.enabled, displayId: s.displayId, displayLabel: s.displayLabel, displaySize: s.displaySize })),
  ]
  const othersOnDisplays = (key: string): CanvasBinding[] => bindings.filter((b) => b.enabled && b.key !== key)
  const canBind = !!selectedStage || selectedOutput?.kind === 'screen'
  const bindTo = (display: DisplayInfo): void => {
    const key = selected ?? ''
    const owner = othersOnDisplays(key).find((b) => b.displayId === display.id)
    if (owner) {
      window.alert(`${owner.name} is already on that display. Move it first.`)
      return
    }
    if (selectedStage) updateStage(selectedStage.id, bindingForDisplay(display))
    else if (selectedOutput) updateOutput(selectedOutput.id, bindingForDisplay(display))
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const rendered = outputs.filter((o) => isRenderedKind(o.kind))
  const toggleLook = (id: string, key: keyof OutputShowFilter, on: boolean): void =>
    updateOutput(id, (o) => ({ ...o, show: { ...o.show, [key]: on } }))
  const canvas = (
    <div className="h-48 overflow-hidden rounded-md">
      <ArrangementCanvas
        displays={displays}
        bindings={bindings}
        selectedKey={selected}
        canBind={canBind}
        onPickDisplay={bindTo}
      />
    </div>
  )

  return (
    // Laid out like macOS System Settings: the window controls top the glass
    // sidebar, and the open item's own header titles the solid pane beside it.
    <div className="relative flex h-full w-full text-slate-200">
        <div className="glass hairline-r flex w-[232px] min-h-0 shrink-0 flex-col" data-settings-drag>
        {IS_MAC && <MacTrafficLights onClose={onClose} className="px-[18px] pb-1 pt-[18px]" />}
        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-3 pt-1" aria-label="Screens">
          {/* Audience destinations include screens, video cards and independent NDI feeds. */}
          <SidebarSection
            title="Audience"
            on={rendered.some((o) => o.enabled)}
            onToggle={rendered.length ? (on) => setGroupEnabled(rendered.map((o) => o.id), on) : undefined}
            add={[
              { label: 'Screen', onSelect: () => addOutput('screen') },
              ...(feeds.length < MAX_NDI_OUTPUTS ? [{ label: 'NDI feed', onSelect: () => addOutput('ndi') }] : []),
              // Syphon shares frames with other apps on this Mac (OBS, Resolume…), so Macs only.
              ...(IS_MAC && syphons.length < MAX_SYPHON_OUTPUTS ? [{ label: 'Syphon', onSelect: () => addOutput('syphon') }] : []),
              // Offered only once a video card driver is built in; outputs already
              // saved stay listed so they can be removed.
              ...(devices?.providers.length ? [{ label: 'Video card', onSelect: () => addOutput('device') }] : []),
            ]}
          >
            {screens.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail={o.source === 'playlist' ? 'Own playlist' : describeBinding(o, displays)}
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
                onRemove={lastAudience ? undefined : () => removeScreen(o.id)}
              />
            ))}
            {cards.map((output) => (
              <SidebarRow key={output.id} name={output.name} detail={describeCard(output, devices) ?? 'Video card'}
                status={outputStatus(output)} enabled={output.enabled} selected={selected === output.id}
                onSelect={() => setSelected(output.id)} onRemove={lastAudience ? undefined : () => removeScreen(output.id)} />
            ))}
            {feeds.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail="NDI"
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
                onRemove={lastAudience ? undefined : () => removeScreen(o.id)}
              />
            ))}
            {syphons.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail="Syphon"
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
                onRemove={lastAudience ? undefined : () => removeScreen(o.id)}
              />
            ))}
            {rendered.length === 0 && (
              <EmptySection
                title="No audience screens yet"
                hint="A projector or TV, a video card, an NDI feed or Syphon."
                action="Add a screen"
                onAction={() => addOutput('screen')}
              />
            )}
          </SidebarSection>

          <SidebarSection
            title="Stage"
            on={stages.some((st) => st.enabled)}
            onToggle={stages.length ? (on) => setStages(stages.map((st) => ({ ...st, enabled: on }))) : undefined}
            add={[{ label: 'Add stage display', onSelect: addStage }]}
          >
            {stages.map((s) => (
              <SidebarRow
                key={s.id}
                name={s.name}
                detail={describeBinding(s, displays)}
                status={stageDisplayStatus(s)}
                enabled={s.enabled}
                selected={selected === STAGE_PREFIX + s.id}
                onSelect={() => setSelected(STAGE_PREFIX + s.id)}
                onRemove={() => removeScreen(STAGE_PREFIX + s.id)}
              />
            ))}
          </SidebarSection>

        </nav>
        <SidebarFooter showOpen={isShowPage(selected)} onShow={() => setSelected(SHOW_KEY)} />
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface">
          {saveError && <p role="alert" className="shrink-0 px-6 pt-3 text-[12px] text-red-400">{saveError}</p>}
          {isShowPage(selected) && (
            <Page title="Looks & transition" about="What applies across every screen: which layers each one shows, how slides change, and a check of everything a push depends on.">
              <div className="space-y-2">
                <h3 className="text-[13px] font-semibold text-white">Looks</h3>
                <p className="text-[12px] text-slate-500">Untick Backgrounds on a pastor’s screen to show the same words on black; tick Countdown and Stage message to add them.</p>
                <LooksGrid outputs={rendered} onToggle={toggleLook} onSelect={setSelected} />
              </div>
              <div className="space-y-2 pt-2">
                <h3 className="text-[13px] font-semibold text-white">Transition</h3>
                <TransitionPanel />
              </div>
              <div className="space-y-2 pt-2">
                <h3 className="text-[13px] font-semibold text-white">Setup check</h3>
                <SetupCheck ndiStatus={ndiStatus} outputs={outputs} />
              </div>
            </Page>
          )}
          {selectedOutput && (
            <OutputDetail
              key={selectedOutput.id}
              output={selectedOutput}
              status={outputStatus(selectedOutput)}
              resolution={selectedOutput.kind === 'screen' ? describeBinding(selectedOutput, displays)
                : selectedOutput.kind === 'device' ? describeCard(selectedOutput, devices) : null}
              canvas={canvas}
              displays={displays}
              devices={devices}
              others={othersOnDisplays(selectedOutput.id)}
              themeLibrary={themeLibrary}
              tab={tab}
              onTab={setTab}
              onChange={(patch) => updateOutput(selectedOutput.id, patch)}
              onRemove={removeSelected}
            />
          )}
          {selectedStage && (
            <StageDetail
              key={selectedStage.id}
              stage={selectedStage}
              status={stageDisplayStatus(selectedStage)}
              resolution={describeBinding(selectedStage, displays)}
              canvas={canvas}
              displays={displays}
              others={othersOnDisplays(STAGE_PREFIX + selectedStage.id)}
              tab={tab}
              onTab={setTab}
              onChange={(patch) => updateStage(selectedStage.id, patch)}
              onRemove={removeSelected}
            />
          )}
        </main>
        {!IS_MAC && (
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
            aria-label="Close screens"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
    </div>
  )
}

// ─── Data ─────────────────────────────────────────────────────────────────────

function useVideoDevices(): VideoDeviceSnapshot | null {
  const [snapshot, setSnapshot] = useState<VideoDeviceSnapshot | null>(null)
  useEffect(() => {
    let active = true
    // A pushed snapshot is newer than the initial fetch, whichever resolves first.
    let pushed = false
    const unsubscribe = window.api.videoDevices.onChanged((next) => {
      pushed = true
      if (active) setSnapshot(next)
    })
    window.api.videoDevices.status().then((next) => {
      if (active && !pushed) setSnapshot(next)
    }).catch(() => {
      if (active && !pushed) setSnapshot({ ports: [], providers: [{ name: 'hardware', available: false, reason: 'Could not read video device status' }], outputs: {} })
    })
    let polling = false
    const timer = setInterval(() => {
      if (polling) return
      polling = true
      void window.api.videoDevices.status().then((next) => {
        if (active) setSnapshot(next)
      }).catch(() => undefined).finally(() => { polling = false })
    }, 1000)
    return () => { active = false; clearInterval(timer); unsubscribe() }
  }, [])
  return snapshot
}

function useNdiStatus(): NdiStatus {
  const [status, setStatus] = useState<NdiStatus>({ available: false, sending: false, outputs: [] })
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      window.api.ndi
        .getStatus()
        .then((next) => {
          if (!cancelled) setStatus((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        })
        .catch(() => undefined)
    }
    poll()
    const id = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])
  return status
}

/** Stage-display status: fetched once, then pushed by main whenever it changes. */
function useStageStatus(count: number): StageDisplayStatus[] {
  const [status, setStatus] = useState<StageDisplayStatus[]>([])
  useEffect(() => {
    if (count === 0) return
    let cancelled = false
    window.api.program
      .stageStatus()
      .then((next) => {
        if (!cancelled) setStatus(next)
      })
      .catch(() => undefined)
    const unsubscribe = window.api.program.onStageStatus(setStatus)
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [count])
  return status
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

/**
 * A sidebar group the way ProPresenter's Screen Configuration draws it: a band
 * across the sidebar with a bold title, an optional switch for the whole group
 * (every screen in it on or off), and ＋ on the right; its rows below.
 */
function SidebarSection({
  title,
  add,
  on,
  onToggle,
  children,
}: {
  title: string
  add?: Array<{ label: string; onSelect: () => void; disabled?: boolean }>
  /** Whether any screen in the group is on; with `onToggle`, shows the group switch. */
  on?: boolean
  onToggle?: (on: boolean) => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="pb-2">
      <div className="-mx-2.5 flex h-10 items-center gap-2.5 bg-surface-tertiary/50 px-3">
        {onToggle && (
          <Switch checked={!!on} onCheckedChange={onToggle} aria-label={`Turn all ${title} screens on or off`} />
        )}
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white">{title}</h2>
        {add && add.length === 1 && (
          <button
            type="button"
            className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-surface-elevated hover:text-white"
            aria-label={add[0].label}
            title={add[0].label}
            onClick={add[0].onSelect}
          >
            <Plus size={16} aria-hidden="true" />
          </button>
        )}
        {add && add.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-surface-elevated hover:text-white"
                aria-label={`Add to ${title}`}
              >
                <Plus size={16} aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {add.map((item) => (
                <DropdownMenuItem key={item.label} disabled={item.disabled} onSelect={item.onSelect}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <ul className="space-y-0.5 pt-2">{children}</ul>
    </section>
  )
}

/** Placeholder row for an empty section — the obvious next step, not a blank. */
/** An empty sidebar group: what goes here, and the obvious first one to add. */
function EmptySection({
  title,
  hint,
  action,
  onAction,
}: {
  title: string
  hint: string
  action: string
  onAction: () => void
}): React.ReactElement {
  return (
    <li className="flex flex-col items-center gap-1 px-3 pb-3 pt-4 text-center">
      <p className="text-[12px] font-medium text-slate-300">{title}</p>
      <p className="text-[11px] leading-snug text-slate-500">{hint}</p>
      <button type="button" className="btn-secondary mt-2 flex items-center gap-1 px-2.5 py-1 text-[12px]" onClick={onAction}>
        <Plus size={12} aria-hidden="true" /> {action}
      </button>
    </li>
  )
}

/** "EPSON PJ · 1920×1080", or why there is no display yet. */
function describeBinding(target: DisplayBound, displays: DisplayInfo[]): string {
  if (target.displayId === null) return 'No display chosen'
  const display = resolveDisplay(target, displays)
  return display ? describeDisplay(display) : `${target.displayLabel || 'Display'} · not connected`
}

function StatusDot({ tone }: { tone: Status['tone'] }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-1.5 w-1.5 shrink-0 rounded-full',
        tone === 'live' ? 'bg-live' : tone === 'warn' ? 'bg-slate-400' : 'bg-slate-700',
      )}
    />
  )
}

function SidebarRow({
  name,
  detail,
  status,
  enabled,
  selected,
  onSelect,
  onRemove,
}: {
  name: string
  detail?: string
  status?: Status
  enabled?: boolean
  selected: boolean
  onSelect: () => void
  onRemove?: () => void
}): React.ReactElement {
  const button = (
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left focus-visible:outline-none',
          // Picked is the blue accent pill; red is kept for what is on screen.
          selected ? 'bg-teal-500' : 'hover:bg-surface-tertiary',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px] font-semibold',
            selected ? 'text-on-accent' : enabled === false ? 'text-slate-500' : 'text-white')}>{name}</span>
          {detail && <span className={cn('block truncate text-[11px]', selected ? 'text-teal-100' : 'text-slate-500')}>{detail}</span>}
        </span>
        {status && (
          <span title={status.text}>
            <StatusDot tone={status.tone} />
          </span>
        )}
      </button>
  )
  return <li>{onRemove ? (
    <RowContextMenu items={[{ label: 'Delete', icon: <Trash2 size={14} aria-hidden="true" />, destructive: true, onSelect: onRemove }]}>
      {button}
    </RowContextMenu>
  ) : button}</li>
}

// ─── Centre pages ─────────────────────────────────────────────────────────────

function Page({ title, about, children }: { title: string; about: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] space-y-4 px-8 py-6">
        <div data-settings-drag>
          <h2 className="text-[18px] font-semibold text-white">{title}</h2>
          <p className="mt-1 text-[12px] text-slate-500">{about}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

function SetupCheck({
  ndiStatus,
  outputs,
}: {
  ndiStatus: NdiStatus
  outputs: OverlayOutput[]
}): React.ReactElement {
  const test = useTestPush()
  return (
    <SetupChecklist
      ndiStatus={ndiStatus}
      outputs={outputs}
      onSendTest={test.send}
      testStatus={test.status}
      testMsg={test.message}
    />
  )
}

// ─── Test push ────────────────────────────────────────────────────────────────

function useTestPush(): {
  status: 'idle' | 'testing' | 'ok' | 'fail'
  message: string
  send: () => void
  clear: () => void
} {
  const [status, setStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [message, setMessage] = useState('')
  const run = (label: string, call: () => Promise<boolean>, ok: string, fail: string): void => {
    setStatus('testing')
    setMessage(label)
    call()
      .then((result) => {
        setStatus(result ? 'ok' : 'fail')
        setMessage(result ? ok : fail)
      })
      .catch((err: unknown) => {
        setStatus('fail')
        setMessage(err instanceof Error ? err.message : 'Unknown error')
      })
  }
  return {
    status,
    message,
    send: () => run('Sending…', () => window.api.output.sendTest(), 'Test verse sent', 'Nothing took the test verse'),
    clear: () => run('Clearing…', () => window.api.output.clearAll(), 'Cleared', 'Clear failed'),
  }
}

/** Pinned under the list, like ProPresenter's Identify Screens / Test Patterns. */
function SidebarFooter({ showOpen, onShow }: { showOpen: boolean; onShow: () => void }): React.ReactElement {
  const test = useTestPush()
  return (
    <div className="hairline-t shrink-0">
      {test.status !== 'idle' && (
        <p
          role="status"
          className={cn(
            'flex items-center gap-1.5 px-3 pt-2.5 text-[12px]',
            test.status === 'testing' && 'text-slate-400',
            test.status === 'ok' && 'text-teal-400',
            test.status === 'fail' && 'text-red-400',
          )}
        >
          {test.status === 'testing' && <Loader size={12} className="animate-spin" aria-hidden="true" />}
          {test.status === 'ok' && <Check size={12} aria-hidden="true" />}
          {test.status === 'fail' && <XCircle size={12} aria-hidden="true" />}
          <span className="truncate">{test.message}</span>
        </p>
      )}
      {/* Looks, transition and the setup check for every screen, on one page. */}
      <button
        type="button"
        aria-current={showOpen ? 'page' : undefined}
        className={cn(
          'flex w-full items-center px-3 py-2.5 text-left text-[13px]',
          showOpen ? 'bg-teal-500 text-on-accent' : 'text-slate-200 hover:bg-surface-tertiary/50',
        )}
        onClick={onShow}
      >
        Looks & transition
      </button>
      {/* As in ProPresenter: a plain row to identify displays, then the test button. */}
      <button
        type="button"
        className="flex w-full items-center px-3 py-2.5 text-left text-[13px] text-slate-200 hover:bg-surface-tertiary/50"
        title="Show each display's number on it"
        onClick={() => void window.api.displays.identify()}
      >
        Identify screens
      </button>
      <div className="hairline-t flex gap-1.5 px-3 py-2.5">
        <button type="button" className="btn-secondary flex-1 whitespace-nowrap px-2 py-1 text-[12px]" onClick={test.send} disabled={test.status === 'testing'}>
          Test verse
        </button>
        <button type="button" className="btn-secondary whitespace-nowrap px-3 py-1 text-[12px]" onClick={test.clear} disabled={test.status === 'testing'}>
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Detail pages ─────────────────────────────────────────────────────────────

/** "DeckLink Duo (2) · 1080i50" — the connector and its format, like a screen's size. */
function describeCard(output: OverlayOutput, devices: VideoDeviceSnapshot | null): string | null {
  const port = devices?.ports.find((candidate) => candidate.id === output.devicePortId)
  const mode = port?.modes.find((candidate) => candidate.id === output.deviceModeId)
  const name = port?.portName ?? output.devicePortLabel
  return name ? [name, mode?.label].filter(Boolean).join(' · ') : null
}

type DetailTab = 'display' | 'hardware' | 'look' | 'theme' | 'sound' | 'text' | 'layout' | 'output'

const TAB_LABEL: Record<DetailTab, string> = {
  display: 'Display',
  hardware: 'Hardware',
  look: 'Look',
  theme: 'Theme',
  sound: 'Sound',
  text: 'Text',
  layout: 'Layout',
  output: 'Output',
}

/** Big name and size like ProPresenter, with on/off and remove beside it, then the tabs. */
function Detail({
  name,
  kind,
  resolution,
  status,
  enabled,
  tabs,
  tab,
  onTab,
  onRename,
  onToggle,
  onRemove,
  stage,
  children,
}: {
  name: string
  kind: string
  resolution: string | null
  status: Status
  enabled: boolean
  tabs: DetailTab[]
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onRename: (name: string) => void
  onToggle: (enabled: boolean) => void
  onRemove: () => void
  /** The darker band under the header — the display canvas, or a video card's connector. */
  stage?: React.ReactNode
  children: (tab: DetailTab) => React.ReactNode
}): React.ReactElement {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const active = tabs.includes(tab) ? tab : tabs[0]
  const tabbed = tabs.length > 1
  return (
    // ProPresenter's layout: a header band, the display canvas as a full-width
    // dark band, then the settings in a bordered box with the tabs on its edge.
    <div className="flex h-full flex-col bg-surface">
      <div className="hairline-b flex shrink-0 items-center gap-3 px-6 pb-3.5 pt-4" data-settings-drag>
        <div className="min-w-0 flex-1">
          <input
            className="-mx-1.5 block max-w-full rounded-md bg-transparent px-1.5 text-[17px] font-semibold leading-tight text-white outline-none [field-sizing:content] hover:bg-surface-secondary focus:bg-surface-secondary"
            value={draft}
            aria-label="Name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft.trim() && draft !== name && onRename(draft.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <p className="mt-0.5 text-[12px] text-slate-400">
            {[...new Set([resolution ?? kind, status.tone === 'live' ? null : status.text])].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Turn ${name} on or off`} />
        <button
          type="button"
          className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-surface-tertiary hover:text-red-400"
          aria-label={`Remove ${name}`}
          title="Remove"
          onClick={onRemove}
        >
          <Trash2 size={15} aria-hidden="true" />
        </button>
      </div>
      {stage && <div className="hairline-b shrink-0 bg-surface-stage px-6 py-5">{stage}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-6 pb-6 pt-6">
          <div className={cn('relative rounded-lg border border-surface-border px-5 pb-5', tabbed ? 'mt-3 pt-9' : 'pt-5')}>
            {tabbed && (
              <SegmentedControl
                role="tablist"
                label="Settings"
                value={active}
                options={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
                onChange={onTab}
                fit
                className="absolute -top-4 left-1/2 w-fit max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-x-auto bg-surface-tertiary"
                itemClassName="px-3.5 py-1.5"
                selectedClassName="bg-surface-elevated text-white"
              />
            )}
            <div className="space-y-4" role="tabpanel">{children(active)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ThemeSelects({
  output,
  themeLibrary,
  onChange,
}: {
  output: OverlayOutput
  themeLibrary: CustomOverlayTheme[]
  onChange: (patch: (o: OverlayOutput) => OverlayOutput) => void
}): React.ReactElement {
  const scripture = themesForKind(themeLibrary, 'scripture')
  const lyrics = themesForKind(themeLibrary, 'lyrics')
  const lyricsValue = output.lyrics ? (output.lyrics.themeId ?? 'custom') : 'same'
  return (
    <>
      <FieldRow label="Scripture" htmlFor={`${output.id}-scripture-theme`}>
        <select
          id={`${output.id}-scripture-theme`}
          className="input w-full"
          value={output.themeId ?? ''}
          onChange={(e) => {
            const found = scripture.find((t) => t.id === e.target.value)
            onChange((o) => (found ? assignThemeToOutput(o, found) : { ...o, themeId: null }))
          }}
        >
          <option value="">Custom</option>
          {scripture.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </FieldRow>
      <FieldRow label="Lyrics" htmlFor={`${output.id}-lyrics-theme`}>
        <select
          id={`${output.id}-lyrics-theme`}
          className="input w-full"
          value={lyricsValue}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'same') return onChange((o) => setContentOverride(o, 'lyrics', false))
            const found = lyrics.find((t) => t.id === value)
            if (found) onChange((o) => assignThemeToOutput(o, found))
          }}
        >
          <option value="same">Same as scripture</option>
          {output.lyrics && !output.lyrics.themeId && <option value="custom">Custom</option>}
          {lyrics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </FieldRow>
      <p className="pl-[136px] text-[11px] leading-snug text-slate-500">Design themes on the Theme page.</p>
    </>
  )
}

function OutputDetail({
  output,
  status,
  resolution,
  canvas,
  displays,
  devices,
  others,
  themeLibrary,
  tab,
  onTab,
  onChange,
  onRemove,
}: {
  output: OverlayOutput
  status: Status
  resolution: string | null
  canvas: React.ReactNode
  displays: DisplayInfo[]
  devices: VideoDeviceSnapshot | null
  others: CanvasBinding[]
  themeLibrary: CustomOverlayTheme[]
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onChange: (patch: Partial<OverlayOutput> | ((o: OverlayOutput) => OverlayOutput)) => void
  onRemove: () => void
}): React.ReactElement {
  const tabs: DetailTab[] =
    output.kind === 'device'
      ? ['hardware', 'look', 'theme']
      : output.kind === 'screen'
      ? ['display', 'look', 'theme']
      : output.kind === 'ndi'
        ? ['look', 'theme', 'sound']
        : ['look', 'theme']

  return (
    <Detail
      name={output.name}
      kind={KIND_TITLE[output.kind]}
      resolution={resolution}
      status={status}
      enabled={output.enabled}
      tabs={tabs}
      tab={tab}
      onTab={onTab}
      onRename={(name) => onChange({ name })}
      onToggle={(enabled) => onChange({ enabled })}
      onRemove={onRemove}
      stage={output.kind === 'screen' ? canvas
        : output.kind === 'device' && devices ? <VideoConnectorTile output={output} snapshot={devices} /> : undefined}
    >
      {(active) => (
        <>
          {active === 'display' && (
            // Where it goes and its shape, then what it shows — two columns, as in ProPresenter.
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <FieldRow label="Output" htmlFor={`${output.id}-display`}>
                <DisplayPicker id={`${output.id}-display`} target={output} displays={displays} others={others} onChange={(patch) => onChange(patch)} />
              </FieldRow>
              {output.source === 'playlist' ? <div /> : <FitField output={output} onChange={onChange} />}
              <ScreenSourceFields output={output} onChange={onChange} fit={false} />
            </div>
          )}
          {active === 'hardware' && (
            <div className="max-w-[560px]">
              {devices
                ? <VideoDeviceFields output={output} snapshot={devices} onChange={onChange}
                    onRefresh={async () => {
                      await window.api.videoDevices.listPorts()
                      return window.api.videoDevices.status()
                    }}
                    source={<ScreenSourceFields output={output} onChange={onChange} />} />
                : <p role="status" className="text-[12px] text-slate-400">Checking video devices…</p>}
            </div>
          )}
          {active === 'look' && (
            <div className="max-w-[560px] space-y-4">
              {output.kind === 'screen' && output.displayId === null && (
                <p className="rounded-lg bg-surface-secondary px-3 py-2 text-[12px] text-slate-300">
                  Nothing shows until this screen is on a display.{' '}
                  <button type="button" className="text-white underline underline-offset-2" onClick={() => onTab('display')}>
                    Choose one
                  </button>
                </p>
              )}
              {output.kind === 'syphon' && (
                <p className="rounded-lg bg-surface px-3 py-2 text-[12px] leading-relaxed text-slate-300">
                  In OBS, add a <span className="font-medium text-white">Syphon Client</span> source and pick{' '}
                  <span className="font-medium text-white">{PRODUCT_NAME} {output.name}</span>. Turn on its transparency
                  option to put the words over your camera.
                </p>
              )}
              <LookFields output={output} onChange={onChange} />
              <p className="text-[11px] leading-snug text-slate-500">
                These let a screen show the countdown, clock and stage message. You put them up from Operator → Timers.
              </p>
            </div>
          )}
          {active === 'theme' && (
            <>
              <ThemePreview output={output} />
              <div className="max-w-[560px] space-y-3">
                <ThemeSelects output={output} themeLibrary={themeLibrary} onChange={onChange} />
              </div>
            </>
          )}
          {active === 'sound' && <NdiSoundField />}
        </>
      )}
    </Detail>
  )
}

function ThemePreview({ output }: { output: OverlayOutput }): React.ReactElement {
  const theme = outputThemeFor(output, 'scripture')
  const html = useMemo(() => renderOverlayHTML(theme, SAMPLE_REFERENCE, SAMPLE_TEXT), [theme])
  return (
    <div className="overflow-hidden rounded-lg bg-black">
      <ScaledOverlayPreview html={html} autoFit={theme.layout.autoFitText} />
    </div>
  )
}

function StageDetail({
  stage,
  status,
  resolution,
  canvas,
  displays,
  others,
  tab,
  onTab,
  onChange,
  onRemove,
}: {
  stage: StageDisplayConfig
  status: Status
  resolution: string
  canvas: React.ReactNode
  displays: DisplayInfo[]
  others: CanvasBinding[]
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onChange: (patch: Partial<StageDisplayConfig>) => void
  onRemove: () => void
}): React.ReactElement {
  return (
    <Detail
      name={stage.name}
      kind="Stage display"
      resolution={resolution}
      status={status}
      enabled={stage.enabled}
      tabs={['display', 'layout']}
      tab={tab}
      onTab={onTab}
      onRename={(name) => onChange({ name })}
      onToggle={(enabled) => onChange({ enabled })}
      onRemove={onRemove}
      stage={canvas}
    >
      {(active) =>
        active === 'display' ? (
          <div className="max-w-[560px]">
            <FieldRow label="Output" htmlFor={`${stage.id}-display`}>
              <DisplayPicker id={`${stage.id}-display`} target={stage} displays={displays} others={others} onChange={onChange} />
            </FieldRow>
          </div>
        ) : (
          <div className="max-w-sm space-y-1">
            {([
              ['showNext', 'Next slide'],
              ['showClock', 'Clock'],
              ['showTimer', 'Countdown'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center justify-between rounded-md px-2 py-1.5 text-[12px] text-slate-300 hover:bg-surface-tertiary">
                {label}
                <Switch checked={stage[key]} onCheckedChange={(on) => onChange({ [key]: on })} aria-label={label} />
              </label>
            ))}
            <p className="px-2 pt-2 text-[11px] leading-snug text-slate-500">
              The current slide and stage messages always show.
            </p>
          </div>
        )
      }
    </Detail>
  )
}
