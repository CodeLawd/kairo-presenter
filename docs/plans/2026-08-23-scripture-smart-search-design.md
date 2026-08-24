# Scripture Smart Search Design

## Goal

Make manual scripture lookup fast enough for live use: accept shorthand references, complete Bible book names with Tab, and surface likely verse matches from remembered words without ever projecting or adding a verse automatically.

## Interaction

The search field accepts conventional references and relaxed whitespace shorthand. For example, `jos 1 5 9` resolves to `Joshua 1:5–9`. While a user types the beginning of a Bible book, an inline completion appears; pressing Tab accepts it and preserves any numeric suffix already entered. Enter always performs the lookup and previews results. It never sends a result to ProPresenter or adds it to a sermon playlist.

When the input looks like remembered verse text rather than a reference, ProAutomate searches the local Bible database after a short debounce. It shows a small ranked suggestion list beneath the input. Arrow Up and Arrow Down change the highlighted suggestion, Enter previews it, clicking previews it, and Escape closes the list. Suggestions can appear while typing when enough words are present, but no suggestion is committed without Enter or a click.

## Architecture and safeguards

Reference normalization is a pure shared helper built from the canonical 66-book catalog. It recognizes aliases and prefix completions without needing the SQLite database. The main-process search service normalizes a relaxed reference before lookup; otherwise it keeps the existing full-text search behavior. The renderer debounces suggestion queries and ignores stale responses so fast typing cannot replace current suggestions with older results.

The UI distinguishes a book completion from verse-text matches and keeps keyboard behavior predictable. Empty, one-character, and numeric-only inputs do not trigger phrase suggestions. Results remain previews with the existing explicit Add and Send controls. Tests cover shorthand normalization, numbered books, book completion, and non-reference text classification; typecheck and build verify the renderer integration.
