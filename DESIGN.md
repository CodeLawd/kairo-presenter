# Kairo interface direction

Kairo is a standalone church presentation desktop app. Operators prepare scripture,
songs, and media and control the audience screen from one workspace.

## Existing system

The macOS top bar and workspace navigation rail use native under-window vibrancy
with a translucent surface-header tint and backdrop blur. Root shell backgrounds
stay transparent so the material is visible; workspace content stays opaque.
Other platforms, increased contrast and reduced transparency use solid chrome.
The top bar and navigation frame share #242424 in dark mode and the same 62%
material tint, above the #181818 workspace. The workspace meets the frame directly with a 16px
top-left radius and subtle 0.5px top/left borders; omit extra top gaps. Active navigation icons
use a rounded elevated neutral fill, with a quieter tertiary fill on hover.
The Live preview keeps the rail's consistent secondary surface; the workspace
border separates it from the frosted header without changing the panel background.
Shared pane-edge and hairline utilities use --panel-border-width (0.5px) and
--panel-border-color (75% surface-border) for consistent panel, sidebar and dock
separation. Keep focus rings and selected/live outlines stronger than these dividers.
Lyrics use one continuous responsive slide grid per song, filling each row across
section boundaries. Preserve section colors, labels, numbering and hotkeys;
zoom controls the minimum card width. Each playlist song starts its own grid.
The sermon notes review modal always uses a scoped light theme with dark ink,
pale panels and a 0.5px neutral border, independent of the app theme. Its detected-reference
search filters by reference or translation, preserving original numbering and the
full import analysis; previous/next navigation follows the filtered results.
Review has a labelled playlist-name field, source filename, live scan status,
and a distinct scripture sidebar with search, match counts and reference jumps.
Use the shared Radix dialog behavior for focus containment and Escape dismissal.
The footer names the outcome (Create playlist) and reports passage count. Disable
creation while edits are awaiting a scan or scanning has failed; offer Retry scan.
The Live popover is a compact, flat menu like ProPresenter: Start/Stop Capture,
a thin inset divider, then Capture Settings…. Separate Syphon output switches
and Syphon Settings… with another thin divider. Omit boxes, settings gears,
descriptive headings and saved-file messages. Keep source/status in tooltips,
recording time beside Stop Capture, and actionable failures inline.
Capture Settings closes with Save and never starts or stops recording.

Runtime tokens are owned by `src/renderer/src/index.css` and mapped through
`tailwind.config.js`. Use Source Sans 3 for controls, body copy, and headings.
Use the existing surface layers, muted text scale, inputs, and buttons. The
dark palette uses neutral charcoal: workspace #181818, panels #202020,
controls #2C2C2C, elevated controls #353535 and borders #404040, matching the
Codex reference without a blue cast. The blue action accent and semantic tool,
status and live colors remain distinct. Light-theme tokens keep their own scale.

Video output refresh stays icon-only. Rotate the refresh icon while its scan is
pending, disable repeat clicks, and respect reduced motion. Report the result or
detection error inline afterward, including when the inventory is unchanged.
Unavailable card channels retain their specific profile/compatibility explanation.
The Hardware tab shows the detected Desktop Video version. Working legacy
interfaces show a muted compatibility-mode note; only missing or unsupported
drivers offer the Blackmagic download page. Card profile and empty-inventory
problems keep their own guidance rather than recommending a driver update.

Added screens and feeds offer Delete in their right-click menu, targeting that
row even when another screen is selected. Keep the existing confirmation and
header delete action. Screen edits persist immediately; deferred theme edits
use the current shared screen list. An explicitly empty list stays empty after
restart, and save failures show an inline error rather than silently succeeding.

Shape editing opens immediately after insertion. Keep Elements available in every
theme-settings tab, with a clear Edit action and a route back from the element
inspector. Show horizontal/vertical flip as labelled pressed-state buttons and
six labelled alignment actions grouped under Align to slide. Alignment positions
the element's layout box without resizing it. Flips mirror inside that box before
rotation; all edits use the normal theme save and undo/redo flow.

Detected scripture cards use the same VerseThemePreview chrome as the Scripture
tab: themed 16:9 preview, reference-and-number footer, and shared selected/live
border treatment. Detection state and provenance stay below the card without a
second reference label; cue, queue and dismiss actions keep their existing behavior.

## Search credentials

Settings → API Keys uses the existing ProviderKeyRow controls. DeepSeek stays
visible under Lookups regardless of the scripture detection provider: the same
key powers primary lyric search and can also power detection when selected.
Brave is the optional search fallback. Keep secret drafts and save/clear behavior
in the shared credential controls.

