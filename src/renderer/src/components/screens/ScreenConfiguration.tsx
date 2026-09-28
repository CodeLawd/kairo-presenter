import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Loader, Plus, Send, Trash2, X, XCircle } from '@/icons'
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
import { NdiSoundField, ScreenSourceFields, ShowFilterFields } from './RenderedOutputFields'
import { useSettings } from '@/hooks/useSettings'
import { useAppStore } from '@/stores/useAppStore'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { DEFAULT_OVERLAY_SETTINGS, makeOverlayOutput } from '@shared/overlay-defaults'
import {
  MAX_NDI_OUTPUTS,
  outputTemplateFor,
  outputThemeFor,
  setContentOverride,
  withContentPatch,
} from '@shared/overlay-outputs'
import { renderOverlayHTML } from '@shared/overlay-template'
import { normalizeThemeLibrary, themesForKind } from '@shared/theme-library'
import { bindingForDisplay, describeDisplay, resolveDisplay } from '@shared/displays'
import { propresenterEnabled } from '@shared/pp-connect-gate'
import {
  DEFAULT_PRESENTATION_SETTINGS,
  type StageDisplayConfig,
  type StageDisplayStatus,
} from '@shared/program'
import type {
  CustomOverlayTheme,
  DisplayInfo,
  NdiStatus,
  OverlayOutput,
  OverlayOutputKind,
  PPLook,
  PPVideoInputInfo,
} from '@shared/ipc'
import { ArrangementCanvas, type CanvasBinding } from './ArrangementCanvas'
import { DisplayPicker, useDisplays, type DisplayBound } from './displays'

// ─── Screens ──────────────────────────────────────────────────────────────────
// Where things go, kept apart from how they look. Modelled on ProPresenter's
// Screen Configuration: a list of destinations on the left grouped by who sees
// them, the physical displays in the middle, and one inspector on the right.
// Themes are only *chosen* here; they are designed on the Theme page.

const SAMPLE_REFERENCE = 'John 3:16 (KJV)'
const SAMPLE_TEXT =
  'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.'

const STAGE_PREFIX = 'stage:'
const TRANSITION_KEY = 'show:transition'
const PROPRESENTER_KEY = 'integration:propresenter'
const CHECK_KEY = 'show:check'

type Status = { tone: 'live' | 'warn' | 'off'; text: string }

const KIND_TITLE: Record<OverlayOutputKind, string> = {
  screen: 'Kairo screen',
  ndi: 'NDI feed',
  library: 'Library match',
  message: 'Message layer',
  stage: 'Stage message',
}

const KIND_ABOUT: Record<OverlayOutputKind, string> = {
  screen: 'Kairo draws the slide full screen on a display connected to this computer.',
  ndi: 'Kairo renders the slide and sends it over the network as the “Kairo Scripture” NDI source.',
  library: 'Triggers a presentation with the same name in your ProPresenter library.',
  message: 'Sends text to ProPresenter’s Messages layer. ProPresenter styles it; its Looks decide which screens show it.',
  stage: 'Plain text to ProPresenter stage screens whose layout includes a Message field.',
}

