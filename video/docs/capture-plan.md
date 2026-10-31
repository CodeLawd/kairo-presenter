# Capture plan (step 1)

Source of truth: the running dev app (`npm run dev`) and `src/renderer/src/components/`.
Every capture is the real app at 2× (device scale 2), window 1800×1100 pt → 3600×2200 px,
cropped/framed in Remotion.

## Demo service ("Sunday, demo church")

- **Workspace:** a separate demo workspace folder (`~/Documents/Kairo Demo`) so nothing touches
  the real library. Church name "Grace Community" (fictional), no emails or keys on screen.
- **Translation:** KJV (built in). Verse text on screen is KJV only.
- **Sermon plan:** "Living Water" — John 4:13–14, John 3:16–17, Psalm 23:1–4, Isaiah 40:31.
- **Song set:** public-domain hymns only (Amazing Grace, Come Thou Fount, Holy Holy Holy,
  It Is Well) so lyrics on screen are safe.
- **Theme:** dark, clean sans-serif slide with the reference underneath, one hero theme for
  scripture and one for lyrics.
- **Media:** two backgrounds from licensed stock (logged in CREDITS.md).

## Screens to capture

| # | Screen (component) | What we need | Used in |
|---|--------------------|--------------|---------|
| 1 | Operator (`operator/Operator.tsx`) idle | Full layout: live rail on top, staging queue, transcript column, input meter | Hero 24–45s, walkthrough ch. 4 |
| 2 | Operator, listening | Transcript scrolling, level meter moving, a scripture run highlighted with its reference chip | Hero hero-moment (rebuilt + matched to this) |
| 3 | Operator, detection staged | Passage group (reference, translation dropdown, prev/next preload), verse cards as ordered slides | Hero 24–55s |
| 4 | Operator, sent | Live rail with red outline, live output preview filled | Hero 45–55s |
| 5 | Operator, auto-follow | "Reading v14" pill on the live passage, next verse moving up | Montage, walkthrough |
| 6 | Scripture (`scripture/Scripture.tsx`) | Search by reference and by phrase; playlist sidebar | Montage, walkthrough ch. 3 |
| 7 | Sermon notes import (`SermonNotesReviewModal`) | Notes → references → playlist | Montage, walkthrough ch. 2 |
| 8 | Lyrics (`lyrics/Lyrics.tsx`) | Library rail, song sections with colours, set list | Montage, walkthrough ch. 5 |
| 9 | Theme Editor (`theme/ThemeEditor.tsx`) | Editing a slide; preview = output | Montage, walkthrough ch. 2 |
| 10 | Documents (`documents/Documents.tsx`) | One imported document as slides | Walkthrough only |
| 11 | Web (`web/WebPage.tsx`) | A web page on screen (our own site) | Walkthrough only |
| 12 | Screens (`screens/ScreenConfiguration.tsx`) | Arrangement canvas, NDI feed, video device fields | Montage, walkthrough ch. 1 |
| 13 | Capture (header capture section) | Recording an output to a movie file | Montage, walkthrough ch. 6 |
| 14 | Settings → Scripture | Translations, offline Bible packs, auto-mode threshold | Walkthrough ch. 1 |

Plus 3–5 s screen recordings (60 fps) of: the level meter, transcript scrolling, the live rail
transition on send, auto-follow advancing. These are reference for the rebuilt components and
B-roll for the walkthrough.

## Rebuilt in Remotion (matched pixel-for-pixel against captures 2–4)

Transcript line arriving · matched words lighting up (`bg-tint-teal` / `text-teal-200`) and the
reference chip · passage group landing in the queue · send → live rail red outline · live output
filling. Uses tokens from `src/renderer/src/index.css` (dark).

## How to capture

This shell has no Screen Recording permission, so `screencapture` fails. Proposed route:
restart dev once with a debugging port, and drive/capture the window over the Chrome DevTools
Protocol (`Page.captureScreenshot` at device scale 2, `Page.startScreencast` for motion):

    npm run dev -- --remoteDebuggingPort 9222

Alternative: grant Screen Recording to the Claude app (System Settings → Privacy & Security),
and capture with `screencapture -l <window>`.

## Decisions (2026-10-27)

- Capture route: restart dev with `npm run dev -- --remoteDebuggingPort 9222`, drive it over
  DevTools from a separate demo workspace folder.
- Trust beat is about control; no local-audio or Whisper claims. No confidence score on screen.
- Scratch track: timed captions. Music library chosen at the animatic.
- `website/public/images/kairo-worship-hero.webp` looks AI-generated and is 1672 px wide, so
  it isn't used. People and venue shots come from licensed stock.
