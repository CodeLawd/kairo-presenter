import { createAudioCapture } from '@/audio/capture'
import { IMPORT_OPTIONS, isImportKind } from '@shared/import-menu'
import { requestImport } from '@/hooks/useImportRequest'
import Documents from '@/components/documents/Documents'
import { useState, useEffect, useRef, useCallback, type PointerEvent } from 'react'
import { AlertTriangle, RefreshCw, X } from '@/icons'
import AppShell, { WorkspaceRail } from '@/components/layout/AppShell'
import { DesktopTooltip } from '@/components/layout/DesktopTooltip'
import UpdateToast from '@/components/layout/UpdateToast'
import { TransferHost } from '@/components/transfer/TransferHost'
import { TracksPlayer } from '@/components/tracks/TracksPlayer'
import { ProgramAudioFallback } from '@/components/media/ProgramAudioFallback'
import OperatorToolbar from '@/components/operator/OperatorToolbar'
import Scripture from '@/components/scripture/Scripture'
import Lyrics from '@/components/lyrics/Lyrics'
import { SongQuickOpen } from '@/components/lyrics/SongQuickOpen'
import Operator from '@/components/operator/Operator'
import ThemeEditor from '@/components/theme/ThemeEditor'
import Settings from '@/components/settings/Settings'
import { useAppStore, type SettingsSectionId } from '@/stores/useAppStore'
import { useSetlistSync } from '@/stores/useSetlist'
import { useLibrariesSync } from '@/stores/useLibraries'
import { usePassagesSync } from '@/stores/usePassages'
import { LoadingScreen } from '@/bootstrap/LoadingScreen'
import ScreenConfiguration from '@/components/screens/ScreenConfiguration'
import OnboardingWizard from '@/components/onboarding/OnboardingWizard'
import CoachTour, { COACH_TOURS, COACH_TOUR_EVENT, coachTourFor, type CoachStep } from '@/components/onboarding/CoachTour'
import AccountGate from '@/components/account/AccountGate'
import {
  SPLASH_MIN_VISIBLE_MS,
  describeBootstrapWarning,
} from '@/bootstrap/bootstrap-state'
import { hydrateIntegrations, useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import {
  ppLaunchOutcomeFromStatus,
  propresenterEnabled,
  type PpLaunchOutcome,
} from '@shared/pp-connect-gate'
import { shouldOfferOnboarding } from '@shared/cloud/onboarding'
import { shouldOfferAccountGate } from '@shared/cloud/auth-state'
import { useAccountStore } from '@/stores/useAccountStore'

export type NavRoute =
  | 'scripture'
  | 'lyrics'
  | 'operator'
  | 'theme'
  | 'documents'

/**
 * One silent handshake per renderer session. Shared so Strict Mode's remount
 * reuses the in-flight result instead of starting a second connect.
 */
let ppLaunchProbe: Promise<PpLaunchOutcome> | null = null

function probePpOnLaunch(): Promise<PpLaunchOutcome> {
  if (ppLaunchProbe) return ppLaunchProbe
  ppLaunchProbe = (async () => {
    if (useAppStore.getState().ppState === 'connected') return 'connected'
    const pp = useBootstrapStore.getState().settings.propresenter
    try {
      await window.api.propresenter.connect({
        host: pp.host,
        port: pp.port,
        password: pp.password,
      })
      const status = await window.api.propresenter.getStatus()
      useAppStore.getState().setPPStatus(status)
      const outcome = ppLaunchOutcomeFromStatus(status.state)
      // A miss schedules reconnects — stop them so the connect gate (if shown)
      // is not permanently locked on "Connecting…".
      if (outcome !== 'connected') {
        try {
          await window.api.propresenter.disconnect()
        } catch {
          /* ignore */
        }
      }
      return outcome
    } catch {
      try {
        await window.api.propresenter.disconnect()
      } catch {
        /* ignore */
      }
      return 'unavailable'
    }
  })()
  return ppLaunchProbe
}

/**
 * Keeps account state current from the main process. Its own component so the
 * cloud never becomes a reason to re-render the audio pipeline, or vice versa.
 */
function CloudSubscriptions(): null {
  useEffect(() => {
    const unsubSession = window.api.account.onSessionChange((session) => {
      useAccountStore.getState().setSession(session)
    })
    const unsubPairing = window.api.account.onPairingChange((pairing) => {
      useAccountStore.getState().setPairing(pairing)
    })
    return () => { unsubSession(); unsubPairing() }
  }, [])
  return null
}

// ─── Persistent audio pipeline (lives at app root, not tied to any route) ──────

function AudioPipeline(): null {
  const {
    isTranscribing, setIsTranscribing,
    setAudioCapturing, setAudioLevel,
    captureDeviceId,
  } = useAppStore()

  // Runtime state is hydrated once by the startup bootstrap; the push
  // subscriptions below keep it current from then on.
  // Sync running state from orchestrator push events
  useEffect(() => {
    const unsubOrch = window.api.orchestrator.onStatus((s) => {
      useAppStore.getState().setIsTranscribing(s.running)
      if (!s.running) useAppStore.getState().setAudioCapturing(false)
      useAppStore.setState({ scriptureProjectedCount: s.totalPresentations })
    })
    const unsubPP = window.api.propresenter.onStatusChange((status) => {
      useAppStore.getState().setPPStatus(status)
    })
    return () => { unsubOrch(); unsubPP() }
  }, [])

  useEffect(() => {
    if (!isTranscribing) {
      setAudioCapturing(false)
      setAudioLevel(null)
      return
    }
    let cancelled = false
    const capture = createAudioCapture({
      deviceId: captureDeviceId || useBootstrapStore.getState().settings.audio.deviceId,
      workletUrl: `${import.meta.env.BASE_URL}audio/pcm-capture.worklet.js`,
      onPCM: (pcm) => window.api.audio.sendPCMChunk(pcm),
      onLevel: setAudioLevel,
      onError: (error) => {
        if (cancelled) return
        console.error('[AudioPipeline] Capture failed:', error)
        setIsTranscribing(false)
        setAudioCapturing(false)
        setAudioLevel(null)
        void window.api.orchestrator.stop().catch((stopError) => {
          console.error('[AudioPipeline] Stop failed:', stopError)
        })
      },
    })
    void capture.ready.then((active) => {
      if (!cancelled && active) setAudioCapturing(true)
    }).catch(() => { /* onError reports setup failure */ })
    return () => {
      cancelled = true
      capture.stop()
      setAudioCapturing(false)
      setAudioLevel(null)
    }
  }, [isTranscribing, captureDeviceId, setIsTranscribing, setAudioCapturing, setAudioLevel])

  return null
}

const views: Record<Exclude<NavRoute, 'operator' | 'theme' | 'documents'>, React.ReactNode> = {
  scripture: <Scripture />,
  lyrics: <Lyrics />,
}

const SETTINGS_FRAME = { w: 780, h: 700 }
const SCREENS_FRAME = { w: 1180, h: 760 }
const SETTINGS_MIN = { w: 640, h: 480 }
const SCREENS_MIN = { w: 760, h: 480 }
const SETTINGS_DRAG_EDGE = 48

function isSettingsChromeDrag(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (
    target.closest(
      'button, a, input, textarea, select, label, [role="switch"], [role="slider"], [data-slot="switch"], [data-slot="slider"]',
    )
  ) {
    return false
  }
  return Boolean(target.closest('[data-settings-drag]'))
}

/** Keeps a dragged window's title bar reachable: it can leave the screen only partly. */
function clampFrameOffset(x: number, y: number, size: FrameSize): { x: number; y: number } {
  const viewW = window.innerWidth
  const viewH = window.innerHeight
  const left = (viewW - size.w) / 2 + x
  const top = (viewH - size.h) / 2 + y
  const nextLeft = Math.min(Math.max(left, SETTINGS_DRAG_EDGE - size.w), viewW - SETTINGS_DRAG_EDGE)
  const nextTop = Math.min(Math.max(top, 8), viewH - SETTINGS_DRAG_EDGE)
  return {
    x: nextLeft - (viewW - size.w) / 2,
    y: nextTop - (viewH - size.h) / 2,
  }
}

interface FrameSize { w: number; h: number }

/** The window never outgrows the app window (16px margin) or shrinks below `min`. */
function clampFrameSize(size: FrameSize, min: FrameSize): FrameSize {
  const maxW = Math.max(min.w, window.innerWidth - 32)
  const maxH = Math.max(min.h, window.innerHeight - 32)
  return {
    w: Math.round(Math.min(Math.max(size.w, min.w), maxW)),
    h: Math.round(Math.min(Math.max(size.h, min.h), maxH)),
  }
}

/** A remembered window size — a per-machine convenience, so storage failures are ignored. */
function readFrameSize(key: string): FrameSize | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<FrameSize> | null
    return parsed && Number.isFinite(parsed.w) && Number.isFinite(parsed.h) ? { w: parsed.w!, h: parsed.h! } : null
  } catch {
    return null
  }
}

