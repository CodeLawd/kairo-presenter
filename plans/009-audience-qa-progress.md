# Plan 009 integration progress

Current status: A–C implemented and validated. Experimental Slido source is
implemented, off by default, and live public extraction/error/shutdown checks pass.
User deferred sign-in, so live authenticated moderator/pending verification remains
for a later session. No release or deployment was performed.

## A1 — complete (2026-11-01)

- Added shared question/source types and immutable normalisation, sorting,
  incremental merge and moderation helpers in `src/lib/audience.ts`.
- Added five tests covering text limits (including emoji), deterministic sorting,
  local moderation surviving source refreshes, source namespaces, duplicate updates,
  missing questions and restoring moderated questions.
- Drift check: program-service changes since the planning commit concern scripture
  navigation; the other changes are website copy/admin work. No A1 conflict.
- Ruling: new source questions always enter Review, even if the upstream source
  reports Approved. Existing Kairo moderation wins on every refresh. Explicit
  operator actions may move a question between any of the four states.
- Ruling: the initial integration increment is A1; A2–A4 remain before Phase A
  can ship as a user-facing feature. No cloud routes or Slido reading added.

## Verification

- New tests failed before implementation (missing audience module), then passed:
  `node --import tsx --test tests/audience.test.ts` — 5/5.
- `bun run typecheck` — passed.
- Targeted ESLint and `git diff --check` — passed.
- Full shared suite via `node --import tsx --test tests/*.test.ts` — 937 passed,
  5 failed because the sandbox blocks electron-store writes to user preferences:
  `lyrics-usr-title`, `media-folders`, `media-import`, `media-playlists`, `media-root`.
- `bun run test:main` — blocked at runner startup by sandbox denial of tsx's
  local IPC socket (`listen EPERM`); no main-process tests ran.
- `bun run lint` — 7 existing unused-variable errors in
  `video/src/v2/hero/OneTake.tsx`, `video/src/v2/social/SocialV2.tsx`, and
  `video/src/v2/walk/WalkthroughV2.tsx`; 29 warnings elsewhere.

## Next

A2: add the independent program question layer, presentation defaults and
normalisation, output rendering and the screen Look toggle. Preserve the existing
message/slide rendering paths and honour the plan's STOP condition.

## Continuation — 2026-11-01

- A2: independent question/join program layer added to surfaces and previews;
  existing message and slide rendering is unchanged. Question appearance and Look
  controls are available. Escaping and style-normalisation tests pass.
- A3/A4: singleton queue, dev-only sample source, typed IPC, coral Audience rail
  entry, separate moderation/show actions, filters/sort, live preview and join card.
- B/C: room Worker and SQLite Durable Object, single device-licence verification
  at creation, audience cookie identity, private review queue, deduplicated votes,
  persisted limits, hibernating sockets, desktop reconnect/pending moderation,
  QR join cards and phone draft acknowledgements implemented; validation ongoing.
- Ruling: reuse Wrangler's existing declarative `exports` for AudienceRoom. The
  installed Wrangler explicitly forbids mixing exports with migrations. A second
  migration list would make the existing Worker configuration invalid.
- Ruling: Audience is available to every activated device, using the existing
  licence check. There is no new paid-tier feature flag in the current contract.
- Ruling: abandoned rooms automatically close after 24 hours, then delete 24 hours
  later. Explicit End session starts the 24-hour deletion window immediately.
- D0 terms review: read https://www.slido.com/terms on 2026-11-01 (B2B terms
  updated 2023-10-06, effective 2023-11-05), especially sections 3, 6 and 7.
  No express prohibition of an event owner's automated reading of their own
  visible question data was found. Section 6.4 restricts framing/mirroring the
  service in another website; the planned adapter extracts question data only
  and does not embed Slido's service or artwork. Do not bypass authentication,
  probe private APIs, alter Slido content, or copy its branding. Initial interpretation was to proceed; superseded by the user gate below.
  A real event code is needed to validate current selectors; requested from user.

