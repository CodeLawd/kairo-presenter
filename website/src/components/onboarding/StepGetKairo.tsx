'use client'

import Link from 'next/link'
import { btnPrimary, btnSecondary } from '@/components/auth/styles'
import { IconApple, IconWindows } from '@/components/landing/icons'

/**
 * The handoff out of the browser and into the booth.
 *
 * There are no build artifacts yet, so both platform buttons point at the
 * landing page's early-access section rather than a download that does not
 * exist — the same story the marketing page tells.
 */
export function StepGetKairo({ onFinish }: { onFinish: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Link className={btnSecondary} href="/#get">
          <IconApple /> macOS
        </Link>
        <Link className={btnSecondary} href="/#get">
          <IconWindows /> Windows
        </Link>
      </div>
      <p className="m-0 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
        Early access
      </p>

      <div className="mt-1 border-t border-line-soft pt-6">
        <p className="m-0 text-[13.5px] leading-relaxed text-mute">
          Already installed it? Kairo shows a code on the booth machine — enter it here and that
          computer signs itself in, with no password typed at the desk.
        </p>
        <Link className={`${btnSecondary} mt-4`} href="/activate">
          Pair this machine
        </Link>
      </div>

      <button className={btnPrimary} type="button" onClick={onFinish}>
        Finish
      </button>
    </div>
  )
}
