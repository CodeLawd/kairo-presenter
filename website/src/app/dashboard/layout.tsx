'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CreditCardIcon, KeyRoundIcon, LogOutIcon, UserRoundIcon } from 'lucide-react'
import { AppSidebar, MobileNav } from '@/components/app-sidebar'
import { DashboardProvider, useDashboard } from '@/components/dashboard/dashboard-provider'
import { DesktopAppPrompt } from '@/components/dashboard/desktop-app-prompt'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/sermons': 'Sermons',
  '/dashboard/devices': 'Devices',
  '/dashboard/members': 'Members',
  '/dashboard/billing': 'Plans & Billing',
  '/dashboard/keys': 'API keys',
  '/dashboard/account': 'Account',
  '/dashboard/church': 'Church',
  '/dashboard/download': 'Download',
}

function initialsOf(value: string): string {
  return (
    value
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'K'
  )
}

function UserMenu(): React.ReactElement {
  const { session, signOut } = useDashboard()
  const org = session.orgs.find((item) => item.id === session.orgId)
  const initials = initialsOf(session.user.name || org?.name || 'Kairo')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-9 gap-2 px-1.5" />}>
        <Avatar size="sm">
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="hidden min-w-0 flex-col items-start sm:flex">
          <span className="max-w-[12rem] truncate text-[13px] font-medium text-foreground">
            {session.user.name}
          </span>
          <span className="max-w-[12rem] truncate text-[11px] text-muted-foreground">
            {org?.name ?? 'Your church'}
          </span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{session.user.email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem render={<Link href="/dashboard/account" />}>
            <UserRoundIcon />
            Account
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/dashboard/keys" />}>
            <KeyRoundIcon />
            API keys
          </DropdownMenuItem>
          <DropdownMenuItem render={<Link href="/dashboard/billing" />}>
            <CreditCardIcon />
            Plans & Billing
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => void signOut()}>
          <LogOutIcon />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DashboardChrome({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname()
  // Every section is exactly two segments (/dashboard/x), so a detail route
  // like /dashboard/sermons/<id> resolves by trimming to its section rather
  // than scanning or sorting the map.
  const section = pathname.split('/').slice(0, 3).join('/')
  const title = TITLES[pathname] ?? TITLES[section] ?? 'Dashboard'
  // Recap reader is a two-pane split: drop page padding so the list rule
  // can run from the header to the bottom of the viewport.
  const sermonOpen = /^\/dashboard\/sermons\/[^/]+$/.test(pathname)

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav />
            <h1 className="truncate text-[15px] font-medium text-foreground">{title}</h1>
          </div>
          <UserMenu />
        </header>
        <main
          className={cn(
            'relative min-h-0 flex-1',
            sermonOpen ? 'overflow-hidden' : 'overflow-y-auto p-4 md:p-6 lg:p-8',
          )}
        >
          {children}
        </main>
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
