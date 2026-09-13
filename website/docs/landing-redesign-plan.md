# Kairo landing page — revised implementation plan

Reviewed 10 September 2026. This replaces the previous plan.
Scope: landing page layout and copy; preserve account flows and the existing stack.
Read `website/AGENTS.md` and the relevant bundled Next.js docs before implementation.

## 1. Review verdict

The original plan correctly removes the marquee, decorative numerals, repeated headline
styling, long problem narrative, and platform cards. Keep those changes.

Its proposed replacement is still too elaborate for a minimalist, classy, modern page:
five photos, three feature spreads, six additional cards, a privacy section, and repeated
workflow copy. Reduce the number of ideas and sections before styling them.

Recommended direction: a quiet dark page, clear typography, one useful product visual,
short explanations, and one consistent early-access action. Keep the existing amber brand
accent. Class comes from composition, legibility, and restraint.

### Evidence and review limits

- Started the existing website dev server after port 3001 was initially unavailable.
- Inspected the rendered local hero and feature section at the browser's desktop size,
  the page accessibility tree, and the landing components/styles.
- Opened both reference sites, inspected their rendered desktop heroes and page content.
- Reviewed the STT service and scripture auto-mode implementation to check risky claims.
- This is a design and plan review, not a full product certification. Mobile visual QA,
  end-to-end output tests, and packaged-build availability remain implementation checks.
- Remove the old “1,238 words / twice either reference” assertion: raw HTML includes
  scripts, hidden content, and duplication, and the comparison was not reliably measured.

### Current page findings

| Location | Finding | Required change |
|---|---|---|
| `website/src/components/landing/Hero.tsx:20` | Large thin/bold headline dominates the desktop viewport; two supporting paragraphs repeat the promise. No product visual appears in the hero. | One short headline, one paragraph, one primary action, a quiet explanatory link, and product evidence. |
| `website/src/components/landing/SplitFeature.tsx:36` | Giant numerals and repeated wide text ledgers add length without explaining the interface. | Remove numerals and replace the repeated spreads with one workflow section. |
| `website/src/app/globals.css:22` | Muted and faint text tokens make navigation, metadata, and feature descriptions difficult to read on black. | Measure contrast and brighten all meaningful secondary text. |
| `website/src/components/landing/Privacy.tsx:17` | Absolute local-processing claims conflict with cloud transcription. | Replace with a plain, accurate FAQ answer. |
| `website/src/components/landing/GetKairo.tsx:25` | “This Sunday” implies availability while the paragraph says builds are still in development. Multiple signup buttons add unnecessary choice. | State development status and provide one signup CTA. |
| `website/src/components/landing/Reveal.tsx:48` | Content starts invisible and depends on JavaScript to appear. | Remove landing-page reveal wrappers; content should be visible immediately. |
| `website/src/app/page.tsx:19` | No skip-to-content link; the sticky header also needs anchor offsets. | Add a skip link and `scroll-margin-top` to section targets. |

## 2. What to take from the references