- User gate (2026-11-01): user provided throwaway event 9374525, but explicitly
  requires seeing the current terms findings before D1 proceeds. Findings were
  reported in chat. The already drafted adapter was removed from the integration
  and preserved outside the repository in `/tmp/kairo-slido-draft`. No event has
  been accessed. D1/D2 remain paused pending the user's direction after review.

## A–C verification complete

- Shared suite: 973 passed; main-process suite: 648 passed (rerun with the local
  IPC/preferences access those tests require). Desktop typecheck/build, website
  production build and Worker typecheck passed.
- Worker deploy dry run passed with `--containers-rollout=none`; the full dry run
  requires Docker, which is unavailable. No Worker or website was deployed.
- Real workerd + SQLite + hibernating WebSocket test passed, including private
  review, moderation, cookie identity, vote deduplication, 30 votes/minute,
  correlated vote errors, liveness auto-response, and ending sessions.
- 300 participants over 600,672 ms: 751 questions, 25 rounds. No lost questions;
  final operator queue equals room snapshot and vote totals match (7,800 votes).
- Desktop proxy disconnected for 60 seconds: queue retained, questions and votes
  caught up, and pending moderation replayed on reconnect.
- Browser checks: actual Audience component + real queue service in an isolated
  local harness; Approve stays off-screen, Show displays the card, Mark answered
  clears it. Phone tested at 375px in system dark appearance: acknowledged ask,
  private review, saved draft restored after reload. Light CSS is implemented.
- Fresh reviewer found remote-expiry cleanup, snapshot receive-budget mismatch,
  and rejected-vote rollback bugs. All three fixed, with regression tests.
- Lint remains blocked only by 7 existing unused-variable errors in the three
  video files listed above (29 existing warnings). New audience files lint clean.

## D authorization — 2026-11-01

User explicitly authorized a read-only adapter against owned test event 9374525,
behind an experimental setting off by default. No page/branding on program
screens, no writes upstream, all selectors in one file, loud parsing failure.
No mention in release notes or website. This supersedes the earlier D pause.

## D implementation in progress

- Experimental `audience.experimentalSlido` defaults to false and is checked in
  main before constructing a source. Disabling it stops all running adapters.
- Code-only resolves the event through its public code search. Moderator mode
  uses the same event address in a separate isolated sign-in window. No screen
  or web output receives a Slido URL, page, logo, source label or other branding.
- Public selectors verified on the owned event: `.question-item[data-qid]`,
  question-text/author test IDs and `.score__btn--plus > span`. Moderator selectors
  use question/user-name test IDs, questionText and accessible vote text.
- Event initially had 2 public questions, 0 votes and Pending 0. User then added
  two test questions; both appeared publicly and in Live, so the live pending
  visibility acceptance still needs a question actually held in Pending.
- Local real-Chromium selector fixtures pass, including hidden-card exclusion.
  Diagnosing first live Electron navigation failure before source acceptance.

## D public source verified; authenticated check deferred by user

- The actual isolated Electron adapter read 4 visible questions from event 9374525
  into Kairo Review. Author/vote selectors match the live participant page.
- Real Chromium fixtures verify moderator card parsing, including a pending card,
  and exclude hidden cards from participant parsing.
- Intentionally breaking the local text selector produces the requested error
  after 30 seconds; existing questions and Kairo moderation are retained.
- Main-process flag prevents constructing Slido sources while off. Turning it off
  destroys source/auth windows; quitting disposes sources without waiting for
  remote connections. A regression proves stopping another source leaves Kairo's
  join card up. A separate regression proves local shutdown cleanup.
- Review fixes: quit cleanup, denial of nested auth popups, and removal of temporary
  test authentication storage. Temporary sign-in test was closed and its isolated
  profiles removed when the user said they will sign in later.
- User explicitly deferred moderator sign-in. D2 sign-in UI, persistent isolated
  session and pending-view reader are implemented; live authenticated/pending
  acceptance is NOT claimed. The two added test questions were public (Pending 0).
