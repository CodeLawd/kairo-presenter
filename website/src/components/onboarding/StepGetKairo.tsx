'use client'

import { btnPrimary } from '@/components/auth/styles'

/**
 * The account is ready, but desktop builds are not available yet.
 */
export function StepGetKairo({ onFinish }: { onFinish: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col gap-5">
      <p className="m-0 text-[13.5px] leading-relaxed text-mute">
        There isn&rsquo;t a desktop build to install yet. Your account is set up while we prepare early access for macOS and Windows.
      </p>

      <button className={btnPrimary} type="button" onClick={onFinish}>
        Go to your account
      </button>
    </div>
  )
}
