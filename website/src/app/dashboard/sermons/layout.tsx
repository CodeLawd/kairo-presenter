'use client'

import { useSelectedLayoutSegment } from 'next/navigation'
import { SermonReader } from '@/components/sermon/SermonDetail'
import { SermonList } from '@/components/sermon/SermonList'

/**
 * Recaps as two modes, not two columns.
 *
 * With nothing open the list is the whole page, centralized at a comfortable
 * reading width — there is no empty dashed box holding the place of content
 * that does not exist yet. Opening a recap docks the list to the left and
 * slides the recap in on the right; each pane fills the viewport height and
 * scrolls independently, so reading never moves the list.
 *
 * The list lives here rather than in `page.tsx` so that opening a recap does
 * not unmount it — no refetch, no lost scroll position, no "Load more" pages
 * thrown away on every click. The open recap lives here too, so switching
 * sermons updates the reader instead of remounting a skeleton.
 *
 * Narrow screens get one pane at a time: the list, or the open recap with a
 * back link — a two-column squeeze does not fit a phone.
 */
export default function SermonsLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  // The `[id]` segment when a recap is open, `null` on the index route.
  const openId = useSelectedLayoutSegment()

  if (!openId) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-5 py-2">
        <header className="animate-in fade-in slide-in-from-bottom-2 text-center duration-300">
          <p className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-faint">
            Sermon recaps
          </p>
          <h1 className="mt-2 font-display text-[26px] font-semibold tracking-[-0.02em] text-paper">
            What was preached
          </h1>
          <p className="mt-1.5 text-[13.5px] text-mute">
            Every service, written up. Select one to read it.
          </p>
        </header>
        <div className="animate-in fade-in slide-in-from-bottom-3 duration-300">
          <SermonList />
        </div>
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-0 w-full lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r border-white/15 bg-gradient-to-b from-white/[0.02] to-transparent lg:block">
        <div className="h-full overflow-y-auto">
          <SermonList />
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4 md:p-6 lg:h-full lg:px-8 lg:py-5">
        <SermonReader sermonId={openId} />
        <div className="hidden" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  )
}
