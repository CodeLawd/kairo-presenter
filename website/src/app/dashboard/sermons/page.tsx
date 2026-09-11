'use client'

/**
 * Unreachable by design.
 *
 * The sermons layout renders the centralized list itself when no recap is
 * open and only renders its children once an `[id]` is selected, so there
 * is no empty "select a recap" pane to hold. This file stays because the
 * route needs a default child — it just never shows.
 */
export default function SermonsIndexPage(): React.ReactElement {
  return <div className="hidden" aria-hidden />
}