export default function ScreenConfiguration({
  initialSelect,
  onClose,
}: {
  initialSelect: string | null
  onClose: () => void
}): React.ReactElement {
  const [overlay, saveOverlay] = useSettings('overlay', DEFAULT_OVERLAY_SETTINGS)
  const [presentation, savePresentation] = useSettings('presentation', DEFAULT_PRESENTATION_SETTINGS)
  const rawLibrary = useBootstrapStore((s) => s.settings.themeLibrary)
  const themeLibrary = useMemo(
    () => normalizeThemeLibrary(rawLibrary, overlay.theme),
    [rawLibrary, overlay.theme],
  )
  const ppEnabled = useBootstrapStore((s) => propresenterEnabled(s.settings))
  const ppConnected = useAppStore((s) => s.ppState === 'connected') && ppEnabled
  const displays = useDisplays()
  const ndiStatus = useNdiStatus()
  const stageStatus = useStageStatus(presentation.stageDisplays.length)
  const [looks, setLooks] = useState<PPLook[]>([])
  const [videoInputs, setVideoInputs] = useState<PPVideoInputInfo[]>([])
  const refreshPp = useCallback((): void => {
    window.api.propresenter.getLooks().then(setLooks).catch(() => setLooks([]))
    window.api.ndi.getVideoInputs().then(setVideoInputs).catch(() => setVideoInputs([]))
  }, [])
  useEffect(() => {
    if (ppConnected) refreshPp()
  }, [ppConnected, refreshPp])

  const outputs = overlay.outputs
  const stages = presentation.stageDisplays
  const screens = outputs.filter((o) => o.kind === 'screen')
  const feeds = outputs.filter((o) => o.kind === 'ndi')
  const ppOutputs = outputs.filter((o) => o.kind === 'library' || o.kind === 'message' || o.kind === 'stage')

  const [selected, setSelected] = useState<string | null>(
    () => initialSelect ?? screens[0]?.id ?? feeds[0]?.id ?? (stages[0] ? STAGE_PREFIX + stages[0].id : TRANSITION_KEY),
  )

  const selectedOutput = outputs.find((o) => o.id === selected) ?? null
  const selectedStage = selected?.startsWith(STAGE_PREFIX)
    ? stages.find((s) => STAGE_PREFIX + s.id === selected) ?? null
    : null

  // ─── Writes ─────────────────────────────────────────────────────────────────

  const setOutputs = (next: OverlayOutput[]): void => {
    void saveOverlay({ ...overlay, outputs: next }).catch((err) => console.error(err))
  }
  const updateOutput = (id: string, patch: Partial<OverlayOutput> | ((o: OverlayOutput) => OverlayOutput)): void => {
    setOutputs(outputs.map((o) => (o.id === id ? (typeof patch === 'function' ? patch(o) : { ...o, ...patch }) : o)))
  }
  const setStages = (next: StageDisplayConfig[]): void => {
    void savePresentation({ ...presentation, stageDisplays: next }).catch((err) => console.error(err))
  }
  const updateStage = (id: string, patch: Partial<StageDisplayConfig>): void => {
    setStages(stages.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addOutput = (kind: OverlayOutputKind): void => {
    const id = `${kind}-${Date.now().toString(36)}`
    const count = outputs.filter((o) => o.kind === kind).length
    setOutputs([
      ...outputs,
      makeOverlayOutput(id, kind, {
        name: count === 0 ? KIND_TITLE[kind] : `${KIND_TITLE[kind]} ${count + 1}`,
        enabled: true,
        order: outputs.length,
      }),
    ])
    setSelected(id)
  }
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
  const removeSelected = (): void => {
    if (selectedOutput) {
      if (!window.confirm(`Remove “${selectedOutput.name}”?`)) return
      setOutputs(outputs.filter((o) => o.id !== selectedOutput.id))
    } else if (selectedStage) {
      if (!window.confirm(`Remove “${selectedStage.name}”?`)) return
      setStages(stages.filter((s) => s.id !== selectedStage.id))
    }
    setSelected(null)
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  const outputStatus = (o: OverlayOutput): Status => {
    if (!o.enabled) return { tone: 'off', text: 'Off' }
    const s = ndiStatus.outputs.find((x) => x.id === o.id)
    if (!s) return { tone: 'warn', text: 'Checking…' }
    if (!s.ready) return { tone: 'warn', text: s.reason ?? 'Not ready' }
    // A lobby screen on its own playlist is doing exactly what it was set to do.
    if (o.kind === 'screen' && o.source === 'playlist') return { tone: 'live', text: 'Playing its own playlist' }
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

  const showCanvas = selected === null || !!selectedStage || selectedOutput?.kind === 'screen'

  return (
    <div className="flex h-full w-full flex-col bg-surface text-slate-200">
      {/* Title bar */}
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-surface-border bg-surface-secondary px-4" data-settings-drag>
        <h1 className="text-[13px] font-semibold text-white">Screens</h1>
        <span className="text-[11px] text-slate-500">Where slides go. How they look is set in Theme.</span>
        <div className="flex-1" />
        <TestButtons />
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
          aria-label="Close screens"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[232px_minmax(0,1fr)_320px]">
        {/* Sidebar — Kairo's own outputs first; ProPresenter is one row under Integrations. */}
        <nav className="flex min-h-0 flex-col overflow-y-auto border-r border-surface-border bg-surface-secondary py-2" aria-label="Screens">
          <SidebarSection title="Screens" add={[{ label: 'Add screen', onSelect: () => addOutput('screen') }]}>
            {screens.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail={o.source === 'playlist' ? 'Own playlist' : describeBinding(o, displays)}
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
                onToggle={(enabled) => updateOutput(o.id, { enabled })}
              />
            ))}
            {screens.length === 0 && <EmptyRow label="Add a screen" onClick={() => addOutput('screen')} />}
          </SidebarSection>

          <SidebarSection title="Stage" add={[{ label: 'Add stage display', onSelect: addStage }]}>
            {stages.map((s) => (
              <SidebarRow
                key={s.id}
                name={s.name}
                detail={describeBinding(s, displays)}
                status={stageDisplayStatus(s)}
                enabled={s.enabled}
                selected={selected === STAGE_PREFIX + s.id}
                onSelect={() => setSelected(STAGE_PREFIX + s.id)}
                onToggle={(enabled) => updateStage(s.id, { enabled })}
              />
            ))}
            {stages.length === 0 && <EmptyRow label="Add a stage display" onClick={addStage} />}
          </SidebarSection>

          <SidebarSection
            title="Streaming"
            add={feeds.length < MAX_NDI_OUTPUTS ? [{ label: 'Add NDI feed', onSelect: () => addOutput('ndi') }] : undefined}
          >
            {feeds.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail="NDI feed"
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
                onToggle={(enabled) => updateOutput(o.id, { enabled })}
              />
            ))}
            {feeds.length === 0 && <EmptyRow label="Add an NDI feed" onClick={() => addOutput('ndi')} />}
          </SidebarSection>

          <SidebarSection title="Show">
            <SidebarRow name="Transition" detail={presentation.transition.kind === 'fade' ? `Fade · ${(presentation.transition.durationMs / 1000).toFixed(2)} s` : 'Cut'} selected={selected === TRANSITION_KEY} onSelect={() => setSelected(TRANSITION_KEY)} />
            <SidebarRow name="Setup check" detail="What is and is not ready" selected={selected === CHECK_KEY} onSelect={() => setSelected(CHECK_KEY)} />
          </SidebarSection>

          <div className="flex-1" />

          <SidebarSection
            title="Integrations"
            add={ppEnabled ? [
              { label: 'Library match', onSelect: () => addOutput('library') },
              { label: 'Message layer', onSelect: () => addOutput('message') },
              { label: 'Stage message', onSelect: () => addOutput('stage') },
            ] : undefined}
          >
            <SidebarRow
              name="ProPresenter"
              detail={!ppEnabled ? 'Off' : ppConnected ? 'Connected' : 'Not connected'}
              status={{ tone: !ppEnabled ? 'off' : ppConnected ? 'live' : 'warn', text: !ppEnabled ? 'Off' : ppConnected ? 'Connected' : 'Not connected' }}
              selected={selected === PROPRESENTER_KEY}
              onSelect={() => setSelected(PROPRESENTER_KEY)}
            />
            {ppEnabled && ppOutputs.map((o) => (
              <SidebarRow
                key={o.id}
                indent
                name={o.name}
                detail={o.fallbackOnly ? `${KIND_TITLE[o.kind]} · last resort` : KIND_TITLE[o.kind]}
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
                onToggle={(enabled) => updateOutput(o.id, { enabled })}
              />
            ))}
          </SidebarSection>
        </nav>

        {/* Centre */}
        <main className="min-h-0 min-w-0 overflow-y-auto bg-surface">
          {selected === TRANSITION_KEY && (
            <Page title="Transition" about="How one slide changes to the next on screens, stage displays and the NDI feed.">
              <TransitionPanel />
            </Page>
          )}
          {selected === CHECK_KEY && (
            <Page title="Setup check" about="Everything a push depends on, in one place.">
              <SetupCheck ndiStatus={ndiStatus} outputs={outputs} looks={looks} ppEnabled={ppEnabled} ppConnected={ppConnected} />
            </Page>
          )}
          {selected === PROPRESENTER_KEY && (
            <Page
              title="ProPresenter"
              about={ppEnabled
                ? 'Kairo can also push to ProPresenter: match presentations in its library, write to its Messages layer, and send stage messages. Add those with + next to Integrations.'
                : 'Optional. Kairo runs its own screens and does not need ProPresenter. Turn the integration on if you also want to push to a ProPresenter machine.'}
            >
              <button
                type="button"
                className="btn-secondary text-[12px]"
                onClick={() => {
                  onClose()
                  useAppStore.getState().openSettings('propresenter')
                }}
              >
                {ppEnabled ? 'ProPresenter settings' : 'Turn on in Settings'}
              </button>
            </Page>
          )}
          {showCanvas && (
            <div className="flex h-full flex-col">
              <SectionLabel className="px-5 pt-4">Displays</SectionLabel>
              <p className="px-5 pt-1 text-[11px] text-slate-500">
                {canBind ? 'Click a display to put the selected screen on it.' : 'Select a screen to place it on a display.'}
              </p>
              <div className="min-h-0 flex-1">
                <ArrangementCanvas
                  displays={displays}
                  bindings={bindings}
                  selectedKey={selected}
                  canBind={canBind}
                  onPickDisplay={bindTo}
                />
              </div>
            </div>
          )}
          {selectedOutput && selectedOutput.kind !== 'screen' && (
            <OutputPreview output={selectedOutput} />
          )}
        </main>

        {/* Inspector */}
        <aside className="min-h-0 overflow-y-auto border-l border-surface-border bg-surface-secondary">
          {selectedOutput && (
            <OutputInspector
              key={selectedOutput.id}
              output={selectedOutput}
              status={outputStatus(selectedOutput)}
              displays={displays}
              others={othersOnDisplays(selectedOutput.id)}
              themeLibrary={themeLibrary}
              looks={looks}
              videoInputs={videoInputs}
              ppEnabled={ppEnabled}
              ppConnected={ppConnected}
              onRefreshPp={refreshPp}
              onChange={(patch) => updateOutput(selectedOutput.id, patch)}
              onRemove={removeSelected}
            />
          )}
          {selectedStage && (
            <StageInspector
              key={selectedStage.id}
              stage={selectedStage}
              status={stageDisplayStatus(selectedStage)}
              displays={displays}
              others={othersOnDisplays(STAGE_PREFIX + selectedStage.id)}
              onChange={(patch) => updateStage(selectedStage.id, patch)}
              onRemove={removeSelected}
            />
          )}
          {!selectedOutput && !selectedStage && (
            <p className="p-5 text-[12px] text-slate-500">Select a screen to see its settings.</p>
          )}
        </aside>
      </div>
    </div>
  )
}

