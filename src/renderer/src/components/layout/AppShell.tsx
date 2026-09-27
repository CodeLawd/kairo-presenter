import { useState } from 'react'
import {
  BookOpen,
  FileText,
  CircleGauge,
  Eraser,
  MediaLibrary,
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
import UpdatePill from './UpdatePill'

const workspaces: Array<{ id: NavRoute; label: string; icon: typeof CircleGauge }> = [
  { id: 'operator', label: 'Operator', icon: CircleGauge },
  { id: 'scripture', label: 'Scripture', icon: BookOpen },
  { id: 'lyrics', label: 'Lyrics', icon: Music2 },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'theme', label: 'Theme', icon: Palette },
]

interface AppShellProps {
  currentRoute: NavRoute
  onNavigate: (route: NavRoute) => void
  onOpenSettings: () => void
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
      className={`${className} hover:bg-white/[0.06]`}
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

export default function AppShell({
  currentRoute,
  onNavigate,
  onOpenSettings,
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
    <header className="app-header drag-region shrink-0 bg-surface pane-edge-b">
      <div
        className="header-navigation flex min-w-0 items-center"
        role="tablist"
        aria-label="Workspaces"
      >
        <div className="no-drag flex items-center rounded-md bg-white/[0.05] p-0.5">
          {workspaces.map(({ id, label, icon: Icon }) => {
            const active = currentRoute === id
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onNavigate(id)}
                className={[
                  'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 text-[11px] font-medium transition-colors duration-150',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
                  active
                    ? 'bg-white/[0.1] text-zinc-50 shadow-sm'
                    : 'text-zinc-500 hover:text-zinc-200',
                ].join(' ')}
              >
                <Icon size={13} aria-hidden="true" />
                {label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="header-toolbar min-w-0">{toolbar}</div>

      <div className="header-statuses flex items-center gap-0.5" aria-label="Service statuses">
        <StatusItem
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
        />
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
              ? 'text-teal-400 hover:bg-teal-500/10'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200',
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
            className="flex h-7 max-w-[9rem] items-center gap-1.5 rounded px-2 text-[11px] font-medium text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
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
              ? 'text-zinc-400 hover:bg-rose-950/40 hover:text-rose-300'
              : 'text-zinc-600 hover:bg-white/5 hover:text-zinc-400',
            'disabled:cursor-not-allowed disabled:opacity-40',
          ].join(' ')}
          aria-label="Clear text and background"
          title={
            ppState === 'connected'
              ? 'Clear text and the dock background'
              : 'Clear local LIVE state (connect ProPresenter to clear the booth output)'
          }
        >
          <Eraser size={13} aria-hidden="true" />
          {clearing ? 'Clearing' : 'Clear'}
        </button>
        <UpdatePill />
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:bg-white/5 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-label="Open Settings"
          title="Settings"
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
