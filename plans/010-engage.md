# Plan 010: Engage — engagements, moderators, replies and polls

> **Executor instructions**: Build in phase order. Each phase ships on its own and
> leaves the app releasable. Honour the STOP conditions. Read Plan 009 and its
> progress notes first: Engage grows the Audience Q&A built there; it does not
> replace it.
>
> **Drift check (run first)**: `git diff --stat HEAD -- src/lib/audience*.ts src/main/services/audience server/cloudflare website/src/app/q src/renderer/src/components/audience`

## Status

- **Priority**: P2
- **Effort**: L (about 4–5 focused weeks for phases 1–4)
- **Risk**: MED (moderators get access without an account; data now lasts beyond a day)
- **Depends on**: `plans/009-audience-qa.md` (A–C shipped)
- **Category**: feature
- **Planned at**: 2026-11-01

## What Engage is

Engage is Kairo's audience feature. One **engagement** is one event: a name, one join
code, and the **activities** inside it — Q&A and Polls first, more later. Today's
Audience Q&A becomes the Q&A activity of an engagement.

| Who | Where | Can |
|---|---|---|
| **Owner** | The Kairo app (signed in, activated) | Everything. The only one who puts anything on screen. |
| **Moderators** | The website, from an emailed link. No Kairo account. | Approve, hide, fix typos, reply, mark answered, run polls, send a question to the owner. |
| **Audience** | The audience page, from the join code. No account. | Ask, vote, answer polls, read replies. |

## Decisions (agreed 2026-11-01)

1. **Screens stay with the app.** Moderators cannot put anything on screen. They can
   **Send to presenter**, which pins a question to the top of the owner's queue with
   the moderator's name.
2. **Replies are public by default.** A moderator's written answer shows under the
   question for everyone. Per reply, they can choose **Only the asker** instead.
3. **Engagements can be made ahead of time**, in the app or on the website (owner only),
   with an optional date range like Slido's. People can join any time it's open.
4. **Moderators sign in by email link, not by account.** See *Moderator access*.
5. **Slido stays a Q&A source** that feeds an engagement's Q&A queue in the app.
6. **Icons**: Engage on the rail keeps the coral hue with a chat-bubble icon. Activities
   use their own icons — Q&A a speech bubble with a question mark, Polls a bar chart.
   No phone icons.
7. **Moderators can fix typos** in a question before approving it. The original text
   is kept; the owner's queue marks it *Edited by <name>*. Approved questions can't be edited.
8. **No plan limits for now.** Engage, moderators and polls are available to every
   activated organisation. Pricing comes later and is out of scope.
9. **Wording**: the UI never says "phone". The engagement's name field is labelled
   **Title**; the audience side is "the audience page".

## Current state (from Plan 009)

- `server/cloudflare/audience-room.ts` — one SQLite Durable Object per room: questions,
  votes, limits, settings (`review`, `showQuestions`, `names`), operator token hash.
  Rooms close 24 h after creation and are deleted 24 h after closing.
- `server/cloudflare/audience-routes.ts` — `POST /v1/audience/rooms` (owner, verified once
  against the Nest licence + org), `GET …/session` (audience cookie), `GET …/ws`.
- `src/main/services/audience/` — queue service, Kairo source (operator socket), Slido
  source. `src/renderer/src/components/audience/` — workspace, sidebar, queue, style.
- `website/src/app/q/[code]/` — the audience page.
- Email: Nest `server/src/mail/mail.service.ts` over Brevo (`sendWelcome`,
  `sendPasswordReset`, …). The Worker does not send email today.

## Design

### Data

Rename on the wire and in code: `audience room` → `engagement`. Keep the old routes
working for one release (they map to the new ones) so an older app can still run a Q&A.

```ts
// src/lib/engage.ts (new; audience.ts keeps the queue helpers)
interface Engagement {
  id: string                 // Durable Object name
  code: string               // join code, as today
  name: string
  orgName: string
  startsAt: number | null    // optional window, informational + auto-close
  endsAt: number | null
  status: 'draft' | 'open' | 'closed'
  activities: { qa: AudienceRoomSettings & { enabled: boolean }; polls: { enabled: boolean } }
  activePollId: string | null
}
interface Moderator { id: string; email: string; name: string | null; invitedAt: number; lastSeenAt: number | null; revoked: boolean }
interface Reply { id: string; questionId: string; text: string; by: string; audience: 'everyone' | 'asker'; at: number }
interface Poll { id: string; title: string; options: { id: string; text: string }[]; multiple: boolean; state: 'draft' | 'open' | 'closed'; showResults: boolean }
```

- All of it lives in the engagement's Durable Object (new tables: `moderators`,
  `replies`, `polls`, `poll_votes`). The DO stays the single record.
- **Lifetime**: no 24-hour close. An engagement closes when the owner closes it, or
  at `endsAt + 24 h`, or after 30 days without activity. Deleted 30 days after closing.
  The owner can delete sooner.