// ─── Data ─────────────────────────────────────────────────────────────────────

function useNdiStatus(): NdiStatus {
  const [status, setStatus] = useState<NdiStatus>({ available: false, sending: false, ppInputConfigured: false, outputs: [] })
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

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }): React.ReactElement {
  return (
    <p className={cn('text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500', className)}>
      {children}
    </p>
  )
}

function SidebarSection({
  title,
  add,
  children,
}: {
  title: string
  add?: Array<{ label: string; onSelect: () => void; disabled?: boolean }>
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="pb-3">
      <div className="flex h-7 items-center justify-between px-3">
        <SectionLabel>{title}</SectionLabel>
        {add && add.length === 1 && (
          <button
            type="button"
            className="grid h-5 w-5 place-items-center text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
            aria-label={add[0].label}
            title={add[0].label}
            onClick={add[0].onSelect}
          >
            <Plus size={12} aria-hidden="true" />
          </button>
        )}
        {add && add.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="grid h-5 w-5 place-items-center text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
                aria-label={`Add to ${title}`}
              >
                <Plus size={12} aria-hidden="true" />
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
      <ul>{children}</ul>
    </section>
  )
}

/** Placeholder row for an empty section — the obvious next step, not a blank. */
function EmptyRow({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-slate-500 hover:bg-surface-tertiary hover:text-slate-300"
      >
        <Plus size={11} aria-hidden="true" /> {label}
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
        tone === 'live' ? 'bg-teal-400' : tone === 'warn' ? 'bg-amber-400' : 'bg-slate-600',
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
  indent = false,
  onSelect,
  onToggle,
}: {
  name: string
  detail: string
  status?: Status
  enabled?: boolean
  selected: boolean
  /** Nested under the row above (ProPresenter's outputs under ProPresenter). */
  indent?: boolean
  onSelect: () => void
  onToggle?: (enabled: boolean) => void
}): React.ReactElement {
  return (
    <li
      className={cn(
        'flex cursor-default items-center gap-2 py-1.5 pr-3',
        indent ? 'pl-6' : 'pl-3',
        selected ? 'row-selected' : 'hover:bg-surface-tertiary',
      )}
      onClick={onSelect}
    >
      {onToggle && (
        <input
          type="checkbox"
          className="shrink-0 accent-teal-500"
          checked={!!enabled}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggle(e.target.checked)}
          aria-label={`Turn ${name} ${enabled ? 'off' : 'on'}`}
        />
      )}
      <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none" onClick={onSelect}>
        <span className={cn('block truncate text-[12px]', enabled === false ? 'text-slate-500' : 'text-slate-200')}>{name}</span>
        <span className="block truncate text-[10px] text-slate-500">{detail}</span>
      </button>
      {status && (
        <span title={status.text}>
          <StatusDot tone={status.tone} />
        </span>
      )}
    </li>
  )
}

