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

      <p className="m-0 text-[13.5px] leading-relaxed text-mute">
        Install Kairo on the booth machine, then sign in with the same account you use here.
      </p>

      <button className={btnPrimary} type="button" onClick={onFinish}>
        Finish
      </button>
    </div>
  )
}
