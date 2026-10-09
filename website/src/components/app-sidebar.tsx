'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BookOpenTextIcon,
  CircleHelpIcon,
  CreditCardIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  MonitorSmartphoneIcon,
  ShieldIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { KairoMark } from '@/components/brand/KairoMark'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export type NavGroup = {
  label: string
  items: readonly { title: string; href: string; icon: React.ComponentType<{ className?: string }> }[]
}

/** Which nav the sidebar shows, and where its brand links. */
export type SidebarConfig = { groups: readonly NavGroup[]; home: string; subtitle?: string }

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboardIcon },
      { title: 'Sermons', href: '/dashboard/sermons', icon: BookOpenTextIcon },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { title: 'Devices', href: '/dashboard/devices', icon: MonitorSmartphoneIcon },
      { title: 'Members', href: '/dashboard/members', icon: UsersIcon },
      { title: 'API keys', href: '/dashboard/keys', icon: KeyRoundIcon },
    ],
  },
  {
    label: 'Account',
    items: [
      { title: 'Plans & Billing', href: '/dashboard/billing', icon: CreditCardIcon },
      { title: 'Account', href: '/dashboard/account', icon: UserRoundIcon },
    ],
  },
] as const satisfies readonly NavGroup[]

const DASHBOARD: SidebarConfig = { groups: NAV_GROUPS, home: '/dashboard' }

/** Kairo staff get a way into the admin console from the church dashboard. */
const STAFF_GROUP: NavGroup = {
  label: 'Kairo',
  items: [{ title: 'Admin', href: '/admin', icon: ShieldIcon }],
}

function useSidebarConfig(config: SidebarConfig | undefined): SidebarConfig {
  const { session } = useDashboard()
  if (config) return config
  return session.user.isAdmin ? { ...DASHBOARD, groups: [...DASHBOARD.groups, STAFF_GROUP] } : DASHBOARD
}

function isActive(pathname: string, href: string, home: string): boolean {
  if (href === home) return pathname === home
  return pathname === href || pathname.startsWith(`${href}/`)
}

function Brand({ config, onNavigate }: { config: SidebarConfig; onNavigate?: () => void }): React.ReactElement {
  const { session } = useDashboard()
  const org = session.orgs.find((item) => item.id === session.orgId)

  return (
    <Link href={config.home} onClick={onNavigate} className="flex items-center gap-3 px-2.5">
      <KairoMark size={32} />
      <span className="min-w-0">
        <span className="block font-display text-[16px] font-semibold tracking-[-0.02em] text-foreground">
          Kairo
        </span>
        <span className="block truncate text-[12px] text-muted-foreground">
          {config.subtitle ?? org?.name ?? 'Your church'}
        </span>
      </span>
    </Link>
  )
}

function NavList({ config, onNavigate }: { config: SidebarConfig; onNavigate?: () => void }): React.ReactElement {
  const pathname = usePathname()

  return (
    <nav className="flex flex-1 flex-col">
      {config.groups.map((group, index) => (
        <div key={group.label} className={cn('flex flex-col gap-0.5', index > 0 && 'mt-5')}>
          <p className="px-2.5 pb-1.5 text-[11px] font-medium text-muted-foreground">{group.label}</p>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href, config.home)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] transition-colors',
                  active
                    ? 'bg-primary/15 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                )}
              >
                <item.icon className="size-4 opacity-90" />
                {item.title}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function SidebarFooter({ onNavigate }: { onNavigate?: () => void }): React.ReactElement {
  const { signOut } = useDashboard()

  return (
    <div className="mt-auto flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
      <a
        href="mailto:hello@kairo.app"
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <CircleHelpIcon className="size-4" />
        Help
      </a>
      <button
        type="button"
        onClick={() => {
          onNavigate?.()
          void signOut()
        }}
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground"
      >
        <LogOutIcon className="size-4" />
        Log out
      </button>
    </div>
  )
}

function SidebarBody({ config, onNavigate }: { config: SidebarConfig; onNavigate?: () => void }): React.ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col gap-7">
      <Brand config={config} onNavigate={onNavigate} />
      <NavList config={config} onNavigate={onNavigate} />
      <SidebarFooter onNavigate={onNavigate} />
    </div>
  )
}

export function AppSidebar({ config: requested }: { config?: SidebarConfig }): React.ReactElement {
  const config = useSidebarConfig(requested)
  return (
    <aside className="sticky top-0 hidden h-dvh w-72 shrink-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 pb-5 pt-8 md:flex">
      <SidebarBody config={config} />
    </aside>
  )
}

export function MobileNav({ config: requested }: { config?: SidebarConfig }): React.ReactElement {
  const config = useSidebarConfig(requested)
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="md:hidden" />}
      >
        <MenuIcon />
        <span className="sr-only">Open navigation</span>
      </SheetTrigger>
      <SheetContent side="left" showCloseButton={false} className="w-72 gap-0 p-0 data-[side=left]:w-72">
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <div className="flex h-full flex-col px-4 pb-5 pt-8">
          <SidebarBody config={config} onNavigate={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}
