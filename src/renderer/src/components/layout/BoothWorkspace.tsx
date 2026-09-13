import type { ReactNode } from 'react'
import MediaDock from '@/components/media/MediaDock'

/**
 * Page content + media dock on the left, live rail on the right at full height.
 * The dock stops at the rail instead of running under it.
 */
export function BoothWorkspace({
  rail,
  children,
}: {
  rail: ReactNode
  children: ReactNode
}): React.ReactElement {
  return (
    <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-surface">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        <MediaDock />
      </div>
      {rail}
    </div>
  )
}