[ProPresenter](https://www.renewedvision.com/propresenter): borrow the clear hero hierarchy,
short introductory block, and generous visual area below it. Its current hero places media
below the copy; the earlier description of a full-bleed venue backdrop was inaccurate.
It also uses interface imagery deeper in the page. Do not inherit its extensive navigation,
long feature catalogue, or every marketing phrase.

[Pewbeam](https://pewbeam.com/): borrow the immediate explanation of the product and the
simple progression from listening to display. Its hero has stylized verse cards, a figure,
a grid, and a bright glow. The earlier statement that both references are flat and plain
was inaccurate. Keep the clarity; avoid duplicating the visual effects or absolute speed
and accuracy promises.

Neither reference justifies banning screenshots. Kairo needs to show the operator what
happens between hearing a reference and sending a slide.

## 3. Target structure

```text
Header       Kairo | How it works | Questions | Sign in | Get early access
Hero         Short headline + one paragraph + primary CTA + text link
             One product visual immediately below; one compatibility line
How it works Three short steps: Listen → Review → Send
Details      Three compact, unboxed supporting facts
Questions    Five short, accessible FAQ disclosures
Early access Plain closing block with one signup CTA and availability note
Footer       Brand, useful links, existing trademark notice
```

The compatibility line belongs to the hero; it is not another bordered section.
No separate problem section, features divider, privacy promotion, photo CTA, or six-card grid.
Use `#how`, `#details`, `#faq`, and `#get` where applicable. Keep existing incoming
`#features` and `#privacy` links useful by retaining anchor targets on the workflow and
privacy FAQ answer respectively, or updating all known internal links.

Target 400–550 words, hard ceiling 600 including all FAQ answers, navigation, captions,
and footer copy. Count human-facing copy once, including collapsed answers; exclude
scripts and development overlays. Never remove a necessary qualification to meet a budget.

## 4. Visual direction

- **Palette:** near-black neutral canvas, soft white headings, readable gray body text,
  existing amber reserved mainly for primary actions. Avoid gradients, grain, stars,
  glows, decorative arcs, and oversized background numbers.
- **Typography:** use the existing Manrope family for headings and body on the landing
  page. Use 400/500/600 weights; remove the repeated thin/bold split entirely. No font
  swap is needed to achieve quality. Avoid monospace metadata and uppercase kickers.
  Do not remove font resources used by account pages without checking their references.
- **Scale:** desktop h1 approximately 56–64px; mobile 36–42px. Section headings 30–40px,
  body 16–18px with 1.55–1.65 line height. Meaningful small text at least 14px.
- **Width:** one 1120px maximum content container, 24px desktop/tablet gutters and
  20px mobile gutters. Body copy approximately 45–60 characters wide.
- **Spacing:** desktop section padding 72–96px; mobile 48–64px. Use an 8px spacing
  rhythm. Avoid stacking several independent spacers between sections.
- **Hero:** centered short copy within about 720px, with a contained product visual
  below it. At 1280×720 the primary CTA and beginning of that visual should be visible.
  Do not enforce a viewport-height hero. Later section copy is left-aligned.
- **Surfaces:** no cards around ordinary text. Three steps can sit in equal columns
  because they are a sequence, with subtle separators. Use a restrained 12px radius
  and thin border for the product visual; buttons around 8px radius and 44px tall.
- **Motion:** no automatic animation or scroll reveals. Brief hover/focus feedback is
  sufficient. Preserve native scrolling and reduced-motion behavior.

### Product visual

Use one fresh, tightly cropped capture of the actual Kairo workflow: detected passage,
review/queue, and send action. Show a plausible public-domain passage and neutral demo
content. Remove private account details. Do not squeeze the entire desktop UI into an
unreadable thumbnail or invent interface controls.

On mobile, supply a crop focused on the detected passage and review action. Explain the
three-step workflow in adjacent HTML so understanding never depends on tiny image text.
Caption: “Find a passage, review the slide, then send it.”

If a fresh capture cannot be produced, use a clearly labeled static workflow illustration
with Listen / Review / Send. It must not masquerade as an actual app screenshot or contain
fake functioning controls. Record that limitation in the implementation handoff.

Photography is optional and secondary: at most one relevant, licensed booth photo if it
adds context. No five-photo sourcing phase, no background photo behind body copy, and no
mandatory photo at the closing CTA. Retain old assets until references are checked; do not
delete `public/shots/` merely because a redesign proposes a different visual.

## 5. Proposed copy

These strings are the working copy for implementation. Resolve the factual checks in §6
before publishing; a polished sentence is not evidence that a feature ships.

### Header and hero

- Navigation: `How it works` · `Questions` · `Sign in`
- Primary CTA, used consistently: `Get early access` → `/signup`
- H1: **Scripture slides, without the scramble.**
- Body: `Kairo listens to your service and suggests Bible passages. Review the slide, then send it to your screen.`
- Secondary text link: `See how it works` → `#how`
- Compatibility line, subject to release verification: `For macOS and Windows. Connects to ProPresenter or NDI.`
- Small availability note: `In development. Sign up for early access.`

### How it works

Heading: `From spoken words to scripture slides`

| Step | Copy |
|---|---|
| Listen | Connect an audio feed from your sound desk. Kairo transcribes the service. |
| Review | See suggested passages and check the slide before sending. |
| Send | Put the selected slide on screen through ProPresenter or NDI. |

No “thirty seconds,” “instantly,” or guarantee that every paraphrase resolves correctly.

### Details

Heading: `Fits the way your team works`

Three unboxed items, one short sentence each:

- **Prepare ahead.** Import sermon notes to build a scripture playlist.
- **Choose your translation.** Use built-in Bibles or connect supported licensed translations.
- **Match your slides.** Set a theme and preview the slide before sending.

Keep songs, live meters, confidence thresholds, and implementation architecture out of
this short landing narrative. They can be explained in product documentation later.

### Questions

**Does Kairo replace the operator?**
`No. Manual mode lets your team review and send each slide. Automatic output is optional.`

**Can it recognize a paraphrase?**
`Kairo can suggest passages from the meaning of spoken words. Check each suggestion before sending it.`

**Do I need ProPresenter?**
`Use ProPresenter for the direct connection, or send slides to a compatible NDI receiver.`

**Does it work offline?**
`Built-in Bible lookup works offline. Live transcription currently uses Deepgram and requires an internet connection. Audio is sent to Deepgram for transcription.`

**Which Bible translations can we use?**
`Kairo includes built-in translations. Other translations depend on your API.Bible access and the publisher’s permissions.`

The privacy anchor should expose the offline/cloud answer, not point to an unrelated
collapsed disclosure. Do not label a generic FAQ link “Read the security details.”

### Closing CTA

- Heading: `Bring Kairo to your team.`
- Body: `Kairo is in development. Create an account to register your interest in early access.`
- Button: `Get early access` → `/signup`

Do not promise a build by Sunday, automatic email delivery, free access, or a price until
those release and account behaviors are verified. Keep sign-in available in the header
and mobile footer. Preserve the existing independence/trademark notice in concise form.
Only add legal/help links when their destination pages exist.

## 6. Factual checks before publishing

| Claim | Evidence or uncertainty | Decision |
|---|---|---|
| Fully offline transcription / local Whisper | `src/main/services/stt/index.ts` configures and connects Deepgram; no Whisper implementation was found in that service directory. | Remove Whisper and fully offline service claims. Verify the complete build before changing this conclusion. |
| No audio leaves the building | Deepgram cloud transcription is wired in the STT service. | Explicitly disclose cloud audio processing; local Bible storage does not imply local transcription. |
| Every slide always needs approval | `src/main/services/scripture/index.ts` contains optional auto mode; current FAQ acknowledges it. | Describe manual mode and optional automation, avoiding absolutes. |
| macOS/Windows and ProPresenter/NDI support | Current marketing lists them; this review did not run packaged builds or receiver tests. | Verify supported releases and output paths before publishing exact versions or compatibility requirements. |
| API keys stored in OS keychain | Previous plan confuses API-key storage with encryption-key storage for cached verses. | Omit the claim unless verified against storage implementation. |
| Paraphrase detection, note import, themes | Existing landing page describes them. | Exercise each workflow in the current app; soften or omit anything not available. |
| Early access delivery | Signup exists, but build delivery was not tested. | Describe registration only; test the account flow without promising delivery timing. |

Do not invent testimonials, church logos, customer counts, performance measurements,
licensing guarantees, or endorsements. Do not assume a US-only audience; use consistent,
plain international English instead of making spelling the focus of the redesign.

## 7. Implementation sequence

1. Verify the claims above and select the actual product capture or labeled illustration.
2. Centralize landing copy in `content.ts`, including hero, FAQ, CTA, and navigation labels.
   Update metadata in `layout.tsx` to remove the instant-output promise.
3. Recompose `page.tsx`: hero → workflow → details → FAQ → closing CTA. Replace the
   repeated `SplitFeature` layout and simplify `GetKairo`. Fold privacy into FAQ.
4. Adjust landing typography, colors, spacing, and buttons. Scope changes that would
   otherwise affect account screens. Remove decorative styles only after checking usage.
5. Remove landing reveal wrappers. Keep server components as the default; retain small
   client boundaries only where needed. An arbitrary two-client-component limit is not
   a substitute for accessible mobile navigation.
6. Add the product image through `next/image`, reserve its aspect ratio, supply responsive
   `sizes`, and lazy-load secondary images. Read bundled Next 16 image docs for current
   loading/preload APIs; measure LCP rather than declaring which element must be LCP.
7. Check obsolete components and assets with reference searches before removing them.
8. Run the checks below and attach desktop/mobile screenshots to the implementation handoff.

## 8. Acceptance checklist

- [ ] One clear product promise; hero paragraph no more than 30 words.
- [ ] Human-facing copy at most 600 words, including all five FAQ answers.
- [ ] Hero shows useful product evidence; no fabricated screenshot or tiny unreadable UI.
- [ ] No starfield, marquee, giant numerals, repeated split-weight headings, decorative cards,
      photo backdrop CTA, or content hidden pending JavaScript.
- [ ] All meaningful text meets WCAG AA contrast: 4.5:1 normal text, 3:1 large text.
- [ ] One h1, logical heading order, working skip link, visible keyboard focus, descriptive
      image alternative, accessible FAQ, and anchor offsets under the sticky header.
- [ ] Primary actions have comfortable touch targets; mobile users can reach sign-in and FAQs.
- [ ] Visually inspect 390px, 768px, and 1440px, plus 200% zoom. No horizontal overflow,
      clipped text, forced heading line breaks, or giant gaps. Do not hide overflow to mask bugs.
- [ ] Verify reduced motion, initial content before hydration, image sizing, and font loading.
- [ ] Primary CTA goes directly to signup; secondary hero link reaches the workflow.
- [ ] Every public claim passes §6; no unqualified local-processing or instant-output claims.
- [ ] Run `npx tsc --noEmit` and `npm run build` from `website/`; document any environment blockers.
- [ ] Smoke-test existing login/signup screens if shared tokens, fonts, or components changed.

Reference accessibility checklist: [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md).
Apply its accessibility and interaction checks while keeping this brief's sentence-case,
minimal visual direction.