function writeFrameSize(key: string, size: FrameSize): void {
  try { localStorage.setItem(key, JSON.stringify(size)) } catch { /* Size is not remembered. */ }
}

/** Resize handles: which edges move. `x` -1 = left edge, 1 = right; `y` 1 = bottom. The top is the title bar. */
const RESIZE_HANDLES: ReadonlyArray<{ x: -1 | 0 | 1; y: 0 | 1; className: string }> = [
  { x: 1, y: 0, className: 'right-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { x: -1, y: 0, className: 'left-0 top-3 bottom-3 w-1.5 cursor-ew-resize' },
  { x: 0, y: 1, className: 'bottom-0 left-3 right-3 h-1.5 cursor-ns-resize' },
  { x: 1, y: 1, className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
  { x: -1, y: 1, className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
]

type FrameGesture =
  | { kind: 'move'; pointerId: number; startX: number; startY: number; origX: number; origY: number }
  | { kind: 'resize'; pointerId: number; startX: number; startY: number; origX: number; origY: number
      origW: number; origH: number; edgeX: -1 | 0 | 1; edgeY: 0 | 1 }

/**
 * A modal window the operator can move by its title bar (any `[data-settings-drag]`
 * area that is not a control) and resize from its sides and bottom corners —
 * Settings and Screens alike. The size is remembered per window.
 */
function DraggableFrame({
  frame,
  min,
  storageKey,
  className,
  children,
}: {
  /** Default size. */
  frame: FrameSize
  /** Smallest size the content still lays out at. */
  min: FrameSize
  /** Where the chosen size is remembered. */
  storageKey: string
  /** Window chrome (radius, ring, animation) — the size comes from the frame. */
  className?: string
  children: React.ReactNode
}): React.ReactElement {
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [size, setSize] = useState<FrameSize>(() => clampFrameSize(readFrameSize(storageKey) ?? frame, min))
  const [gesture, setGesture] = useState<FrameGesture['kind'] | null>(null)
  const active = useRef<FrameGesture | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const offsetRef = useRef(offset)
  offsetRef.current = offset
  const sizeRef = useRef(size)
  sizeRef.current = size

  // The app window shrank: keep the frame inside it.
  useEffect(() => {
    const onResize = (): void => setSize((current) => clampFrameSize(current, min))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [min])

  const begin = (event: PointerEvent<HTMLDivElement>, next: FrameGesture): void => {
    event.preventDefault()
    active.current = next
    setGesture(next.kind)
    root.current?.setPointerCapture(event.pointerId)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || !isSettingsChromeDrag(event.target)) return
    begin(event, { kind: 'move', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      origX: offsetRef.current.x, origY: offsetRef.current.y })
  }

  const onResizeDown = (event: PointerEvent<HTMLDivElement>, edgeX: -1 | 0 | 1, edgeY: 0 | 1): void => {
    if (event.button !== 0) return
    event.stopPropagation()
    begin(event, { kind: 'resize', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      origX: offsetRef.current.x, origY: offsetRef.current.y, origW: sizeRef.current.w, origH: sizeRef.current.h, edgeX, edgeY })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const current = active.current
    if (!current || event.pointerId !== current.pointerId) return
    const dx = event.clientX - current.startX
    const dy = event.clientY - current.startY
    if (current.kind === 'move') {
      setOffset(clampFrameOffset(current.origX + dx, current.origY + dy, sizeRef.current))
      return
    }
    const next = clampFrameSize({ w: current.origW + current.edgeX * dx, h: current.origH + current.edgeY * dy }, min)
    // The frame is centred, so growing by d moves each edge d/2. Shift by the
    // same amount so only the dragged edge moves.
    setSize(next)
    setOffset({
      x: current.origX + (current.edgeX * (next.w - current.origW)) / 2,
      y: current.origY + (current.edgeY * (next.h - current.origH)) / 2,
    })
  }

  const endGesture = (event: PointerEvent<HTMLDivElement>): void => {
    const current = active.current
    if (!current || event.pointerId !== current.pointerId) return
    active.current = null
    setGesture(null)
    if (current.kind === 'resize') writeFrameSize(storageKey, sizeRef.current)
    if (root.current?.hasPointerCapture(event.pointerId)) root.current.releasePointerCapture(event.pointerId)
  }

  return (
    <div
      ref={root}
      className={gesture ? `relative select-none ${gesture === 'move' ? 'cursor-grabbing' : ''}` : 'relative'}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={className} style={{ width: size.w, height: size.h }}>{children}</div>
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={`${handle.x}:${handle.y}`}
          aria-hidden="true"
          className={`absolute z-10 ${handle.className}`}
          onPointerDown={(event) => onResizeDown(event, handle.x, handle.y)}
        />
      ))}
    </div>
  )
}

