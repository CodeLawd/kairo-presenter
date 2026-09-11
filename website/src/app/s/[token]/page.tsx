import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { RECAP_PAGE_WIDTH, SermonRecapPreview } from '@/components/pdf/SermonRecapDocument'
import { apiTarget } from '@/lib/api-target'
import type { PublicSermon } from '@/lib/sermons'
import { normalizeSermonSummary } from '@/lib/sermon-summary'

/** The share token is not in the build, so this page can never be static. */
export const dynamic = 'force-dynamic'

/**
 * Fetched server-to-server.
 *
 * The token never reaches the client bundle, and a reader with no account
 * never touches the dashboard's session machinery. Wrapped in `cache` so
 * `generateMetadata` and the page body share one request rather than hitting
 * the API twice per view.
 */
const fetchSermon = cache(async (token: string): Promise<PublicSermon | null> => {
  try {
    const response = await fetch(
      `${apiTarget()}/v1/public/sermons/${encodeURIComponent(token)}`,
      { cache: 'no-store', headers: { 'X-PA-Client': 'web' } },
    )
    if (!response.ok) return null
    return (await response.json()) as PublicSermon
  } catch {
    return null
  }
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<Metadata> {
  const { token } = await params
  const sermon = await fetchSermon(token)
  if (!sermon) return { title: 'Recap unavailable', robots: { index: false, follow: false } }
  const summary = normalizeSermonSummary(sermon.summary)

  return {
    title: `${summary.headline} · ${sermon.churchName}`,
    description: summary.bigIdea.slice(0, 160),
    openGraph: {
      title: summary.headline,
      description: summary.bigIdea.slice(0, 160),
      type: 'article',
    },
    // The link is unguessable and meant to be passed to a person, not indexed.
    robots: { index: false, follow: false },
  }
}

export default async function PublicSermonPage({
  params,
}: {
  params: Promise<{ token: string }>
}): Promise<React.ReactElement> {
  const { token } = await params
  const sermon = await fetchSermon(token)
  if (!sermon) notFound()

  return (
    <main
      className="mx-auto flex w-full flex-col gap-6 px-4 py-12 sm:px-0 md:py-16"
      style={{ maxWidth: RECAP_PAGE_WIDTH }}
    >
      <SermonRecapPreview
        title={sermon.title}
        speaker={sermon.speaker}
        preachedAt={sermon.preachedAt}
        churchName={sermon.churchName}
        summary={sermon.summary}
      />

      <footer className="text-[12.5px] text-faint">
        This recap was written from the service recording by{' '}
        <Link href="/" className="text-mute transition-colors hover:text-paper">
          Kairo
        </Link>
        .
      </footer>
    </main>
  )
}
