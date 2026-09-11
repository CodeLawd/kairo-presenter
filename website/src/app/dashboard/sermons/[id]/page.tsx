'use client'

/**
 * Unreachable by design.
 *
 * The recap itself is rendered by the sermons layout, so it can stay mounted
 * while the `[id]` segment changes. This file exists because the route needs
 * a page — it just never shows.
 */
export default function SermonDetailPage(): React.ReactElement {
  return <div className="hidden" aria-hidden />
}
