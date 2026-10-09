# Kairo interface direction

Kairo is a standalone church presentation desktop app. Operators prepare scripture,
songs, and media and control the audience screen from one workspace.

## Existing system

Runtime tokens are owned by `src/renderer/src/index.css` and mapped through
`tailwind.config.js`. Use Source Sans 3 for controls, body copy, and headings.
Use the existing surface layers, muted text scale, inputs, and buttons. The
palette is ink #11120D, paper #FFFBF4 and stone #565449; all tokens blend from
these. The accent (`teal-*`) is white in dark and ink in light, so CTAs are white
buttons with ink text. #6C91C2 (`live`) marks only what is on screen.

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
