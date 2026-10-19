import type { LyricsReview } from '@shared/ipc'

/** Shared by online search and quick-open previews. Review is cleanup, not certification. */
export function LyricsReviewNotice({ review }: { review?: LyricsReview }): React.ReactElement | null {
  if (!review) return null
  if (review.status === 'reviewed') {
    return (
      <p className="text-[11px] leading-relaxed text-zinc-500">
        Reviewed by DeepSeek{review.removedLines > 0 ? ' · Unrelated page text removed' : ''}. Check the lyrics before importing.
      </p>
    )
  }
  const detail = review.reason === 'missing-key'
    ? 'Add a DeepSeek key in Settings → API Keys to review online lyrics.'
    : review.reason === 'too-large'
      ? 'This source was too large to review safely.'
      : 'DeepSeek could not complete the review.'
  return (
    <div role="status" className="rounded-lg bg-surface-tertiary px-3 py-2.5 text-[12px] leading-relaxed text-zinc-400">
      <p className="font-semibold text-zinc-200">Unverified lyrics</p>
      <p className="mt-1">{detail} The original text is shown; check for unrelated content before importing.</p>
    </div>
  )
}
