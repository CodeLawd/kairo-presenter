'use client'

import { usePathname } from 'next/navigation'
import { AppSidebar } from '@/components/app-sidebar'
import { DashboardProvider, useDashboard } from '@/components/dashboard/dashboard-provider'
import { DesktopAppPrompt } from '@/components/dashboard/desktop-app-prompt'

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/devices': 'Devices',
  '/dashboard/members': 'Members',
  '/dashboard/billing': 'Plans & Billing',
  '/dashboard/keys': 'API keys',
  '/dashboard/account': 'Account',
  '/dashboard/church': 'Church',
  '/dashboard/download': 'Download',
}

function DashboardChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname()
  const { session } = useDashboard()
  const org = session.orgs.find((item) => item.id === session.orgId)
  const title = TITLES[pathname] ?? 'Dashboard'
  const initials = (org?.name ?? session.user.name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'K'

  return (
    <div className="flex min-h-dvh bg-ink text-paper">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b border-white/[0.06] px-6">
          <h1 className="text-[15px] font-medium text-accent">{title}</h1>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-[12.5px] text-mute">{session.user.email}</p>
              <p className="text-[12px] text-faint">{org?.name ?? 'Your church'}</p>
            </div>
            <div className="grid size-9 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold tracking-wide text-paper">
              {initials}
            </div>
          </div>
        </header>
        <main className="relative flex-1 overflow-auto p-6 md:p-8">{children}</main>
      </div>
      <DesktopAppPrompt />
    </div>
  )
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return (
    <DashboardProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardProvider>
  )
}
