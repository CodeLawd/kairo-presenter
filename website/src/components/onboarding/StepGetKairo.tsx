'use client'

import { btnPrimary } from '@/components/auth/styles'

export function StepGetKairo({ onFinish }: { onFinish: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[13.5px] leading-relaxed text-mute">
        Download Kairo for the computer you&rsquo;ll use to run your screens. Sign in to the app with this account after installing.
      </p>

      <div className="grid gap-2 sm:grid-cols-2" aria-label="Download Kairo">
        {[
          { label: 'Apple silicon', detail: 'Mac · M series', href: '/api/download/mac-arm64?source=onboarding' },
          { label: 'Intel Mac', detail: 'Mac · Intel', href: '/api/download/mac-x64?source=onboarding' },
          { label: 'Windows', detail: 'Windows 10 or later', href: '/api/download/windows-x64?source=onboarding' },
          { label: 'Linux', detail: 'AppImage · x64', href: '/api/download/linux-x64?source=onboarding' },
        ].map(({ label, detail, href }) => (
          <a key={href} className="flex items-center justify-between gap-3 rounded-xl bg-paper/5 px-3.5 py-3 text-paper transition-colors hover:bg-paper/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" href={href}>
            <span>
              <span className="block text-sm font-semibold">{label}</span>
              <span className="mt-0.5 block text-xs text-mute">{detail}</span>
            </span>
            <span aria-hidden="true">↓</span>
          </a>
        ))}
      </div>

      <button className={btnPrimary} type="button" onClick={onFinish}>
        Go to your account
      </button>
    </div>
  )
}
