import { useState } from 'react'
import {
  BookOpen,
  CircleGauge,
  Eraser,
  Music2,
  Palette,
  Radio,
  Settings,
  Volume2,
} from 'lucide-react'
import type { NavRoute } from '@/App'
import { useAppStore } from '@/stores/useAppStore'

const workspaces: Array<{ id: NavRoute; label: string; icon: typeof CircleGauge }> = [
  { id: 'operator', label: 'Operator', icon: CircleGauge },
  { id: 'scripture', label: 'Scripture', icon: BookOpen },
  { id: 'lyrics', label: 'Lyrics', icon: Music2 },
  { id: 'theme', label: 'Theme', icon: Palette },
]

interface AppShellProps {
  currentRoute: NavRoute
  onNavigate: (route: NavRoute) => void
  onOpenSettings: () => void
  /** Route-specific controls rendered inline in the top bar (see OperatorToolbar). */
  toolbar?: React.ReactNode
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
    <div className="no-drag flex h-8 items-center gap-2 border-l border-surface-border/70 px-3" title={`${label}: ${detail}`}>
      <Icon size={13} className="text-zinc-500" aria-hidden="true" />
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden="true" />
      <div className="hidden min-w-0 xl:block">
        <p className="text-[11px] font-semibold leading-none text-zinc-300">{label}</p>
        <p className="mt-1 max-w-24 truncate text-[10px] leading-none text-zinc-600">{detail}</p>
      </div>
    </div>
  )
}

export default function AppShell({
  currentRoute,
  onNavigate,
  onOpenSettings,
  toolbar,
}: AppShellProps): React.ReactElement {
  const { ppState, audioCapturing, audioDeviceName } = useAppStore()
  const [clearing, setClearing] = useState(false)

  const clearOutput = async (): Promise<void> => {
    if (clearing) return
    setClearing(true)
    try {
      await window.api.propresenter.clearAll()
      useAppStore.getState().clearScriptureLiveOutput()
    } finally {
      setClearing(false)
    }
  }

  return (
    <header className="drag-region flex h-14 shrink-0 items-end border-b border-surface-border bg-surface px-3 pb-2 pl-20">
      <div className="no-drag flex items-center gap-1" role="tablist" aria-label="Workspaces">
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
                'flex h-8 items-center gap-2 rounded px-3 text-xs font-medium transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400',
                active
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200',
              ].join(' ')}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>

      <div className="min-w-4 flex-1" aria-hidden="true" />

      {toolbar}

      <div className="ml-2 flex items-center">
        <StatusItem
          label="ProPresenter"
          detail={ppState === 'connected' ? 'Connected' : ppState === 'connecting' ? 'Connecting' : 'Offline'}
          state={ppState === 'connected' ? 'ready' : ppState === 'connecting' ? 'warning' : 'offline'}
          icon={Radio}
        />
        <StatusItem
          label="Audio"
          detail={audioDeviceName ?? (audioCapturing ? 'Capturing' : 'Idle')}
          state={audioCapturing ? 'active' : 'offline'}
          icon={Volume2}
        />
      </div>

      <div className="no-drag ml-2 flex items-center gap-1 border-l border-surface-border pl-2">
        <div className="flex h-8 items-center gap-2 rounded border border-zinc-800 px-2.5 text-[11px] font-semibold text-zinc-500" title="No content is currently marked live by ProAutomate">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" aria-hidden="true" />
          LIVE
        </div>
        <button
          type="button"
          onClick={clearOutput}
          disabled={clearing || ppState !== 'connected'}
          className="flex h-8 items-center gap-1.5 rounded border border-zinc-800 px-2.5 text-[11px] font-semibold text-zinc-400 transition-colors duration-150 hover:border-rose-900 hover:bg-rose-950/30 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Clear output"
        >
          <Eraser size={13} aria-hidden="true" />
          {clearing ? 'CLEARING' : 'CLEAR'}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex h-8 w-8 items-center justify-center rounded text-zinc-500 transition-colors duration-150 hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
          aria-label="Open Settings"
          title="Settings"
        >
          <Settings size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