// ─── Centre pages ─────────────────────────────────────────────────────────────

function Page({ title, about, children }: { title: string; about: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="mx-auto max-w-[560px] space-y-4 p-6">
      <div>
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        <p className="mt-1 text-[12px] text-slate-500">{about}</p>
      </div>
      {children}
    </div>
  )
}

function OutputPreview({ output }: { output: OverlayOutput }): React.ReactElement {
  const rendered = output.kind === 'ndi'
  const html = useMemo(
    () => (rendered ? renderOverlayHTML(outputThemeFor(output, 'scripture'), SAMPLE_REFERENCE, SAMPLE_TEXT) : ''),
    [rendered, output],
  )
  return (
    <div className="space-y-3 p-6">
      <SectionLabel>{rendered ? 'Preview · 1920 × 1080' : 'What gets sent'}</SectionLabel>
      {rendered ? (
        <div className="border border-surface-border bg-black">
          <ScaledOverlayPreview html={html} autoFit={outputThemeFor(output, 'scripture').layout.autoFitText} />
        </div>
      ) : output.kind === 'library' ? (
        <p className="border border-surface-border bg-surface-secondary p-4 text-[12px] text-slate-400">
          Kairo looks for a presentation named like the verse — “John 3:16” — and triggers it. There is
          nothing to style here; the presentation’s own theme is used.
        </p>
      ) : (
        <pre className="whitespace-pre-wrap border border-surface-border bg-surface-secondary p-4 font-sans text-[13px] leading-relaxed text-slate-200">
          {outputTemplateFor(output, 'scripture')
            .replace(/\{Reference\}/g, SAMPLE_REFERENCE)
            .replace(/\{Text\}/g, SAMPLE_TEXT)}
        </pre>
      )}
      <p className="text-[11px] leading-relaxed text-slate-500">{KIND_ABOUT[output.kind]}</p>
    </div>
  )
}

