import { useCallback, useEffect, useMemo, useState } from 'react'
import { SegmentedControl } from '@/components/shared/SegmentedControl'
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
import { FieldRow, LookFields, NdiSoundField, ScreenSourceFields } from './RenderedOutputFields'
import { LooksGrid } from './LooksGrid'
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
import { assignThemeToOutput, normalizeThemeLibrary, themesForKind } from '@shared/theme-library'
import { bindingForDisplay, describeDisplay, resolveDisplay } from '@shared/displays'
import { propresenterEnabled } from '@shared/pp-connect-gate'
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
  PPLook,
  PPVideoInputInfo,
} from '@shared/ipc'
import { ArrangementCanvas, type CanvasBinding } from './ArrangementCanvas'
import { DisplayPicker, useDisplays, type DisplayBound } from './displays'

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
const PROPRESENTER_KEY = 'integration:propresenter'
const CHECK_KEY = 'show:check'
const LOOKS_KEY = 'show:looks'

type Status = { tone: 'live' | 'warn' | 'off'; text: string }

const KIND_TITLE: Record<OverlayOutputKind, string> = {
  screen: 'Kairo screen',
  ndi: 'NDI feed',
  library: 'Library match',
  message: 'Message layer',
  stage: 'Stage message',
}

/** What a ProPresenter output sends — shown on its Output tab. */
const KIND_ABOUT: Record<'library' | 'message' | 'stage', string> = {
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

  const [tab, setTab] = useState<DetailTab>('display')

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

  const rendered = outputs.filter((o) => o.kind === 'screen' || o.kind === 'ndi')
  const toggleLook = (id: string, key: keyof OutputShowFilter, on: boolean): void =>
    updateOutput(id, (o) => ({ ...o, show: { ...o.show, [key]: on } }))
  const canvas = (
    <div className="h-52 overflow-hidden rounded-lg bg-surface-secondary">
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
    <div className="flex h-full w-full flex-col bg-surface text-slate-200">
      <header className="flex h-11 shrink-0 items-center gap-3 bg-surface-secondary px-4" data-settings-drag>
        <h1 className="text-[13px] font-semibold text-white">Screens</h1>
        <div className="flex-1" />
        <TestButtons />
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
          aria-label="Close screens"
        >
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[240px_minmax(0,1fr)]">
        <nav className="flex min-h-0 flex-col overflow-y-auto bg-surface-secondary px-2 py-2" aria-label="Screens">
          <SidebarSection title="Audience" add={[{ label: 'Add screen', onSelect: () => addOutput('screen') }]}>
            {screens.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail={o.source === 'playlist' ? 'Own playlist' : describeBinding(o, displays)}
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
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
              />
            ))}
            {stages.length === 0 && <EmptyRow label="Add a stage display" onClick={addStage} />}
          </SidebarSection>

          <SidebarSection
            title="Feeds"
            add={feeds.length < MAX_NDI_OUTPUTS ? [{ label: 'Add NDI feed', onSelect: () => addOutput('ndi') }] : undefined}
          >
            {feeds.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail="NDI"
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
              />
            ))}
            {feeds.length === 0 && <EmptyRow label="Add an NDI feed" onClick={() => addOutput('ndi')} />}
          </SidebarSection>

          <div className="flex-1" />

          <SidebarSection title="Show">
            <SidebarRow name="Looks" selected={selected === LOOKS_KEY} onSelect={() => setSelected(LOOKS_KEY)} />
            <SidebarRow name="Transition" detail={presentation.transition.kind === 'fade' ? `Fade · ${(presentation.transition.durationMs / 1000).toFixed(2)} s` : 'Cut'} selected={selected === TRANSITION_KEY} onSelect={() => setSelected(TRANSITION_KEY)} />
            <SidebarRow name="Setup check" selected={selected === CHECK_KEY} onSelect={() => setSelected(CHECK_KEY)} />
          </SidebarSection>

          <SidebarSection
            title="ProPresenter"
            add={ppEnabled ? [
              { label: 'Library match', onSelect: () => addOutput('library') },
              { label: 'Message layer', onSelect: () => addOutput('message') },
              { label: 'Stage message', onSelect: () => addOutput('stage') },
            ] : undefined}
          >
            <SidebarRow
              name="Connection"
              detail={!ppEnabled ? 'Off' : ppConnected ? 'Connected' : 'Not connected'}
              status={{ tone: !ppEnabled ? 'off' : ppConnected ? 'live' : 'warn', text: !ppEnabled ? 'Off' : ppConnected ? 'Connected' : 'Not connected' }}
              selected={selected === PROPRESENTER_KEY}
              onSelect={() => setSelected(PROPRESENTER_KEY)}
            />
            {ppEnabled && ppOutputs.map((o) => (
              <SidebarRow
                key={o.id}
                name={o.name}
                detail={o.fallbackOnly ? `${KIND_TITLE[o.kind]} · last resort` : KIND_TITLE[o.kind]}
                status={outputStatus(o)}
                enabled={o.enabled}
                selected={selected === o.id}
                onSelect={() => setSelected(o.id)}
              />
            ))}
          </SidebarSection>
        </nav>

        <main className="min-h-0 min-w-0 overflow-hidden bg-surface">
          {selected === LOOKS_KEY && (
            <Page title="Looks" about="Which layers each screen and feed shows. Untick Backgrounds on a pastor’s screen to show the same words on black, and tick Countdown and Stage message to add them.">
              <LooksGrid outputs={rendered} onToggle={toggleLook} onSelect={setSelected} />
            </Page>
          )}
          {selected === TRANSITION_KEY && (
            <Page title="Transition" about="How one slide changes to the next on every screen and feed.">
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
                ? 'Kairo can also push to ProPresenter: match presentations in its library, write to its Messages layer, and send stage messages. Add those with + next to ProPresenter.'
                : 'Optional. Kairo runs its own screens and does not need ProPresenter.'}
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
          {selectedOutput && (
            <OutputDetail
              key={selectedOutput.id}
              output={selectedOutput}
              status={outputStatus(selectedOutput)}
              resolution={selectedOutput.kind === 'screen' ? describeBinding(selectedOutput, displays) : null}
              canvas={canvas}
              displays={displays}
              others={othersOnDisplays(selectedOutput.id)}
              themeLibrary={themeLibrary}
              looks={looks}
              videoInputs={videoInputs}
              ppEnabled={ppEnabled}
              ppConnected={ppConnected}
              tab={tab}
              onTab={setTab}
              onRefreshPp={refreshPp}
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
          {selected === null && (
            <Page title="Displays" about="Select a screen on the left, then click a display to put it there.">
              {canvas}
            </Page>
          )}
        </main>
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

function SectionLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
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
      <div className="flex h-7 items-center justify-between px-2.5">
        <SectionLabel>{title}</SectionLabel>
        {add && add.length === 1 && (
          <button
            type="button"
            className="grid h-5 w-5 place-items-center rounded text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
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
                className="grid h-5 w-5 place-items-center rounded text-slate-500 hover:bg-surface-tertiary hover:text-slate-200"
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
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-slate-500 hover:bg-surface-tertiary hover:text-slate-300"
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
}: {
  name: string
  detail?: string
  status?: Status
  enabled?: boolean
  selected: boolean
  onSelect: () => void
}): React.ReactElement {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left focus-visible:outline-none',
          selected ? 'row-selected' : 'hover:bg-surface-tertiary',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[12px]', enabled === false ? 'text-slate-500' : 'text-slate-200')}>{name}</span>
          {detail && <span className="block truncate text-[10px] text-slate-500">{detail}</span>}
        </span>
        {status && (
          <span title={status.text}>
            <StatusDot tone={status.tone} />
          </span>
        )}
      </button>
    </li>
  )
}

// ─── Centre pages ─────────────────────────────────────────────────────────────

function Page({ title, about, children }: { title: string; about: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] space-y-4 px-8 py-6">
        <div>
          <h2 className="text-[18px] font-semibold text-white">{title}</h2>
          <p className="mt-1 text-[12px] text-slate-500">{about}</p>
        </div>
        {children}
      </div>
    </div>
  )
}

/** ProPresenter outputs: what goes across the wire. Kairo-rendered outputs preview on their Theme tab. */
function OutputPreview({ output }: { output: OverlayOutput & { kind: 'library' | 'message' | 'stage' } }): React.ReactElement {
  return (
    <div className="space-y-3">
      <SectionLabel>What gets sent</SectionLabel>
      {output.kind === 'library' ? (
        <p className="rounded-lg bg-surface-secondary p-4 text-[12px] text-slate-400">
          Kairo looks for a presentation named like the verse — “John 3:16” — and triggers it. There is
          nothing to style here; the presentation’s own theme is used.
        </p>
      ) : (
        <pre className="whitespace-pre-wrap rounded-lg bg-surface-secondary p-4 font-sans text-[13px] leading-relaxed text-slate-200">
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

// ─── Detail pages ─────────────────────────────────────────────────────────────

type DetailTab = 'display' | 'look' | 'theme' | 'sound' | 'text' | 'propresenter' | 'layout' | 'output'

const TAB_LABEL: Record<DetailTab, string> = {
  display: 'Display',
  look: 'Look',
  theme: 'Theme',
  sound: 'Sound',
  text: 'Text',
  propresenter: 'ProPresenter',
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
  children: (tab: DetailTab) => React.ReactNode
}): React.ReactElement {
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  const active = tabs.includes(tab) ? tab : tabs[0]
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-start gap-3 px-8 pt-6">
        <div className="min-w-0 flex-1">
          <input
            className="w-full bg-transparent text-[20px] font-semibold text-white outline-none focus:underline"
            value={draft}
            aria-label="Name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft.trim() && draft !== name && onRename(draft.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <p className="mt-0.5 text-[12px] text-slate-500">
            {[...new Set([resolution ?? kind, status.tone === 'live' ? null : status.text])].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Switch checked={enabled} onCheckedChange={onToggle} aria-label={`Turn ${name} on or off`} />
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-surface-tertiary hover:text-red-400"
          aria-label={`Remove ${name}`}
          title="Remove"
          onClick={onRemove}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
      {tabs.length > 1 && (
        <SegmentedControl
          role="tablist"
          label="Settings"
          value={active}
          options={tabs.map((t) => ({ value: t, label: TAB_LABEL[t] }))}
          onChange={onTab}
          className="mx-8 mt-4 w-fit shrink-0 bg-surface-secondary"
          itemClassName="px-3.5"
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel">
        <div className="max-w-[720px] space-y-6 px-8 py-6">{children(active)}</div>
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
    <FieldRow
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
    </FieldRow>
  )
}

function OutputDetail({
  output,
  status,
  resolution,
  canvas,
  displays,
  others,
  themeLibrary,
  looks,
  videoInputs,
  ppEnabled,
  ppConnected,
  tab,
  onTab,
  onRefreshPp,
  onChange,
  onRemove,
}: {
  output: OverlayOutput
  status: Status
  resolution: string | null
  canvas: React.ReactNode
  displays: DisplayInfo[]
  others: CanvasBinding[]
  themeLibrary: CustomOverlayTheme[]
  looks: PPLook[]
  videoInputs: PPVideoInputInfo[]
  ppEnabled: boolean
  ppConnected: boolean
  tab: DetailTab
  onTab: (tab: DetailTab) => void
  onRefreshPp: () => void
  onChange: (patch: Partial<OverlayOutput> | ((o: OverlayOutput) => OverlayOutput)) => void
  onRemove: () => void
}): React.ReactElement {
  const templated = output.kind === 'message' || output.kind === 'stage'
  const tabs: DetailTab[] =
    output.kind === 'screen'
      ? ['display', 'look', 'theme']
      : output.kind === 'ndi'
        ? ['look', 'theme', 'sound', ...(ppEnabled ? (['propresenter'] as const) : [])]
        : ['output', ...(templated ? (['text'] as const) : []), 'propresenter']

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
    >
      {(active) => (
        <>
          {active === 'display' && (
            <>
              {canvas}
              <div className="max-w-[560px] space-y-3">
                <FieldRow label="Output" htmlFor={`${output.id}-display`}>
                  <DisplayPicker id={`${output.id}-display`} target={output} displays={displays} others={others} onChange={(patch) => onChange(patch)} />
                </FieldRow>
                <ScreenSourceFields output={output} onChange={onChange} />
              </div>
            </>
          )}
          {active === 'look' && (
            <div className="max-w-sm space-y-3">
              {output.kind === 'screen' && output.displayId === null && (
                <p className="rounded-lg bg-surface-secondary px-3 py-2 text-[12px] text-slate-300">
                  Nothing shows until this screen is on a display.{' '}
                  <button type="button" className="text-white underline underline-offset-2" onClick={() => onTab('display')}>
                    Choose one
                  </button>
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
          {active === 'output' && (output.kind === 'library' || output.kind === 'message' || output.kind === 'stage') && (
            <OutputPreview output={output as OverlayOutput & { kind: 'library' | 'message' | 'stage' }} />
          )}
          {active === 'text' && (
            <>
              <FieldRow label="Scripture" htmlFor={`${output.id}-template`} hint="Tokens: {Reference} and {Text}.">
                <TemplateArea id={`${output.id}-template`} value={output.template} onCommit={(template) => onChange({ template })} />
              </FieldRow>
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
                <FieldRow label="Lyrics" htmlFor={`${output.id}-lyrics-template`}>
                  <TemplateArea
                    id={`${output.id}-lyrics-template`}
                    value={output.lyrics.template}
                    onCommit={(template) => onChange((o) => withContentPatch(o, 'lyrics', { template }))}
                  />
                </FieldRow>
              )}
            </>
          )}
          {active === 'propresenter' && (
            <>
              {output.kind === 'ndi' && (
                <FieldRow
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
                </FieldRow>
              )}
              <LookSelect output={output} looks={looks} ppConnected={ppConnected} onRefresh={onRefreshPp} onChange={(lookId) => onChange({ lookId })} />
              {(output.kind === 'library' || output.kind === 'message') && (
                <label className="flex items-start gap-2 text-[11px] leading-snug text-slate-400">
                  <input type="checkbox" className="mt-0.5 accent-teal-500" checked={output.fallbackOnly} onChange={(e) => onChange({ fallbackOnly: e.target.checked })} />
                  Last resort — only when no other screen took the slide
                </label>
              )}
            </>
          )}
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
    >
      {(active) =>
        active === 'display' ? (
          <>
            {canvas}
            <div className="max-w-[560px]">
              <FieldRow label="Output" htmlFor={`${stage.id}-display`}>
                <DisplayPicker id={`${stage.id}-display`} target={stage} displays={displays} others={others} onChange={onChange} />
              </FieldRow>
            </div>
          </>
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