- No upstream ask/vote/moderation action was used. No source page or branding was
  handed to program surfaces, no release-note or website mention was added.

## Final validation — 2026-11-01

- Shared suite: 980 passed. Main-process suite: 648 passed.
- Desktop typecheck/build passed; website production build and Worker types/dry
  run passed as recorded above. Final audience-focused suite: 16 passed.
- New audience/Slido files and tests lint clean; full lint still has the existing
  7 unused-variable errors in video files. `git diff --check` passes.
- Final live public adapter check: 4 visible questions into Review, intentional
  selector failure errors safely and retains queue/moderation, shutdown destroys
  source windows synchronously, and isolated test storage/profile cleanup passes.
- Experimental UI setting: Audience → Sources → Experimental Slido source.
  Main guards starts even if a renderer attempts to bypass the hidden controls.
- Final review findings addressed: remote-end cleanup, full-room snapshot budget,
  rejected-vote rollback, unrelated-source join-card clearing, application shutdown,
  nested auth popups, and isolated test authentication cleanup.
- Preserved concurrent packaging/locale work in `scripts/after-pack.cjs`,
  `tests/packaged-locales.test.ts`, and `package.json`'s language list.

## Pending queue clarification

Read the owned event's Q&A settings after the user could not find a pending view:
Slido explicitly reports Moderation off, with a plan upgrade required to change
that setting. This explains why both test questions went directly to Live.
No setting was changed. Live upstream pending verification remains deferred;
Kairo's independent Review/Approve queue is unaffected.

## Start-session bugfix — 2026-11-01

- Reproduced the user's exact failure: localhost:3000 is Nest and responds 404 to
  POST /v1/audience/rooms. CloudApiClient throws a plain ApiError object, which
  Electron had reduced to [object Object].
- Local desktop room requests/sockets now use the local Worker on port 8787;
  normal account HTTP stays on port 3000. Production keeps its configured API
  base. MAIN_VITE_AUDIENCE_API_URL permits an explicit override.
- Added Docker-free `bun run dev:audience` with a local Worker entry/config that
  verifies device licensing and organisation against the running Nest server only
  at creation. The Worker is running locally for this development session.
- API failures become real Error instances before IPC, and Audience strips the
  Electron wrapper. Missing local-service and unsupported-server errors explain
  the remedy. Local phone pages select the local Worker automatically.
- Sample visibility comes from main's actual flag capability; the unavailable demo
  button is hidden. Duplicate starts are idempotent, and the Slido form shows
  Connected/Connecting or offers Reconnect for a failed source.
- Verified actual desktop session 'Test Questions', join code 8CGWGR: Worker
  returned 201 and its operator socket upgraded with 101. No credentials were
  copied out of the desktop account session.
- End-to-end regression uses the actual CloudApiClient, real local Worker and an
  isolated HTTP account server: reproduces original 404, creates an authenticated
  room via Worker, preserves ordinary API routing, and keeps sockets off Nest.
- Final shared suite: 986 passed. Main suite: 648 passed. Typecheck, desktop and
  website builds, Worker typecheck, targeted lint and diff check passed. Fresh
  bugfix review found no actionable issues. Existing unrelated video lint errors
  remain as recorded earlier.

## Three-command development workflow — supersedes separate Audience startup

User requested only app, server and website. `server/bun run start:dev` now owns
both Nest and the local Audience Worker; `start:debug` does the same with debugging.
The root `dev:audience` alias and instructions to run it separately were removed.
Ctrl+C stops both process trees; an unexpected service exit shuts down its sibling.
Managed children use noninteractive stdin so detached process groups cannot be
suspended by terminal input handling. The old standalone Worker was stopped to
free its port; restart the server command once to adopt this workflow.

Verification: CLI entrypoints resolve, typecheck and targeted lint pass, shared
suite 988/988 passes. Real process integration covers start, Ctrl+C, sibling
failure propagation and grandchild cleanup on POSIX; Windows uses taskkill /T.