function SetupCheck({
  ndiStatus,
  outputs,
  looks,
  ppEnabled,
  ppConnected,
}: {
  ppEnabled: boolean
  ndiStatus: NdiStatus
  outputs: OverlayOutput[]
  looks: PPLook[]
  ppConnected: boolean
}): React.ReactElement {
  const test = useTestPush()
  return (
    <SetupChecklist
      ppEnabled={ppEnabled}
      ppConnected={ppConnected}
      ndiStatus={ndiStatus}
      outputs={outputs}
      looks={looks}
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

function TestButtons(): React.ReactElement {
  const test = useTestPush()
  return (
    <div className="flex items-center gap-2">
      {test.status !== 'idle' && (
        <span
          className={cn(
            'flex items-center gap-1 text-[11px]',
            test.status === 'testing' && 'text-slate-400',
            test.status === 'ok' && 'text-teal-400',
            test.status === 'fail' && 'text-red-400',
          )}
        >
          {test.status === 'testing' && <Loader size={11} className="animate-spin" aria-hidden="true" />}
          {test.status === 'ok' && <Check size={11} aria-hidden="true" />}
          {test.status === 'fail' && <XCircle size={11} aria-hidden="true" />}
          {test.message}
        </span>
      )}
      <button type="button" className="btn-secondary flex items-center gap-1.5 px-2.5 py-1 text-[11px]" onClick={test.send} disabled={test.status === 'testing'}>
        <Send size={11} aria-hidden="true" /> Test verse
      </button>
      <button type="button" className="btn-secondary px-2.5 py-1 text-[11px]" onClick={test.clear} disabled={test.status === 'testing'}>
        Clear
      </button>
    </div>
  )
}

// ─── Inspector ────────────────────────────────────────────────────────────────

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[11px] font-medium text-slate-400">{label}</label>
      {children}
      {hint && <p className="text-[10px] leading-snug text-slate-500">{hint}</p>}
    </div>
  )
}

