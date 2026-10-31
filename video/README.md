# Kairo films

Remotion project for Kairo's hero film, walkthrough and social cut. The brief is
`../docs/product-video-prompt.md`. Treatment, VO and claims check: `docs/script.md`. Design
rules: `docs/directors-brief.md`.

| Composition | Size | Length |
|---|---|---|
| `Hero` / `Hero1080` | 3840×2160 / 1920×1080, 60 fps | 1:32 |
| `Walkthrough` | 1920×1080, 60 fps | 3:30 |
| `Social` | 1080×1920, 60 fps | 0:24 |

```bash
npm install
npm run studio                      # preview
node scripts/captions.mjs           # captions + .srt from the approved VO (src/compositions/shots.ts, docs/script.md)
node scripts/vo.mjs                 # scratch voice (macOS "Samantha"); re-times the captions to the voice
node scripts/sfx.mjs                # synthesized sound effects → public/audio/sfx
node scripts/render-films.mjs       # render with sound, -14 LUFS, posters → out/films/
node scripts/probe.mjs Hero1080 out/probe 30 48   # stills for review
```

## How it's built (src/v2)

- `Operator.tsx`: the Operator screen rebuilt element by element from captures of the running
  app (`captures/reference`, `captures/operator-metrics.json`), so every piece can animate.
  `OperatorTest` renders it in the captured state for side-by-side checks.
- `motion.ts`: closed-form springs, keyed values, a camera with zoom in log space, a seeded PRNG.
- `Kinetic.tsx`: masked word-by-word type.
- `hero/`: the hero's scenes. `OneTake.tsx` is the 31 s continuous take (transcript → match →
  card → send → room).
- `Chapter.tsx`, `views.tsx`, `walk/`: the walkthrough's chapters and app views.
- `social/`: the 9:16 cut.
- `Soundtrack.tsx`, `sound-cues.ts`: voice, music (ducked under the voice, with its lift on the
  send) and effects on picture cues.

## Capturing the real app

Start the app with `npm run dev -- --remoteDebuggingPort 9222 --inspect 9229`, then:

```bash
node scripts/demo-sermon.mjs attach   # once per app run
node scripts/demo-sermon.mjs start    # real detector; no mic, no Deepgram
sh scripts/demo-reset.sh              # fresh transcript and detector, demo service open
node scripts/demo-sermon.mjs say "Jesus said, drink the water I give, and you'll never be thirsty again."
node scripts/cdp.mjs shot op-staged   # 2× PNG → captures/raw/
```

Demo lines enter where Deepgram's results do, so detection is the app's own. Nothing is saved:
service-record logging is switched off in memory and the demo service lives only in the
renderer. Restarting the app undoes all of it.

Keys (a TTS service, if used later) go in `video/.env`, which git ignores. Never in code.
