'use client'

import Link from 'next/link'
import { ArrowUpRightIcon } from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'

function Panel({
  title,
  badge,
  children,
  footer,
}: {
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}): React.ReactElement {
  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3.5">
        <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
          {title}
        </h2>
        {badge}
      </div>
      <div className="px-5 py-5">{children}</div>
      {footer ? <div className="border-t border-white/[0.06] px-5 py-3">{footer}</div> : null}
    </section>
  )
}

export default function DashboardPage(): React.ReactElement {
  const { session } = useDashboard()
  const org = session.orgs.find((item) => item.id === session.orgId)
  const seats = org ? 1 : 0

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Panel
        title="Free"
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Free
          </span>
        }
      >
        <div className="grid gap-6 sm:grid-cols-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Devices</p>
            <p className="mt-1.5 font-display text-[28px] font-semibold tracking-[-0.03em] text-paper">
              {seats}
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Members</p>
            <p className="mt-1.5 font-display text-[28px] font-semibold tracking-[-0.03em] text-paper">
              1
            </p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Plan</p>
            <p className="mt-1.5 font-display text-[28px] font-semibold tracking-[-0.03em] text-paper">
              Free
            </p>
          </div>
        </div>
        <Link
          href="/dashboard/billing"
          className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-[#231703] transition-colors hover:bg-[#FBBF24]"
        >
          Upgrade to Plus
          <ArrowUpRightIcon className="size-3.5" />
        </Link>
      </Panel>

      <Panel title="Booth sync">
        <p className="max-w-[52ch] text-[14px] leading-relaxed text-mute">
          Store API keys and church settings here so every booth machine signs in and stays in sync.{' '}
          <Link href="/dashboard/keys" className="text-accent hover:underline">
            Manage keys
          </Link>
        </p>
      </Panel>

      <Panel
        title="Desktop app"
        footer={
          <Link
            href="/dashboard/download"
            className="flex w-full items-center justify-center rounded-lg bg-white/[0.04] px-4 py-2.5 text-[13px] font-medium text-paper transition-colors hover:bg-white/[0.07]"
          >
            Download Kairo
          </Link>
        }
      >
        <p className="max-w-[52ch] text-[14px] leading-relaxed text-mute">
          Install on the computer that runs ProPresenter, then sign in with{' '}
          <span className="text-paper">{session.user.email}</span>. Live transcript and scripture
          matching run there.
        </p>
      </Panel>
    </div>
  )
}