## First-run onboarding

Modelled on ProPresenter's welcome window, shown **once per install, on first
launch — before any account exists**. A title bar ("Welcome to Kairo"), then:

1. **Tour** (`welcome`) — six slides, one per core feature: Present, Scripture,
   Songs, Documents, Themes & Media, Screens. Dot paging, arrow keys, Continue
   and Skip Tour — nothing else, so the tour stays about the product.
2. **Account** (`account`) — "Create your account" by default (sign in is one
   toggle away, which is how returning users get in), then the emailed code. It cannot be skipped; the wizard
   moves on by itself once the session is confirmed, and seeds the church name
   from the account's org and the timezone from this computer.
3. **Configure Screens** (`output`) — audience and stage display pickers plus a
   link to the full Screens window. Optional.
4. **Welcome** — after the last page, and whenever setup is skipped (Set Up
   Later / Escape, both only once signed in): the mark comes into focus and one
   glint of light crosses it; "Welcome to Kairo" rises in letter by letter, then
   a ready line, three quick starts (Find a verse / Add a song / Import a
   document) and Start using Kairo.

5. **Coach tips** — when the welcome closes, spotlight tips over the real UI
   (`CoachTour`): seven short ones on the Operator (workspaces rail, transcript
   Start, Detected verses, Automation, live preview, Live / Clear, Screens), or
   one on the tab a quick start opened. The window dims, the
   target shows through a cutout that glides between steps; clicking the target
   works and advances; Skip / Escape end it. Targets use `data-tour` attributes.

Setup pages carry an accent progress bar on the footer; the back link names the
page it returns to and skips the account once signed in. `App` renders the
wizard instead of the sign-in wall on first run and keeps the same instance
mounted across sign-in. Afterwards, signed-out launches get the plain sign-in
wall. Installs from before the wizard skip the tour and account; a configured
one never sees setup.

Flat and solid per the app style: surface tokens, no shadows, no translucency,
no 3D transforms, no Live badges. Onboarding text is #ECECE9 in dark (`--ob-text`),
softer than the app's paper white. Separation comes from fill steps and spacing, not
borders: title bar and footer are a shade lighter, setup rows are filled cards.

Motion is CSS only (`onboarding.css`): the dialog scales in; slides exit and enter
in the direction of travel with staggered text and a further-travelling
illustration; callout lines draw in; each mock-up plays one small story; the
active dot stretches into a pill; the progress bar fills; errors shake once. Account access stays under the launch gate;
ProPresenter and API keys remain in Settings. Every setup page is optional.
Screen picks save immediately; the profile saves on Open Kairo. Failed writes show
an inline retryable error and navigation waits for pending writes. Escape closes
setup (the timezone picker closes first). Focus is trapped and restored.

On narrow windows hide the tour illustrations and stack setup rows. Respect
reduced motion.

## Policy sources

The standalone direction and compact visual flow were approved in this chat on
2026-10-06. Account access is defined in `src/lib/cloud/auth-state.ts`. This change
introduces no billing, deletion, permission, or legal-policy changes.

## Quit confirmation

Use a branded in-app alert dialog with the existing neutral KairoMark, surface
fills, and shared buttons. Keep Kairo open receives initial focus; Escape cancels.
Live outputs remain active until Quit Kairo is confirmed. The modal is global,
including onboarding and account screens, and sits above workspace overlays.

## Online lyrics review

Online previews wait for source-line selection by DeepSeek when its key is
configured. Preserve source wording, language, repeats and stanza structure.
Use the shared LyricsReviewNotice in search and quick-open previews: successful
cleanup is labelled Reviewed by DeepSeek; missing keys or failed reviews show an
Unverified lyrics notice explaining that the original text is shown. A review
that finds no matching lyrics blocks preview/import. Preview and import share a
short-lived source snapshot so importing does not bypass cleanup.

DeepSeek also classifies retained source lines into verse, chorus, bridge and
other musical sections, including pages without headings. Section starts must
cover the retained lyrics in source order and cannot start on a bilingual gloss.
Kairo generates canonical headings and sequential verse numbers locally; model
responses never supply replacement lyric text or free-form labels.

Online search retains source text in a bounded, ten-minute main-process cache.
The top two results not already in the library prepare reviewed previews in the
background as the list appears. Background work is capped at two concurrent
previews, deduplicated across searches, and never holds up the results list.
Candidate lyric pages load concurrently in a bounded batch, retaining search
order. Selection/import reuses cached or in-flight preparation; review remains
required before a preview can be labelled reviewed.
