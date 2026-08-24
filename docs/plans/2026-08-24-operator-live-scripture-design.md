# Operator Live Scripture Design

## Outcome

When a preacher names a passage range, Operator immediately creates one card per verse. As the preacher reads, the matching card becomes active and the queue advances to the next verse near the end of the current verse. Repeated model detections must not create a single merged range card or duplicate overlapping cards.

## Detection and data flow

Explicit references are parsed locally from every finalized transcript segment before the slower LLM analysis. The LLM remains responsible for quotations, paraphrases, and ambiguous references. A semantic dedup cache treats a range and any verses inside that range as overlapping scripture, preventing `Genesis 8:22` and `Genesis 8:15-22` from being emitted as competing detections during the same cache window.

The orchestrator expands a detected range into individual `ScriptureSuggestion` records with shared passage metadata. This makes the renderer contract unambiguous and ensures every downstream output contains one verse only.

## Operator experience

Operator groups related suggestions under the detected passage while rendering every verse as an individual card. Cards reuse the Scripture tab's compact visual hierarchy: passage heading, fixed verse cards, clear focus/live states, and restrained metadata.

Final transcript segments are compared with the queued verse text. A strong phrase overlap activates the matching verse; reaching the latter portion of a verse preselects the next verse so the operator can follow the reading without searching. This tracking changes focus only in manual mode. In automation mode, it may drive sequential projection through the existing presentation path.

## Reliability and testing

Pure helpers cover range expansion, semantic overlap deduplication, and transcript-to-verse progress. Tests use Genesis 8:15-22 fixtures and verify literal expected references and progression. Full typecheck, lint, tests, and build run before the Electron process is restarted for a live replay.

## Smart follow and themed queue refinement

Explicit references are also inspected on interim STT updates through the local parser only; interim speech never invokes the LLM. This removes the final-utterance wait for complete spoken citations.

After an operator sends a verse, a passage follow state tracks only that live verse. Matching verse-word indexes accumulate across transcript updates and survive unrelated sermon commentary. The next verse is eligible only when at least 55% of the live verse and enough tokens from its final 30% have been heard. Commentary therefore leaves the current ProPresenter output untouched, while resumed reading completes the retained evidence and advances once.

Operator renders detected suggestions with the same `VerseThemePreview` used by Scripture. Every card receives the currently selected overlay theme and output formatting options. Compact two-column previews replace expanded transcript-style status panels; reference, confidence, live/reading state, and dismiss remain secondary metadata beneath each WYSIWYG card.
