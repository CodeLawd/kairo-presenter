'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ActivityIcon,
  ArrowLeftIcon,
  BuildingIcon,
  BugIcon,
  CreditCardIcon,
  DownloadIcon,
  LayoutDashboardIcon,
  ShieldIcon,
  UsersIcon,
} from 'lucide-react'
import { AppSidebar, MobileNav, type SidebarConfig } from '@/components/app-sidebar'
import { DashboardProvider, useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'

const ADMIN_NAV: SidebarConfig = {
  home: '/admin',
  subtitle: 'Admin',
  groups: [
    {
      label: 'Overview',
      items: [{ title: 'Overview', href: '/admin', icon: LayoutDashboardIcon }],
    },
    {
      label: 'People',
      items: [
        { title: 'Users', href: '/admin/users', icon: UsersIcon },
        { title: 'Churches', href: '/admin/churches', icon: BuildingIcon },
        { title: 'Team', href: '/admin/team', icon: ShieldIcon },
      ],
    },
    {
      label: 'Growth',
      items: [
        { title: 'Usage', href: '/admin/usage', icon: ActivityIcon },
        { title: 'Crashes', href: '/admin/crashes', icon: BugIcon },
        { title: 'Downloads', href: '/admin/downloads', icon: DownloadIcon },
        { title: 'Subscriptions', href: '/admin/subscriptions', icon: CreditCardIcon },
      ],
    },
  ],
}

const TITLES: Record<string, string> = {
  '/admin': 'Overview',
  '/admin/users': 'Users',
  '/admin/churches': 'Churches',
  '/admin/team': 'Team',
  '/admin/usage': 'Usage',
  '/admin/crashes': 'Crashes',
  '/admin/downloads': 'Downloads',
  '/admin/subscriptions': 'Subscriptions',
}

/**
 * Kairo staff console. The flag only decides what to render — every /v1/admin
 * request is checked again by the API, which answers 404 to anyone else.
 */
function AdminChrome({ children }: { children: React.ReactNode }): React.ReactElement | null {
  const { session } = useDashboard()
  const router = useRouter()
  const pathname = usePathname()
  const allowed = session.user.isAdmin === true

  useEffect(() => {
    if (!allowed) router.replace('/dashboard')
  }, [allowed, router])

  if (!allowed) return null
  const nav = { ...ADMIN_NAV, subtitle: session.user.platformRole === 'superadmin' ? 'Superadmin' : 'Admin' }

  return (
    <div className="flex h-dvh overflow-hidden bg-sidebar text-foreground">
      <AppSidebar config={nav} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-page md:my-2 md:mr-2 md:rounded-2xl">
        <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav config={nav} />
            <h1 className="truncate text-[11px] font-bold tracking-[.18em] text-muted-foreground uppercase">{TITLES[pathname] ?? (pathname.startsWith('/admin/churches/') ? 'Church' : pathname.startsWith('/admin/crashes/') ? 'Crash' : 'Admin')}</h1>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button variant="ghost" size="sm" render={<Link href="/dashboard" />}>
              <ArrowLeftIcon />
              Back to dashboard
            </Button>
          </div>
        </header>
        <main className="relative min-h-0 flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}

export default function AdminLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <DashboardProvider>
      <AdminChrome>{children}</AdminChrome>
    </DashboardProvider>
  )
}