export default function App(): React.ReactElement {
  const [route, setRoute] = useState<NavRoute>('operator')
  useSetlistSync()
  useLibrariesSync()
  usePassagesSync()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('general')
  const settingsRequest = useAppStore((s) => s.settingsRequest)
  useEffect(() => {
    if (!settingsRequest) return
    setSettingsSection(settingsRequest)
    setSettingsOpen(true)
    useAppStore.getState().clearSettingsRequest()
  }, [settingsRequest])
  const screensWindow = useAppStore((s) => s.screensWindow)
  // ⌥⌘1 opens Screens — ProPresenter's shortcut for Screen Configuration, so
  // an operator who knows one finds the other. Escape closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const store = useAppStore.getState()
      if (e.key === 'Escape' && store.screensWindow) {
        e.preventDefault()
        store.closeScreens()
      } else if (e.code === 'Digit1' && e.altKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (store.screensWindow) store.closeScreens()
        else store.openScreens()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [songSearchOpen, setSongSearchOpen] = useState(false)
  useEffect(() => window.api.app.onImportRequested((kind) => {
    if (!isImportKind(kind)) return
    const option = IMPORT_OPTIONS.find(option => option.kind === kind)!
    setSettingsOpen(false)
    if (option.route) setRoute(option.route)
    requestImport(kind)
  }), [])
  const [onboardingDismissed, setOnboardingDismissed] = useState(false)

  const phase = useBootstrapStore((s) => s.phase)
  const progress = useBootstrapStore((s) => s.progress)
  const errors = useBootstrapStore((s) => s.errors)
  const warningDismissed = useBootstrapStore((s) => s.warningDismissed)
  const onboarding = useBootstrapStore((s) => s.onboarding)
  const lyricsLibrary = useBootstrapStore((s) => s.lyrics)
  const accountSession = useAccountStore((s) => s.session)
  const [splashHeld, setSplashHeld] = useState(false)
  const [loaderMounted, setLoaderMounted] = useState(true)

  // Start bootstrap once. The runner behind this is memoized at module level,
  // so Strict Mode's double effect cannot produce a second IPC call.
  useEffect(() => {
    void useBootstrapStore.getState().start()
  }, [])

  const bootstrapped = phase === 'ready' || phase === 'ready-with-warnings'

  // The branded splash holds on every launch, then fades into the app — or
  // stays, with real progress, if loading runs longer.
  useEffect(() => {
    const timer = setTimeout(() => setSplashHeld(true), SPLASH_MIN_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [])

  const ready = bootstrapped && splashHeld
  // Progress is only worth showing once loading outlasts the brand beat.
  const showProgress = splashHeld && !bootstrapped

  // Sign-in is a wall, not a prompt: the booth is unreachable until a
  // confirmed session exists. Setup waits behind it, including the OTP
  // that follows a new account.
  const accountGateOpen = ready && shouldOfferAccountGate(accountSession)

  // First run, once per install: setup opens before the account wall — the tour
  // comes first and the account is created inside it. A finished or dismissed
  // wizard never comes back on its own; after that, signed-out launches get the
  // plain sign-in wall.
  const offerOnboarding =
    ready && shouldOfferOnboarding({ state: onboarding, dismissedThisSession: onboardingDismissed })
  // Finishing setup marks it complete before the closing welcome is shown, so
  // once the wizard is up it stays mounted until it dismisses itself.
  const [onboardingHeld, setOnboardingHeld] = useState(false)
  // A few "where things are" tips, once, right after setup closes.
  const [coachSteps, setCoachSteps] = useState<CoachStep[] | null>(null)
  const closeCoach = useCallback(() => setCoachSteps(null), [])
  // "Show tips again" in Settings → Account replays the Operator walk-round.
  useEffect(() => {
    const replay = (): void => {
      setRoute('operator')
      setCoachSteps(COACH_TOURS.operator)
    }
    window.addEventListener(COACH_TOUR_EVENT, replay)
    return () => window.removeEventListener(COACH_TOUR_EVENT, replay)
  }, [])
  useEffect(() => {
    if (offerOnboarding) setOnboardingHeld(true)
  }, [offerOnboarding])
  const onboardingOpen = offerOnboarding || (onboardingHeld && ready && !onboardingDismissed)

  // Cross-fade: the loader stays mounted, transparent, for one transition.
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => setLoaderMounted(false), 320)
    return () => clearTimeout(timer)
  }, [ready])

  // "Run setup again" from Settings clears the wizard's saved progress; this
  // also clears a dismissal made earlier in the same launch, which would
  // otherwise keep the wizard hidden and make that button look broken.
  useEffect(() => {
    return window.api.onboarding.onStateChange((state) => {
      useBootstrapStore.getState().setOnboarding(state)
      if (state.completedAt === null) setOnboardingDismissed(false)
    })
  }, [])

  // Integrations that must never gate startup — but also must not run for a
  // signed-out operator who has not been let into the booth yet. They start as
  // soon as bootstrap lands, so they settle behind the splash, not after it.
  const needsSignIn = shouldOfferAccountGate(accountSession)
  useEffect(() => {
    if (!bootstrapped || needsSignIn) return
    void hydrateIntegrations()
  }, [bootstrapped, needsSignIn])

  useEffect(() => {
    if (accountGateOpen) setSettingsOpen(false)
  }, [accountGateOpen])

  // ProPresenter is opt-in (Settings → ProPresenter → Use ProPresenter). When
  // it is on, reconnect silently at launch; there is no prompt either way —
  // a failed handshake only shows in the header status.
  useEffect(() => {
    if (!bootstrapped) return
    if (!propresenterEnabled(useBootstrapStore.getState().settings)) return
    void probePpOnLaunch()
  }, [bootstrapped])

  // Listen to Escape key to close settings modal
  useEffect(() => {
    if (!settingsOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [settingsOpen])

  // Global song quick-open. Capture prevents Chromium's built-in Find bar and
  // makes the shortcut reliable even when an editor or search field has focus.
  useEffect(() => {
    const handleSongSearch = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return
      event.preventDefault()
      event.stopPropagation()
      setSongSearchOpen(true)
    }
    window.addEventListener('keydown', handleSongSearch, true)
    return () => window.removeEventListener('keydown', handleSongSearch, true)
  }, [])

  if (!ready) {
    return (
      <div className="relative h-screen w-screen bg-surface text-white overflow-hidden select-none">
        <CloudSubscriptions />
        <LoadingScreen progress={progress} showProgress={showProgress} fadingOut={false} />
      </div>
    )
  }

  // First child of either tree, keyed, so the same wizard survives sign-in.
  const onboardingWizard = onboardingOpen && (
    <OnboardingWizard
      key="onboarding"
      onDismiss={(next, options) => {
        setOnboardingDismissed(true)
        setOnboardingHeld(false)
        if (next) setRoute(next)
        if (options?.coach !== false) setCoachSteps(coachTourFor(next))
      }}
    />
  )

  if (accountGateOpen) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-surface text-white select-none">
        {onboardingWizard}
        <CloudSubscriptions />
        {loaderMounted && <LoadingScreen progress={progress} showProgress={false} fadingOut />}
        {!onboardingOpen && <AccountGate />}
      </div>
    )
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-surface text-white select-none animate-fade-in">
      {onboardingWizard}
      {coachSteps && <CoachTour steps={coachSteps} onDone={closeCoach} />}
      <AudioPipeline />
      <DesktopTooltip />
      <TracksPlayer />
      <ProgramAudioFallback />
      {loaderMounted && <LoadingScreen progress={progress} showProgress={false} fadingOut />}
      {errors.length > 0 && !warningDismissed && (
        <div
          className="absolute inset-x-0 top-0 z-40 flex items-start gap-2.5 bg-surface-elevated px-4 py-2.5 text-xs text-yellow-300"
          role="alert"
        >
          <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
          <span className="flex-1">{describeBootstrapWarning(errors)}</span>
          <button
            type="button"
            className="shrink-0 inline-flex items-center gap-1 rounded px-2 py-0.5 hover:bg-tint-yellow"
            onClick={() => { void useBootstrapStore.getState().retry() }}
          >
            <RefreshCw size={11} aria-hidden="true" />
            Retry
          </button>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 hover:bg-tint-yellow"
            onClick={() => useBootstrapStore.getState().dismissWarning()}
            aria-label="Dismiss startup warning"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      <UpdateToast />
      <TransferHost />
      <AppShell
        currentRoute={route}
        onProPresenterStatus={() => {
          // ProPresenter is configured in one place only: its Settings page.
          setSettingsSection('propresenter')
          setSettingsOpen(true)
        }}
        toolbar={route === 'operator' ? <OperatorToolbar /> : undefined}
      />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden">
        <WorkspaceRail
          currentRoute={route}
          onNavigate={setRoute}
          onOpenSettings={() => {
            setSettingsSection('general')
            setSettingsOpen(true)
          }}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <main className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-surface">
            {/* Keep Operator, Scripture, Theme and Documents mounted across
                navigation so live session state, the open passage and the
                theme draft survive tab switches. */}
            <div
              className={`${route === 'operator' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
              aria-hidden={route !== 'operator'}
            >
              <Operator />
            </div>
            <div
              className={`${route === 'scripture' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
              aria-hidden={route !== 'scripture'}
            >
              <Scripture active={route === 'scripture'} />
            </div>
            <div
              className={`${route === 'theme' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
              aria-hidden={route !== 'theme'}
            >
              <ThemeEditor />
            </div>
            <div
              className={`${route === 'documents' ? 'flex' : 'hidden'} min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1`}
              aria-hidden={route !== 'documents'}
            >
              <Documents active={route === 'documents'} />
            </div>
            {route !== 'operator' && route !== 'scripture' && route !== 'theme' && route !== 'documents' && (
              <div key={route} className="flex min-h-0 w-full flex-1 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
                {views[route]}
              </div>
            )}
          </main>

        </div>
      </div>

      <CloudSubscriptions />

      {songSearchOpen && (
        <SongQuickOpen
          songs={lyricsLibrary}
          onClose={() => setSongSearchOpen(false)}
          onOpen={(song) => {
            // A song imported from the web inside this palette is not in the
            // bootstrap library yet; without adding it the Lyrics page routes
            // to a selection it cannot resolve and shows nothing.
            const bootstrap = useBootstrapStore.getState()
            if (!bootstrap.lyrics.some((known) => known.id === song.id)) {
              bootstrap.setLyrics([song, ...bootstrap.lyrics])
            }
            useAppStore.getState().setLyricsViewState({ selectedSongId: song.id })
            setSettingsOpen(false)
            setRoute('lyrics')
            setSongSearchOpen(false)
          }}
        />
      )}


      {/* Screens — screen configuration, apart from themes */}
      {screensWindow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 animate-fade-in">
          <div className="absolute inset-0" onClick={() => useAppStore.getState().closeScreens()} />
          <DraggableFrame frame={SCREENS_FRAME} min={SCREENS_MIN} storageKey="kairo.frame.screens"
            className="overflow-hidden rounded-xl animate-spring-in">
            <ScreenConfiguration
              initialSelect={screensWindow.select}
              onClose={() => useAppStore.getState().closeScreens()}
            />
          </DraggableFrame>
        </div>
      )}

      {/* Settings Modal Overlay */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 animate-fade-in">
          <div
            className="absolute inset-0"
            onClick={() => setSettingsOpen(false)}
          />
          <DraggableFrame frame={SETTINGS_FRAME} min={SETTINGS_MIN} storageKey="kairo.frame.settings"
            className="overflow-hidden rounded-xl ring-1 ring-white/10 animate-spring-in">
            <Settings onClose={() => setSettingsOpen(false)} initialSection={settingsSection} />
          </DraggableFrame>
        </div>
      )}
    </div>
  )
}
