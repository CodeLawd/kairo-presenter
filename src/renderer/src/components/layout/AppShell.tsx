import { useEffect, useState } from 'react'
import {
  BookOpen,
  FileText,
  CircleGauge,
  Eraser,
  MediaLibrary,
  MonitorPlay,
  Music2,
  Palette,
  Pause,
  Play,
  Radio,
  Settings,
  Volume2,
  Cloud,
} from '@/icons'
import type { NavRoute } from '@/App'
import { useAppStore } from '@/stores/useAppStore'
import { useAccountStore } from '@/stores/useAccountStore'
import { useMediaDockStore } from '@/stores/useMediaDockStore'
import { describeSessionState } from '@shared/cloud/auth-state'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'
import { clearLiveAll } from '@/lib/clear-live-output'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { propresenterEnabled } from '@shared/pp-connect-gate'
import UpdatePill from './UpdatePill'
import { HEADER_TOOLBAR_SLOT_ID } from './header-toolbar'

const workspaces: Array<{ id: NavRoute; label: string; icon: typeof CircleGauge }> = [
  { id: 'operator', label: 'Operator', icon: CircleGauge },
  { id: 'scripture', label: 'Scripture', icon: BookOpen },
  { id: 'lyrics', label: 'Lyrics', icon: Music2 },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'theme', label: 'Theme', icon: Palette },
]

interface WorkspaceRailProps {
  currentRoute: NavRoute
  onNavigate: (route: NavRoute) => void
  onOpenSettings: () => void
}

