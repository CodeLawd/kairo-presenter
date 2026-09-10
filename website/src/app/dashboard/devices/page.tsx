'use client'

import Link from 'next/link'
import { useDashboard } from '@/components/dashboard/dashboard-provider'

export default function DevicesPage(): React.ReactElement {
  const { session } = useDashboard()

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Booth machines
          </h2>
        </div>
        <div className="px-5 py-8 text-center">
          <p className="text-[14px] leading-relaxed text-mute">
            No devices reported yet. Sign in to Kairo on a booth computer with{' '}
            <span className="text-paper">{session.user.email}</span> and it will show up here.
          </p>
          <Link
            href="/dashboard/download"
            className="mt-5 inline-flex rounded-lg bg-white/[0.04] px-4 py-2.5 text-[13px] font-medium text-paper transition-colors hover:bg-white/[0.07]"
          >
            Download the desktop app
          </Link>
        </div>
      </section>
    </div>
  )
}
