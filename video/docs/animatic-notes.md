# Animatic review — October 27, 2026

This is the timing pass requested after treatment approval. It is not the final film.

## Review cuts

| Film | Size | Frame rate | Duration |
| --- | --- | --- | --- |
| Hero | 1920 × 1080 | 60 fps | 1:32 |
| Walkthrough | 1920 × 1080 | 60 fps | 3:30 |
| Social | 1080 × 1920 | 60 fps | 0:24 |

Files are in `video/out/animatic/`. Each film has a matching `.srt`, a timed
`*-voiceover.txt` recording script, a poster PNG and sampled review frames.
The short captions and SRT are generated from the same JSON records.

## Changes from the treatment

The scratch narration is shorter so the main actions have room to breathe.
There is a quiet hold before the hero send. The trust language explicitly
assumes Automation is off; the app also supports optional automatic sending.
The app's audio meter is green/amber in the reconstruction, reserving red
for live presentation tally. A border-box correction prevents verse text
from extending beyond its slide, and the radiant motif scales consistently
between the 1080p and 4K compositions.

## What is ready to judge

Story order, headline sizing, camera choreography, paraphrase-to-passage
sequence, send timing, chapter pacing, social readability and end cards.

## What remains before final delivery

- Replace labeled sanctuary illustrations with properly licensed real footage.
- Capture the clean demo workspace and replace labeled workflow studies.
- Match the animated Operator components against the current captured UI.
- Record or supply the voiceover; timed captions are the allowed scratch substitute.
- Choose the music library before adding any music. No unlicensed audio is used.
- Add subtle sound design, mix and measure -14 LUFS after audio is available.
- After animatic notes, render the 3840 × 2160 hero master and final exports.
- Perform the full frame-by-frame and audio checklist on those final exports.

TypeScript checking and sampled PNG inspection validate the animatic only;
they do not constitute final footage or audio approval.

## Shared-workspace updates during rendering

Another editor added real Operator captures and replaced the caption generator
with `scripts/captions.mjs`. These changes were preserved. The review bundle
includes those captures. `bun run animatic` now uses the existing JS generator.
The source-of-truth recording scripts are the files alongside the exported cuts.
Some scratch captions use seven words; the verifier records these as final-pass
warnings against the six-word brief. No final caption compliance is claimed.
