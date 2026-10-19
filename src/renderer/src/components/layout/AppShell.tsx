import { useEffect, useState } from 'react'
import {
  BookOpen,
  FileText,
  CircleGauge,
  Eraser,
  MonitorPlay,
  MediaLibrary,
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
import { isRenderedKind } from '@shared/overlay-outputs'
import UpdatePill from './UpdatePill'
import { cn } from '@/lib/utils'
import { Popover } from 'radix-ui'
import { Switch } from '@/components/ui/switch'
import { saveOutputSettings } from '@/lib/output-settings'
import { hueStyle, railHueClass, type Hue } from '@/lib/hue'
import { HEADER_TOOLBAR_SLOT_ID } from './header-toolbar'


const IS_MAC = navigator.platform.startsWith('Mac')
const workspaces: Array<{ id: NavRoute; label: string; icon: typeof CircleGauge; hue: Hue }> = [
  { id: 'operator', label: 'Operator', icon: CircleGauge, hue: 'green' },
  { id: 'scripture', label: 'Scripture', icon: BookOpen, hue: 'blue' },
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
      style={hueStyle('orange')}
      className={railHueClass(open)}
    >
      <MediaLibrary size={19} weight={open ? 'fill' : 'regular'} aria-hidden="true" />
      {liveId && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-live" aria-hidden="true" />}
    </button>
  )
}

interface AppShellProps {
  currentRoute: NavRoute
  /** Route-specific controls rendered inline in the top bar (see OperatorToolbar). */
  toolbar?: React.ReactNode
}

/**
 * A header button the way ProPresenter's toolbar draws them: the icon in a
 * rounded pill, a short label underneath. A tooltip carries the detail.
 */
function ToolbarButton({
  label,
  title,
  children,
  onClick,
  disabled,
  tone = 'default',
  labelClassName,
}: {
  label: string
  /** Tooltip and screen-reader text: what it is and what clicking does. */
  title: string
  /** What sits in the pill: an icon or a status dot. */
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  /** `live`: something is on screen (red); `muted`: nothing to act on yet. */
  tone?: 'default' | 'live' | 'muted'
  labelClassName?: string
}): React.ReactElement {
  const pill = cn(
    'grid h-7 w-11 place-items-center rounded-full transition-colors duration-150',
    tone === 'live' ? 'bg-tint-live text-live' : 'bg-surface-tertiary text-zinc-200',
    onClick && !disabled && 'group-hover:bg-surface-elevated',
  )
  const body = (
    <>
      <span className={pill}>{children}</span>
      <span
        className={cn(
          'max-w-[10rem] truncate text-[10px] font-medium leading-none',
          tone === 'live' ? 'text-live' : tone === 'muted' ? 'text-zinc-600' : 'text-zinc-400',
          labelClassName,
        )}
      >
        {label}
      </span>
    </>
  )
  const className =
    'header-tool no-drag group flex shrink-0 flex-col items-center gap-1 rounded-md px-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40'
  return onClick ? (
    <button type="button" onClick={onClick} disabled={disabled} className={className} title={title} aria-label={title}>
      {body}
    </button>
  ) : (
    <div className={className} title={title} aria-label={title} role="status">
      {body}
    </div>
  )
}

/**
 * The Live button's menu, as ProPresenter's Live button opens one: what is on
 * screen now, and the Syphon outputs that send Kairo to OBS and the like —
 * each switchable here without opening Screens.
 */
function LiveMenu({ label, live, detail }: { label: string; live: boolean; detail: string }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs)
  const status = useBootstrapStore((s) => s.ndiStatus)
  const syphons = outputs.filter((o) => o.kind === 'syphon')
  const setEnabled = (id: string, enabled: boolean): void => {
    void saveOutputSettings((current) => current.map((o) => (o.id === id ? { ...o, enabled } : o)))
  }
  // Straight to the work: a new Syphon output, or the existing one.
  const openScreens = (): void => {
    setOpen(false)
    useAppStore.getState().openScreens(syphons.length === 0 ? 'add:syphon' : 'kind:syphon')
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div aria-live="polite" className="header-live-label">
          <ToolbarButton
            label={label}
            tone={live ? 'live' : 'muted'}
            title={`${detail}. Click for live outputs`}
            onClick={() => setOpen(!open)}
            labelClassName="header-live-text"
          >
            <Radio size={15} aria-hidden="true" />
          </ToolbarButton>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-72 rounded-xl bg-surface-elevated p-1.5 text-zinc-200 ring-1 ring-surface-border animate-spring-in"
        >
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className={cn('size-2 shrink-0 rounded-full', live ? 'bg-live' : 'bg-zinc-600')} aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[12px] text-zinc-200">{detail}</p>
          </div>
          {IS_MAC && (
            <div className="mt-1 border-t border-surface-border pt-1.5">
              <p className="px-2.5 pb-1 text-[11px] font-medium text-zinc-500">Syphon — to OBS and other apps on this Mac</p>
              {syphons.map((output) => {
                const state = status?.outputs.find((o) => o.id === output.id)
                return (
                  <label key={output.id} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-tertiary">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] text-white">{output.name}</span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {!output.enabled ? 'Off' : state?.ready ? 'Sending' : state?.reason || 'Starting'}
                      </span>
                    </span>
                    <Switch
                      size="sm"
                      checked={output.enabled}
                      onCheckedChange={(on) => setEnabled(output.id, on)}
                      aria-label={`Send ${output.name} over Syphon`}
                    />
                  </label>
                )
              })}
              <button
                type="button"
                className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-zinc-300 hover:bg-surface-tertiary hover:text-white"
                onClick={openScreens}
              >
                {syphons.length === 0 ? 'Set up Syphon for OBS…' : 'Syphon settings…'}
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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

  const rendered = outputs.filter((o) => o.enabled && isRenderedKind(o.kind))
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
  toolbar,
}: AppShellProps): React.ReactElement {
  const { liveOutputLabel, isTranscribing } =
    useAppStore()
  const houseTrack = useTracksPlaybackStore((state) => {
    const live = state.library.items.find((item) => item.id === state.library.liveId)
    if (!live) return null
    return { name: live.name, paused: state.library.livePaused || state.ended }
  })
  const [clearing, setClearing] = useState(false)
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
      {/* The page you're on: its icon in its tool colour, then its name. */}
      <div className="header-context flex min-w-0 items-center gap-2 pl-[80px]">
        {(() => {
          const page = workspaces.find((workspace) => workspace.id === currentRoute)
          if (!page) return null
          const Icon = page.icon
          return (
            <>
              <Icon size={17} weight="fill" style={hueStyle(page.hue)} className="shrink-0 text-[rgb(var(--hue))]" aria-hidden="true" />
              <span className="truncate text-[15px] font-semibold tracking-tight text-white">{page.label}</span>
            </>
          )
        })()}
      </div>

      <div id={HEADER_TOOLBAR_SLOT_ID} className="header-toolbar min-w-0">{toolbar}</div>

      <div className="header-statuses flex items-center gap-1" aria-label="Service statuses">
        <ToolbarButton
          label="Screens"
          title={`Screens: ${screens.detail}. Open Screens (⌥⌘1)`}
          onClick={() => useAppStore.getState().openScreens()}
        >
          {/* The screen icon, its state as a dot on the corner. */}
          <span className="relative" aria-hidden="true">
            <MonitorPlay size={15} weight="fill" style={hueStyle('cyan')} className="text-[rgb(var(--hue))]" />
            <span
              className={cn(
                'absolute -right-1 -top-0.5 size-2 rounded-full ring-2 ring-surface-tertiary',
                screens.state === 'ready' ? 'bg-emerald-500' : screens.state === 'warning' ? 'bg-amber-500' : 'bg-zinc-500',
              )}
            />
          </span>
        </ToolbarButton>
      </div>

      <div className="header-live flex shrink-0 items-center gap-1 pl-1">
        {houseTrack && (
          <ToolbarButton
            label={houseTrack.name}
            title={houseTrack.paused ? `Play ${houseTrack.name}` : `Pause ${houseTrack.name}`}
            onClick={() => void window.api.tracks.setPaused(!houseTrack.paused)}
            labelClassName="max-w-[6rem]"
          >
            {houseTrack.paused ? (
              <Play size={13} fill="currentColor" aria-hidden="true" />
            ) : (
              <Pause size={13} fill="currentColor" aria-hidden="true" />
            )}
          </ToolbarButton>
        )}
        <LiveMenu
          label={liveDetail ?? 'Live'}
          live={isLive}
          detail={
            liveOutputLabel?.trim()
              ? liveOutputLabel.trim()
              : isTranscribing
                ? 'Listening for scripture'
                : 'Nothing on screen'
          }
        />
        <ToolbarButton
          label={clearing ? 'Clearing' : 'Clear'}
          title="Clear text and the dock background"
          onClick={() => void clearOutput()}
          disabled={clearing}
        >
          <Eraser size={14} style={hueStyle('pink')} className="text-[rgb(var(--hue))]" aria-hidden="true" />
        </ToolbarButton>
        <UpdatePill />
      </div>
    </header>
  )
}