export function WorkspaceRail({
  currentRoute,
  onNavigate,
  onOpenSettings,
}: WorkspaceRailProps): React.ReactElement {
  return (
    <nav className="workspace-rail flex shrink-0 flex-col items-center" aria-label="Workspaces">
      <div className="flex w-full flex-1 flex-col items-center gap-1 px-1.5 py-3">
        {workspaces.map(({ id, label, icon: Icon }) => {
          const active = currentRoute === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              data-tooltip={label}
              data-tooltip-side="right"
              className={[
                'flex size-10 items-center justify-center rounded-md transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
                active
                  ? 'bg-surface-elevated text-zinc-50 shadow-sm'
                  : 'text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200',
              ].join(' ')}
            >
              <Icon size={19} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        className="mb-3 flex size-10 items-center justify-center rounded-md text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        aria-label="Open Settings"
        data-tooltip="Settings"
        data-tooltip-side="right"
      >
        <Settings size={19} aria-hidden="true" />
      </button>
    </nav>
  )
}

interface AppShellProps {
  currentRoute: NavRoute
  /** The ProPresenter status was clicked. */
  onProPresenterStatus?: () => void
  /** Route-specific controls rendered inline in the top bar (see OperatorToolbar). */
  toolbar?: React.ReactNode
}

function useCloudStatus(): ReturnType<typeof describeSessionState> {
  return describeSessionState(useAccountStore((s) => s.session))
}

function StatusItem({
  label,
  detail,
  state,
  icon: Icon,
  onClick,
  action,
}: {
  label: string
  detail: string
  state: 'ready' | 'active' | 'offline' | 'warning'
  icon: typeof Radio
  /** Makes the status a button (e.g. ProPresenter: connect). */
  onClick?: () => void
  /** What clicking does, shown in the tooltip. */
  action?: string
}): React.ReactElement {
  const dotClass = {
    ready: 'bg-emerald-500',
    active: 'bg-teal-500',
    offline: 'bg-zinc-600',
    warning: 'bg-amber-500',
  }[state]

  const content = (
    <>
      <Icon size={13} className="text-zinc-500" aria-hidden="true" />
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="header-status-label whitespace-nowrap text-[11px] font-medium text-zinc-500">
        {label}
      </span>
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-max max-w-72 rounded-md border border-white/10 bg-surface-elevated px-3 py-2 text-xs text-zinc-200 shadow-xl group-hover:block group-focus-within:block">
        {label}: {detail}
        {action ? <span className="block text-zinc-500">{action}</span> : null}
      </span>
    </>
  )
  const className =
    'header-status no-drag group relative flex h-7 shrink-0 items-center gap-1.5 rounded px-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30'

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`${className} hover:bg-surface-tertiary`}
      aria-label={`${label}: ${detail}${action ? `. ${action}` : ''}`}
    >
      {content}
    </button>
  ) : (
    <div className={className} tabIndex={0} aria-label={`${label}: ${detail}`}>
      {content}
    </div>
  )
}

/**
 * One line for the header: are Kairo's own outputs (screens, NDI) on the air.
 * Polls the same readiness the Screens window shows, and shares it through the
 * bootstrap store so nothing else has to poll.
 */
function useScreensStatus(): { detail: string; state: 'ready' | 'warning' | 'offline' } {
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs)
  const status = useBootstrapStore((s) => s.ndiStatus)
  useEffect(() => {
    let cancelled = false
    const poll = (): void => {
      window.api.ndi
        .getStatus()
        .then((next) => {
          if (cancelled) return
          const store = useBootstrapStore.getState()
          if (JSON.stringify(store.ndiStatus) !== JSON.stringify(next)) store.setNdiStatus(next)
        })
        .catch(() => undefined)
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const rendered = outputs.filter((o) => o.enabled && (o.kind === 'screen' || o.kind === 'ndi'))
  if (rendered.length === 0) return { detail: 'No screens set up — click to add one', state: 'offline' }
  const problems = rendered.filter((o) => {
    const s = status?.outputs.find((x) => x.id === o.id)
    return !s || !s.ready
  })
  if (problems.length === 0) {
    return { detail: rendered.length === 1 ? `${rendered[0].name} is live` : `${rendered.length} live`, state: 'ready' }
  }
  const first = problems[0]
  const reason = status?.outputs.find((x) => x.id === first.id)?.reason ?? 'checking'
  return { detail: `${first.name}: ${reason}`, state: 'warning' }
}

export default function AppShell({
  currentRoute,
  onProPresenterStatus,
  toolbar,
}: AppShellProps): React.ReactElement {
  const { ppState, audioCapturing, audioDeviceName, liveOutputLabel, isTranscribing } =
    useAppStore()
  const houseTrack = useTracksPlaybackStore((state) => {
    const live = state.library.items.find((item) => item.id === state.library.liveId)
    if (!live) return null
    return { name: live.name, paused: state.library.livePaused || state.ended }
  })
  const [clearing, setClearing] = useState(false)
  // ProPresenter is an opt-in integration: its status only appears in the
  // header once it is switched on in Settings.
  const showPp = useBootstrapStore((s) => propresenterEnabled(s.settings))
  const screens = useScreensStatus()
  const cloud = useCloudStatus()
  const mediaOpen = useMediaDockStore((s) => s.open)
  const toggleMedia = useMediaDockStore((s) => s.toggle)
  const mediaLiveId = useMediaDockStore((s) => s.liveItemId)
  const mediaLiveName = useMediaDockStore((s) => s.liveName)
  /** Session is live while the transcript pipeline runs; show output ref when one is up. */
  const isLive = isTranscribing || Boolean(liveOutputLabel?.trim())
  const liveDetail = liveOutputLabel?.trim() || (isTranscribing ? 'Listening' : null)

  const clearOutput = async (): Promise<void> => {
    if (clearing) return
    setClearing(true)
    try {
      await clearLiveAll()
    } finally {
      setClearing(false)
    }
  }

  return (
    <header className="app-header drag-region shrink-0">
      <div className="header-context flex min-w-0 items-center gap-2 pl-[68px]">
        <span className="truncate text-[13px] font-semibold text-zinc-200">
          {workspaces.find((workspace) => workspace.id === currentRoute)?.label}
        </span>
      </div>

      <div id={HEADER_TOOLBAR_SLOT_ID} className="header-toolbar min-w-0">{toolbar}</div>

      <div className="header-statuses flex items-center gap-0.5" aria-label="Service statuses">
        <StatusItem
          label="Screens"
          detail={screens.detail}
          state={screens.state}
          icon={MonitorPlay}
          onClick={() => useAppStore.getState().openScreens()}
          action="Open Screens (⌥⌘1)"
        />
        {showPp && <StatusItem
          label="ProPresenter"
          detail={
            ppState === 'connected'
              ? 'Connected'
              : ppState === 'connecting'
                ? 'Connecting'
                : 'Offline'
          }
          state={ppState === 'connected' ? 'ready' : ppState === 'connecting' ? 'warning' : 'offline'}
          icon={Radio}
          onClick={onProPresenterStatus}
          action={ppState === 'connected' ? 'Open ProPresenter settings' : 'Click to connect'}
        />}
        <StatusItem
          label="Account"
          detail={cloud.detail}
          state={cloud.tone === 'good' ? 'ready' : cloud.tone === 'warn' ? 'warning' : 'offline'}
          icon={Cloud}
        />
        <StatusItem
          label="Audio"
          detail={audioDeviceName ?? (audioCapturing ? 'Capturing' : 'Idle')}
          state={audioCapturing ? 'active' : 'offline'}
          icon={Volume2}
        />
      </div>

      <div className="header-live flex shrink-0 items-center gap-1 pl-2">
        <button
          type="button"
          onClick={() => toggleMedia()}
          className={[
            'relative flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
            mediaOpen || mediaLiveId
              ? 'text-teal-400 hover:bg-tint-teal'
              : 'text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200',
          ].join(' ')}
          aria-label={mediaOpen ? 'Close media' : 'Open media'}
          aria-pressed={mediaOpen}
          title={
            mediaLiveName
              ? mediaOpen
                ? `Close media — ${mediaLiveName} on screen`
                : `Open media — ${mediaLiveName} on screen`
              : mediaOpen
                ? 'Close media'
                : 'Open media'
          }
        >
          <MediaLibrary size={15} weight={mediaOpen ? 'fill' : 'regular'} aria-hidden="true" />
          <span className="hidden min-[1200px]:inline">Media</span>
          {mediaLiveId && (
            <span
              className="absolute right-1 top-1 size-1.5 rounded-full bg-teal-400"
              aria-hidden="true"
            />
          )}
        </button>
        {houseTrack && (
          <button
            type="button"
            onClick={() => void window.api.tracks.setPaused(!houseTrack.paused)}
            title={houseTrack.paused ? `Play ${houseTrack.name}` : `Pause ${houseTrack.name}`}
            className="flex h-7 max-w-[9rem] items-center gap-1.5 rounded px-2 text-[11px] font-medium text-zinc-400 hover:bg-surface-tertiary hover:text-zinc-200"
          >
            {houseTrack.paused ? (
              <Play size={11} fill="currentColor" aria-hidden="true" />
            ) : (
              <Pause size={11} fill="currentColor" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{houseTrack.name}</span>
          </button>
        )}
        <div
          className={[
            'header-live-label flex h-7 min-w-0 max-w-[10rem] items-center gap-1.5 px-2 text-[11px] font-medium',
            isLive ? 'text-rose-400' : 'text-zinc-500',
          ].join(' ')}
          title={
            liveOutputLabel?.trim()
              ? `Live on output: ${liveOutputLabel}`
              : isTranscribing
                ? 'Live transcript running — listening for scripture'
                : 'Start the Operator pipeline to go live'
          }
          aria-live="polite"
        >
          <span
            className={[
              'h-1.5 w-1.5 shrink-0 rounded-full',
              isLive ? 'bg-rose-500' : 'bg-zinc-600',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{liveDetail ?? 'Live'}</span>
        </div>
        <button
          type="button"
          onClick={() => void clearOutput()}
          disabled={clearing}
          className={[
            'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded px-2 text-[11px] font-medium transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400',
            isLive || ppState === 'connected'
              ? 'text-zinc-400 hover:bg-tint-rose hover:text-rose-300'
              : 'text-zinc-600 hover:bg-surface-tertiary hover:text-zinc-400',
            'disabled:cursor-not-allowed disabled:opacity-40',
          ].join(' ')}
          aria-label="Clear text and background"
          title="Clear text and the dock background"
        >
          <Eraser size={13} aria-hidden="true" />
          {clearing ? 'Clearing' : 'Clear'}
        </button>
        <UpdatePill />
      </div>
    </header>
  )
}