- **Listing**: the DO can't be queried across instances, so keep a small index of
  engagements per organisation. Use the existing Nest + Mongo (`server/src/orgs`) with a
  new `engagements` collection holding only `{ orgId, id, code, name, status, dates }`.
  The Worker writes to it through Nest on create / close / delete (one call each, not
  per message). Sockets still never pass through the container.

### Moderator access (no Kairo account)

1. Owner enters an email (and optional name) in the app → `POST /v1/engage/:id/moderators`
   with the operator token.
2. The DO stores the moderator and a **hashed** one-time sign-in token (random 32 bytes,
   expires in 72 h, single use). Nest sends the email via Brevo (new
   `sendEngageInvite(to, engagementName, link)` template) — the Worker calls Nest's
   internal endpoint authenticated with a shared secret binding.
3. The link `kairopresenter.com/engage/m/<token>` exchanges the token for a
   **moderator session cookie** (HttpOnly, Secure, SameSite=Lax, scoped to
   `/v1/engage/<id>`, 30 days, rotating). The token is then dead.
4. A moderator who lost the session asks for a new link on the moderation page by
   entering their email; only emails on the list get one (same response either way).
5. **Remove** in the app revokes the moderator: the DO closes their sockets and rejects
   the cookie at once.
6. The app shows each moderator with *Invited* / *Active now* / *Last seen*.

Forwarded email = access, by design. Mitigations: single-use link, revocation,
visible list of who is moderating, rate-limited link requests.

### Moderation view on the website

`website/src/app/engage/[id]/moderate/` — the same queue as the app (tabs Review /
Approved / Answered / Hidden, Popular / Recent), plus:
- **Edit** on questions still in Review, to fix typos (original kept).
- **Reply** box under each question (Everyone / Only the asker).
- **Send to presenter** (pins it in the app; the app shows "Sent by <name>").
- **Polls** tab: create, open, close, show results to the audience.
- No screen controls, no settings that change who can join, no moderator management.

Connects to the DO as `role=moderator` (cookie-authenticated). The DO's permission
check becomes role-based: `owner` ⊃ `moderator` ⊃ `audience`.

### The app

- Rename the **Audience** workspace to **Engage**. Sidebar: the engagement card (name,
  code + QR, joined, Show code, Close) and its activities; **Moderators** section
  (invite by email, list, remove); Slido sources as today.
- Middle: tabs **Q&A** | **Polls**. Q&A is today's queue plus replies under questions
  and the "Sent by …" pin. Polls: list, editor, Open / Close, **Show results on screen**.
- A list of the organisation's engagements to reopen one made ahead of time.

### Audience page

`/q/<code>` gains a header switch **Q&A | Polls** when both are on. Replies show under
questions ("Answered by the team"), private replies only to their asker (matched by the
audience cookie). Polls: one open poll at a time, vote, then results if the moderator
shows them.

### Screens

New program layer `poll` next to `question`: title, options, live bars. Same rules as
the question layer — its own Look toggle, nothing else on screen changes.

## Phases

| Phase | Ships | Effort |
|---|---|---|
| 1 | Rename to Engage (app, routes with back-compat, audience page); lasting engagements; org index; create ahead of time; reopen from a list | ~1 week |
| 2 | Moderator invites, email link sign-in, sessions, revoke; website moderation view for Q&A; Send to presenter | ~1–1.5 weeks |
| 3 | Replies (everyone / only the asker) in the app, website and audience page | 2–3 days |
| 4 | Polls: create, open/close, vote, results for the audience and the `poll` screen layer | ~1.5 weeks |
| Later | Word cloud, rating, quiz; export after the event | — |

## Commands

| Purpose | Command | Expected |
|---|---|---|
| Quality gate | `npm run typecheck && npm test && npm run test:main && npm run lint` | pass (lint: only the known `video/` errors) |
| Room | `bun run test:audience-room` (extend for moderators, replies, polls) | pass |
| Website | `bun run --cwd website build` | exit 0 |

## Acceptance

- An engagement made on Monday can be opened from the app on Sunday with the same code.
- Invite → email arrives → link opens the moderation view without any account → the
  link no longer works a second time → Remove in the app ends their session within
  a second.
- A moderator approves, replies and sends to presenter; the app shows all three live.
  The moderator has no way to change screens.
- A private reply reaches only the asker (a second audience device does not get it).
- Poll: 300 simulated audience members vote; totals in app, website and on screen agree.
- Old app version (Plan 009 routes) can still start and run a Q&A during the transition.

## STOP conditions

- If the Worker would need to proxy every socket message through Nest to check a
  moderator, stop — checks must happen in the DO with the session cookie.
- If the moderator email cannot be sent without storing the raw sign-in token anywhere
  but the email itself, stop and redesign.
- If renaming breaks an app already in churches (Plan 009 routes), keep the old routes
  and record the deprecation instead of removing them.
