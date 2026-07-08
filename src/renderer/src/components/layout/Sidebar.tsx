import {
  LayoutDashboard,
  BookOpen,
  Mic,
  Music2,
  MonitorPlay,
  Settings,
  ChevronRight,
  Radio,
  type LucideIcon,
} from 'lucide-react'
import type { NavRoute } from '@/App'

interface NavItem {
  id: NavRoute | 'settings'
  label: string
  icon: LucideIcon
}

const primaryNav: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'scripture', label: 'Scripture', icon: BookOpen },
  { id: 'transcription', label: 'Transcription', icon: Mic },
  { id: 'lyrics', label: 'Lyrics', icon: Music2 },
  { id: 'operator', label: 'Operator', icon: MonitorPlay },
]

interface SidebarProps {
  currentRoute: NavRoute
  onNavigate: (route: NavRoute) => void
  settingsOpen: boolean
  onToggleSettings: () => void
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick: () => void
}): React.ReactElement {
  const Icon = item.icon
  const handleAction = (e: React.MouseEvent) => {
    e.preventDefault()
    onClick()
  }
  return (
    <button
      onClick={handleAction}
      onMouseDown={handleAction}
      className={[
        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium',
        'transition-[background-color,color,border-color] duration-200 group border no-drag',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
        active
          ? 'bg-teal-500/10 text-teal-300 border-teal-500/20 shadow-glow-teal/20'
          : 'text-slate-400 hover:bg-surface-tertiary/60 hover:text-white border-transparent',
      ].join(' ')}
    >
      <Icon
        size={16}
        aria-hidden="true"
        className={[
          'transition-[color] duration-200',
          active ? 'text-teal-400' : 'text-slate-500 group-hover:text-slate-300',
        ].join(' ')}
      />
      <span className="flex-1 text-left transition-colors duration-200">{item.label}</span>
      {active && (
        <ChevronRight
          size={12}
          aria-hidden="true"
          className="text-teal-400"
        />
      )}
    </button>
  )
}

export default function Sidebar({
  currentRoute,
  onNavigate,
  settingsOpen,
  onToggleSettings,
}: SidebarProps): React.ReactElement {
  return (
    <aside className="w-56 flex flex-col bg-surface/90 backdrop-blur-lg border-r border-surface-border/50 shrink-0 shadow-xl relative z-10">
      {/* Subtle top edge glow for premium feel */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-surface-border/40 drag-region">
        <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center shrink-0 no-drag shadow-glow-teal/30">
          <Radio size={14} className="text-white animate-pulse" aria-hidden="true" />
        </div>
        <div className="no-drag">
          <p className="text-sm font-semibold text-white leading-none tracking-tight font-sans">ProAutomate</p>
          <p className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-sans font-medium">
            Church Tech
          </p>
        </div>
      </div>

      {/* Primary navigation */}
      <nav className="flex-1 px-2.5 py-4 space-y-1 overflow-y-auto">
        <p className="px-3 pb-2 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
          Modules
        </p>
        {primaryNav.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={currentRoute === item.id}
            onClick={() => onNavigate(item.id as NavRoute)}
          />
        ))}
      </nav>

      {/* Settings pinned at bottom */}
      <div className="px-2.5 py-4 border-t border-surface-border/40 bg-surface/30">
        <NavButton
          item={{ id: 'settings', label: 'Settings', icon: Settings }}
          active={settingsOpen}
          onClick={onToggleSettings}
        />
      </div>
    </aside>
  )
}
