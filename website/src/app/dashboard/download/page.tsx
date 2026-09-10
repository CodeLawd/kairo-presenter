'use client'

import Link from 'next/link'
import { IconApple, IconWindows } from '@/components/landing/icons'

export default function DownloadPage(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Desktop app
          </h2>
        </div>
        <div className="px-5 py-5">
          <p className="max-w-[52ch] text-[14px] leading-relaxed text-mute">
            Install on the computer that runs ProPresenter, then sign in with the same account you
            use here.
          </p>
          <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
            <Link
              href="/#get"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.04] px-4 py-3 text-[13px] font-medium text-paper transition-colors hover:bg-white/[0.07]"
            >
              <IconApple /> macOS
            </Link>
            <Link
              href="/#get"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.04] px-4 py-3 text-[13px] font-medium text-paper transition-colors hover:bg-white/[0.07]"
            >
              <IconWindows /> Windows
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
