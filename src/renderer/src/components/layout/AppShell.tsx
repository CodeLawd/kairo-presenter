import { useState } from 'react'
import {
  BookOpen,
  FileText,
  CircleGauge,
  Eraser,
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
import { describeSessionState } from '@shared/cloud/auth-state'
import { useTracksPlaybackStore } from '@/stores/useTracksPlaybackStore'
import { clearLiveAll } from '@/lib/clear-live-output'

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
}: {
  label: string
  detail: string
  state: 'ready' | 'active' | 'offline' | 'warning'
  icon: typeof Radio
}): React.ReactElement {
  const dotClass = {
    ready: 'bg-emerald-400',
    active: 'bg-teal-400',
    offline: 'bg-zinc-600',
    warning: 'bg-amber-400',
  }[state]

  return (
    <div
      className="header-status no-drag group relative flex h-8 shrink-0 items-center gap-2 rounded px-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
      tabIndex={0}
      aria-label={`${label}: ${detail}`}
    >
      <Icon size={13} className="text-zinc-500" aria-hidden="true" />
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <span className="header-status-label whitespace-nowrap text-[11px] font-medium text-zinc-400">{label}</span>
      <span className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-max max-w-72 rounded-lg border border-surface-border bg-surface-elevated px-3 py-2 text-xs text-zinc-200 shadow-xl group-hover:block group-focus-within:block">
        {label}: {detail}
      </span>
    </div>
  )
}

export default function AppShell({
  currentRoute,
  onNavigate,
  onOpenSettings,
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
    <header className="app-header drag-region shrink-0 border-b border-surface-border bg-surface">
      <div className="header-navigation no-drag flex min-w-0 items-center gap-1" role="tablist" aria-label="Workspaces">
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
                'flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-xs font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
                active
                  ? 'bg-white/10 text-zinc-50'
                  : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200',
              ].join(' ')}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      <div className="header-toolbar min-w-0">{toolbar}</div>

      <div className="header-statuses flex items-center" aria-label="Service statuses">
        <StatusItem
          label="ProPresenter"
          detail={ppState === 'connected' ? 'Connected' : ppState === 'connecting' ? 'Connecting' : 'Offline'}
          state={ppState === 'connected' ? 'ready' : ppState === 'connecting' ? 'warning' : 'offline'}
          icon={Radio}
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

      <div className="header-live no-drag flex shrink-0 items-center gap-1 border-l border-white/10 pl-2">
        {houseTrack && (
          <button
            type="button"
            onClick={() => void window.api.tracks.setPaused(!houseTrack.paused)}
            title={houseTrack.paused ? `Play ${houseTrack.name}` : `Pause ${houseTrack.name}`}
            className="flex h-8 max-w-[9rem] items-center gap-1.5 rounded border border-teal-500/35 bg-teal-500/10 px-2 text-[11px] font-semibold text-teal-300 hover:bg-teal-500/15"
          >
            {houseTrack.paused
              ? <Play size={11} fill="currentColor" aria-hidden="true" />
              : <Pause size={11} fill="currentColor" aria-hidden="true" />}
            <span className="min-w-0 truncate">{houseTrack.name}</span>
          </button>
        )}
        <div
          className={[
            'header-live-label flex h-8 min-w-0 max-w-[10rem] items-center gap-2 rounded border px-2.5 text-[11px] font-semibold',
            isLive
              ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
              : 'border-white/10 text-zinc-500',
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
              isLive ? 'bg-teal-400 animate-pulse' : 'bg-zinc-600',
            ].join(' ')}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate">{liveDetail ?? 'LIVE'}</span>
        </div>
        <button
          type="button"
          onClick={() => void clearOutput()}
          disabled={clearing}
          className={[
            'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2.5 text-[11px] font-semibold transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-400',
            isLive || ppState === 'connected'
              ? 'border-rose-900/50 text-rose-300 hover:border-rose-700 hover:bg-rose-950/40'
              : 'border-white/10 text-zinc-500 hover:border-rose-900 hover:bg-rose-950/30 hover:text-rose-300',
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
          {clearing ? 'CLEARING' : 'CLEAR'}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          aria-label="Open Settings"
          title="Settings"
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
