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
} from '@/icons'
import type { NavRoute } from '@/App'
import { AccountRailButton, AudioRailButton } from './RailPopovers'
import { useAppStore } from '@/stores/useAppStore'
import { useMediaDockStore } from '@/stores/useMediaDockStore'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'
import { clearLiveAll } from '@/lib/clear-live-output'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { propresenterEnabled } from '@shared/pp-connect-gate'
import UpdatePill from './UpdatePill'
import { cn } from '@/lib/utils'
import { hueStyle, railHueClass, type Hue } from '@/lib/hue'
import { HEADER_TOOLBAR_SLOT_ID } from './header-toolbar'


const IS_MAC = navigator.platform.startsWith('Mac')
const workspaces: Array<{ id: NavRoute; label: string; icon: typeof CircleGauge; hue: Hue }> = [
  { id: 'operator', label: 'Operator', icon: CircleGauge, hue: 'green' },
  { id: 'scripture', label: 'Scripture', icon: BookOpen, hue: 'orange' },
  { id: 'lyrics', label: 'Lyrics', icon: Music2, hue: 'violet' },
  { id: 'documents', label: 'Documents', icon: FileText, hue: 'cyan' },
  { id: 'theme', label: 'Theme', icon: Palette, hue: 'pink' },
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
        {workspaces.map(({ id, label, icon: Icon, hue }) => {
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
              style={hueStyle(hue)}
              className={railHueClass(active)}
            >
              <Icon size={19} weight={active ? 'fill' : 'regular'} aria-hidden="true" />
            </button>
          )
        })}
      </div>
      <div className="flex flex-col items-center gap-1 pb-1">
        <MediaRailButton />
        <AudioRailButton />
        <AccountRailButton />
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        // Settings stays neutral — it's housekeeping, not a place to work.
        className="mb-3 flex size-10 items-center justify-center rounded-md text-zinc-300 transition-colors duration-150 hover:bg-surface-tertiary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        aria-label="Open Settings"
        data-tooltip="Settings"
        data-tooltip-side="right"
      >
        <Settings size={19} aria-hidden="true" />
      </button>
    </nav>
  )
}

/**
 * Opens and closes the media dock. Not a workspace — the dock slides in over
 * whichever one is open — so it sits with the tools, not the pages. A blue dot
 * means media is on screen right now.
 */
function MediaRailButton(): React.ReactElement {
  const open = useMediaDockStore((s) => s.open)
  const toggle = useMediaDockStore((s) => s.toggle)
  const liveId = useMediaDockStore((s) => s.liveItemId)
  const liveName = useMediaDockStore((s) => s.liveName)
  const label = open ? 'Close media' : 'Open media'
  return (
    <button
      type="button"
      onClick={() => toggle()}
      aria-label={liveName ? `${label} — ${liveName} on screen` : label}
      aria-pressed={open}
      data-tooltip={liveName ? `Media — ${liveName} on screen` : 'Media'}
      data-tooltip-side="right"
      style={hueStyle('coral')}
      className={railHueClass(open)}
    >
      <MediaLibrary size={19} weight={open ? 'fill' : 'regular'} aria-hidden="true" />
      {liveId && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-live" aria-hidden="true" />}
    </button>
  )
}

interface AppShellProps {
  currentRoute: NavRoute
  /** The ProPresenter status was clicked. */
  onProPresenterStatus?: () => void
  /** Route-specific controls rendered inline in the top bar (see OperatorToolbar). */
  toolbar?: React.ReactNode
}

function StatusItem({
  label,
  detail,
  state,
  icon: Icon,
  hue,
  onClick,
  action,
}: {
  label: string
  detail: string
  state: 'ready' | 'active' | 'offline' | 'warning'
  icon: typeof Radio
  /** Icon colour. */
  hue: Hue
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
      <Icon size={13} style={hueStyle(hue)} className="text-[rgb(var(--hue))]" aria-hidden="true" />
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="header-status-label whitespace-nowrap text-[11px] font-medium text-zinc-500">
        {label}
      </span>
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-max max-w-72 rounded-md bg-surface-elevated px-3 py-2 text-xs text-zinc-200 shadow-xl group-hover:block group-focus-within:block">
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
  const { ppState, liveOutputLabel, isTranscribing } =
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
    // Only the macOS hidden-inset title bar needs the header to drag the window.
    // Windows and Linux have a native title bar, and a drag region there
    // swallows clicks on anything drawn over the header — Settings, menus.
    <header className={cn('app-header shrink-0', IS_MAC && 'drag-region')}>
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
          hue="cyan"
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
          hue="violet"
          onClick={onProPresenterStatus}
          action={ppState === 'connected' ? 'Open ProPresenter settings' : 'Click to connect'}
        />}
      </div>

      <div className="header-live flex shrink-0 items-center gap-1 pl-2">
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
            'header-live-label flex h-7 min-w-0 max-w-[16rem] items-center gap-1.5 px-2 text-[11px] font-medium',
            isLive ? 'text-rose-400' : 'text-[rgb(var(--hue-coral)/0.85)]',
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
              isLive ? 'bg-rose-500' : 'bg-[rgb(var(--hue-coral)/0.45)]',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="header-live-text min-w-0 truncate">{liveDetail ?? 'Live'}</span>
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
          <Eraser size={13} style={hueStyle('pink')} className="text-[rgb(var(--hue))]" aria-hidden="true" />
          {clearing ? 'Clearing' : 'Clear'}
        </button>
        <UpdatePill />
      </div>
    </header>
  )
}
