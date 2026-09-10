'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CircleHelpIcon,
  CreditCardIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MonitorSmartphoneIcon,
  UserRoundIcon,
  UsersIcon,
} from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { KairoMark } from '@/components/brand/KairoMark'
import { cn } from '@/lib/utils'

const NAV = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboardIcon },
  { title: 'Devices', href: '/dashboard/devices', icon: MonitorSmartphoneIcon },
  { title: 'Members', href: '/dashboard/members', icon: UsersIcon },
  { title: 'Plans & Billing', href: '/dashboard/billing', icon: CreditCardIcon },
  { title: 'API keys', href: '/dashboard/keys', icon: KeyRoundIcon },
  { title: 'Account', href: '/dashboard/account', icon: UserRoundIcon },
] as const

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppSidebar(): React.ReactElement {
  const pathname = usePathname()
  const { signOut } = useDashboard()

  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0a] px-3 py-5">
      <Link href="/dashboard" className="mb-8 flex items-center gap-2.5 px-2">
        <KairoMark size={28} />
        <span className="font-display text-[17px] font-semibold tracking-[-0.02em] text-paper">
          Kairo
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors',
                active
                  ? 'bg-accent/15 font-medium text-accent'
                  : 'text-mute hover:bg-white/[0.04] hover:text-paper',
              )}
            >
              <item.icon className="size-[16px] opacity-90" />
              {item.title}
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5 border-t border-white/[0.06] pt-3">
        <a
          href="mailto:hello@kairo.app"
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] text-mute transition-colors hover:bg-white/[0.04] hover:text-paper"
        >
          <CircleHelpIcon className="size-[16px]" />
          Help center
        </a>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] text-mute transition-colors hover:bg-white/[0.04] hover:text-paper"
        >
          <LogOutIcon className="size-[16px]" />
          Logout
        </button>
      </div>
    </aside>
  )
}
