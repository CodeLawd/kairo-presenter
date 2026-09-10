'use client'

import { useDashboard } from '@/components/dashboard/dashboard-provider'

export default function MembersPage(): React.ReactElement {
  const { session } = useDashboard()
  const org = session.orgs.find((item) => item.id === session.orgId)
  const role = session.role ?? org?.role ?? 'owner'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Members
          </h2>
        </div>
        <div className="divide-y divide-white/[0.06]">
          <div className="flex items-center justify-between gap-4 px-5 py-4">
            <div>
              <p className="text-[14px] font-medium text-paper">{session.user.name}</p>
              <p className="mt-0.5 text-[12.5px] text-mute">{session.user.email}</p>
            </div>
            <span className="rounded-full bg-white/[0.05] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
              {role}
            </span>
          </div>
        </div>
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="text-[13px] leading-relaxed text-mute">
            Invites are coming next. For now, each operator creates an account for your church during
            signup, or signs in on the desktop app with this email.
          </p>
        </div>
      </section>
    </div>
  )
}