function InspectorGroup({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <section className="space-y-3 border-b border-surface-border px-4 py-4">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  )
}

function InspectorHeader({
  name,
  kind,
  status,
  enabled,
  onRename,
  onToggle,
}: {
  name: string
  kind: string
  status: Status
  enabled: boolean
  onRename: (name: string) => void
  onToggle: (enabled: boolean) => void
}): React.ReactElement {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  return (
    <div className="space-y-2 border-b border-surface-border px-4 py-4">
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-white outline-none focus:underline"
          value={draft}
          aria-label="Name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() && draft !== name && onRename(draft.trim())}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Turn ${name} on or off`} />
      </div>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-slate-500">{kind}</span>
        <span className="text-slate-600">·</span>
        <StatusDot tone={status.tone} />
        <span className={status.tone === 'warn' ? 'text-amber-400' : status.tone === 'live' ? 'text-teal-400' : 'text-slate-500'}>
          {status.text}
        </span>
      </div>
    </div>
  )
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }): React.ReactElement {
  return (
    <div className="px-4 py-4">
      <button type="button" className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-red-400" onClick={onRemove}>
        <Trash2 size={12} aria-hidden="true" /> {label}
      </button>
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
      <Field label="Scripture" htmlFor={`${output.id}-scripture-theme`}>
        <select
          id={`${output.id}-scripture-theme`}
          className="input w-full"
          value={output.themeId ?? ''}
          onChange={(e) => {
            const found = scripture.find((t) => t.id === e.target.value)
            onChange((o) => (found ? { ...o, themeId: found.id, theme: structuredClone(found.theme) } : { ...o, themeId: null }))
          }}
        >
          <option value="">Custom (applied from Theme)</option>
          {scripture.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Lyrics" htmlFor={`${output.id}-lyrics-theme`}>
        <select
          id={`${output.id}-lyrics-theme`}
          className="input w-full"
          value={lyricsValue}
          onChange={(e) => {
            const value = e.target.value
            if (value === 'same') return onChange((o) => setContentOverride(o, 'lyrics', false))
            const found = lyrics.find((t) => t.id === value)
            if (!found) return
            onChange((o) =>
              withContentPatch(setContentOverride(o, 'lyrics', true), 'lyrics', {
                themeId: found.id,
                theme: structuredClone(found.theme),
              }),
            )
          }}
        >
          <option value="same">Same as scripture</option>
          {output.lyrics && !output.lyrics.themeId && <option value="custom">Custom (applied from Theme)</option>}
          {lyrics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <p className="text-[10px] leading-snug text-slate-500">Design themes on the Theme page; pick them here.</p>
    </>
  )
}

function LookSelect({
  output,
  looks,
  ppConnected,
  onRefresh,
  onChange,
}: {
  output: OverlayOutput
  looks: PPLook[]
  ppConnected: boolean
  onRefresh: () => void
  onChange: (lookId: string) => void
}): React.ReactElement {
  return (
    <Field
      label="Trigger Look"
      htmlFor={`${output.id}-look`}
      hint="A Look is whole-system state in ProPresenter — only the first one set across all screens is triggered."
    >
      <div className="flex gap-2">
        <select id={`${output.id}-look`} className="input flex-1" value={output.lookId} onChange={(e) => onChange(e.target.value)} disabled={!ppConnected && looks.length === 0}>
          <option value="">None</option>
          {looks.map((look) => <option key={look.id} value={look.id}>{look.name}</option>)}
          {output.lookId && !looks.some((l) => l.id === output.lookId) && <option value={output.lookId}>Saved Look</option>}
        </select>
        <button type="button" className="btn-secondary px-2 text-[11px]" onClick={onRefresh} disabled={!ppConnected}>Refresh</button>
      </div>
    </Field>
  )
}

function OutputInspector({
  output,
  status,
  displays,
  others,
  themeLibrary,
  looks,
  videoInputs,
  ppEnabled,
  ppConnected,
  onRefreshPp,
  onChange,
  onRemove,
}: {
  output: OverlayOutput
  status: Status
  displays: DisplayInfo[]
  others: CanvasBinding[]
  themeLibrary: CustomOverlayTheme[]
  looks: PPLook[]
  videoInputs: PPVideoInputInfo[]
  ppEnabled: boolean
  ppConnected: boolean
  onRefreshPp: () => void
  onChange: (patch: Partial<OverlayOutput> | ((o: OverlayOutput) => OverlayOutput)) => void
  onRemove: () => void
}): React.ReactElement {
  const rendered = output.kind === 'screen' || output.kind === 'ndi'
  const templated = output.kind === 'message' || output.kind === 'stage'
  const previewHtml = useMemo(
    () => (output.kind === 'screen' ? renderOverlayHTML(outputThemeFor(output, 'scripture'), SAMPLE_REFERENCE, SAMPLE_TEXT) : ''),
    [output],
  )

  return (
    <div>
      <InspectorHeader
        name={output.name}
        kind={KIND_TITLE[output.kind]}
        status={status}
        enabled={output.enabled}
        onRename={(name) => onChange({ name })}
        onToggle={(enabled) => onChange({ enabled })}
      />

      {output.kind === 'screen' && (
        <InspectorGroup title="Display">
          <DisplayPicker
            id={`${output.id}-display`}
            target={output}
            displays={displays}
            others={others}
            onChange={(patch) => onChange(patch)}
          />
          <div className="border border-surface-border bg-black">
            <ScaledOverlayPreview html={previewHtml} autoFit={outputThemeFor(output, 'scripture').layout.autoFitText} />
          </div>
        </InspectorGroup>
      )}

      {output.kind === 'screen' && (
        <InspectorGroup title="Source">
          <ScreenSourceFields output={output} onChange={onChange} />
        </InspectorGroup>
      )}

      {output.kind === 'screen' && (
        <InspectorGroup title="Shows">
          <ShowFilterFields output={output} onChange={onChange} />
        </InspectorGroup>
      )}

      {rendered && (
        <InspectorGroup title="Themes">
          <ThemeSelects output={output} themeLibrary={themeLibrary} onChange={onChange} />
        </InspectorGroup>
      )}

      {output.kind === 'ndi' && (
        <InspectorGroup title="Shows">
          <ShowFilterFields output={output} onChange={onChange} />
        </InspectorGroup>
      )}

      {output.kind === 'ndi' && (
        <InspectorGroup title="Sound">
          <NdiSoundField />
        </InspectorGroup>
      )}

      {/* Only once the integration is on — an NDI feed stands on its own. */}
      {output.kind === 'ndi' && ppEnabled && (
        <InspectorGroup title="ProPresenter">
          <Field
            label="Video input"
            htmlFor={`${output.id}-input`}
            hint="Optional. When set, ProPresenter is switched to this input on every push. PP names inputs “Input N”."
          >
            <div className="flex gap-2">
              <select id={`${output.id}-input`} className="input flex-1" value={output.ppVideoInputUuid} onChange={(e) => onChange({ ppVideoInputUuid: e.target.value })}>
                <option value="">None</option>
                {videoInputs.map((vi) => <option key={vi.uuid} value={vi.uuid}>{vi.name}</option>)}
                {output.ppVideoInputUuid && !videoInputs.some((v) => v.uuid === output.ppVideoInputUuid) && (
                  <option value={output.ppVideoInputUuid}>Saved input</option>
                )}
              </select>
              <button type="button" className="btn-secondary px-2 text-[11px]" onClick={onRefreshPp} disabled={!ppConnected}>Refresh</button>
            </div>
          </Field>
          <LookSelect output={output} looks={looks} ppConnected={ppConnected} onRefresh={onRefreshPp} onChange={(lookId) => onChange({ lookId })} />
        </InspectorGroup>
      )}

      {templated && (
        <InspectorGroup title="Text">
          <Field label="Scripture" htmlFor={`${output.id}-template`} hint="Tokens: {Reference} and {Text}.">
            <TemplateArea id={`${output.id}-template`} value={output.template} onCommit={(template) => onChange({ template })} />
          </Field>
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <input
              type="checkbox"
              className="accent-teal-500"
              checked={!!output.lyrics}
              onChange={(e) => onChange((o) => setContentOverride(o, 'lyrics', e.target.checked))}
            />
            Different text for lyrics
          </label>
          {output.lyrics && (
            <Field label="Lyrics" htmlFor={`${output.id}-lyrics-template`}>
              <TemplateArea
                id={`${output.id}-lyrics-template`}
                value={output.lyrics.template}
                onCommit={(template) => onChange((o) => withContentPatch(o, 'lyrics', { template }))}
              />
            </Field>
          )}
        </InspectorGroup>
      )}

      {(output.kind === 'library' || templated) && (
        <InspectorGroup title="ProPresenter">
          <LookSelect output={output} looks={looks} ppConnected={ppConnected} onRefresh={onRefreshPp} onChange={(lookId) => onChange({ lookId })} />
          {output.kind !== 'stage' && (
            <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-400">
              <input type="checkbox" className="mt-0.5 accent-teal-500" checked={output.fallbackOnly} onChange={(e) => onChange({ fallbackOnly: e.target.checked })} />
              Last resort — only when no other screen took the slide
            </label>
          )}
        </InspectorGroup>
      )}

      <RemoveButton label={`Remove ${KIND_TITLE[output.kind].toLowerCase()}`} onRemove={onRemove} />
    </div>
  )
}

function TemplateArea({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }): React.ReactElement {
  // Local draft, committed on blur: every keystroke would otherwise rewrite
  // the whole overlay settings file.
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <textarea
      id={id}
      className="input min-h-[64px] w-full resize-y font-mono text-[11px]"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  )
}

function StageInspector({
  stage,
  status,
  displays,
  others,
  onChange,
  onRemove,
}: {
  stage: StageDisplayConfig
  status: Status
  displays: DisplayInfo[]
  others: CanvasBinding[]
  onChange: (patch: Partial<StageDisplayConfig>) => void
  onRemove: () => void
}): React.ReactElement {
  return (
    <div>
      <InspectorHeader
        name={stage.name}
        kind="Stage display"
        status={status}
        enabled={stage.enabled}
        onRename={(name) => onChange({ name })}
        onToggle={(enabled) => onChange({ enabled })}
      />
      <InspectorGroup title="Display">
        <DisplayPicker id={`${stage.id}-display`} target={stage} displays={displays} others={others} onChange={onChange} />
      </InspectorGroup>
      <InspectorGroup title="Layout">
        {([
          ['showNext', 'Next slide'],
          ['showClock', 'Clock'],
          ['showTimer', 'Countdown'],
        ] as const).map(([key, label]) => (
          <label key={key} className="flex items-center justify-between text-[12px] text-slate-300">
            {label}
            <Switch checked={stage[key]} onCheckedChange={(on) => onChange({ [key]: on })} aria-label={label} />
          </label>
        ))}
        <p className="text-[10px] leading-snug text-slate-500">
          The slide that is up is always shown. Stage-only messages come from Operator → Timers.
        </p>
      </InspectorGroup>
      <RemoveButton label="Remove stage display" onRemove={onRemove} />
    </div>
  )
}
