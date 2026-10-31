# Director's brief: hero film v2

The v1 animatic was a slideshow: captures pushed and crossfaded, labels in corners, stick
figures. v2 rebuilds the film as one continuous visual chain.

**Reference style:** a Linear launch film crossed with an Apple keynote product demo. Dark
and quiet, one accent colour, real UI filmed like a physical screen, type that arrives word
by word, and no cut where a transformation can carry the eye.

**Promise in one line:** the pastor's words become the verse on the screen, and you press send.

**Visual system:** one object travels the whole film. A line of sound becomes the
transcript, then the matched phrase, then the verse, then the card, then the slide in the
room. Every scene hands that object to the next.

## Rules (from the motion-design skill, adapted to Remotion)
- Everything is a pure function of the frame. No timers, no CSS transitions.
- Springs with a damping ratio of at least 0.72 and a tiny overshoot at most. No linear moves.
- The camera is keyed as `[t, zoom, x, y]` and zoom is interpolated in log space. Never zoom
  in and straight back out.
- One thing moves at a time. Everything else holds or drifts slowly.
- Type rises masked, word by word (a 55 ms stagger and a small rotation), and every title
  sits on one line.
- Shared elements carry every handoff. The phrase that lifts out of the transcript is the
  phrase that lands in the verse.
- No frozen frames except the final hold. Something always settles or drifts.
- One accent: blue `#3B6BFF` for what is picked. Red is only for what is live. The radiant
  lines carry the only other colours.
- Banned: particles, glow chrome, rainbow gradients, emoji, cartoon bounce, corner labels,
  and fake people.

## States

| t (s) | State | Carries into the next |
|---|---|---|
| 0–8 | **Hook.** Black. One thin line of sound breathes. The pastor's line rises word by word. | the line of sound |
| 8–18 | **Problem.** The words drift up and fade (the moment passing). A search field slides in; guesses are typed, wrong results flick, a thin timer line races. The pace tightens, then black. | black |
| 18–24 | **Title.** Radiant lines warp out of the centre. "Because every moment matters." rises, then collapses into the logo, which opens like an eye. | the centre point |
| 24–29 | **Listens.** The line of sound flows in from the left and becomes the input meter of the real Operator, which resolves around it. | the meter |
| 29–34 | **Hears.** The camera moves onto the transcript. The pastor's line types in, the matched words light up one by one, and the reference chip appears. | the matched phrase |
| 34–39 | **Matches.** The phrase lifts out of the transcript. Lines draw from its words to the KJV verse, and the radiant lines flare once. | the verse |
| 39–45 | **Staged.** The verse shrinks and flies into Detected as the real card. | the card |
| 45–55 | **Send.** The cursor arrives, a beat of silence, then the press. The border draws red, "On screen" appears, the output fills and the tally turns red. The live output grows to fill the frame and pulls back as the screen in a dark room. | the slide |
| 55–75 | **The rest of Sunday.** Five 4-second vignettes of real UI, each morphing into the next: notes, then playlist, then song sections, then theme editor, then outputs, then auto-follow. | the card |
| 75–84 | **Trust.** The card waits at a gate; it moves only on a press. "Kairo suggests. You decide." | centre |
| 84–92 | **End.** Radiant lines settle, then the logo, "Free during early access.", kairopresenter.com, and Mac · Windows. | hold |

## Layers
Background (onyx with a soft top light) → radiant lines (title, match flare, end) → the
camera plane (the rebuilt Operator at 1600×960, filmed) → shared-element overlay (phrase,
verse, card) → kinetic type → cursor.

## Sound plan
Silent for review; VO timing is shown as captions. Final: recorded VO, a licensed score with
its lift on the send at 48 s, soft UI ticks on the keystrokes and the press, and a low swell
as the slide fills the room. Mixed to −14 LUFS.

## Fidelity
The Operator is rebuilt from `captures/reference/op-*.png` and `captures/operator-metrics.json`:
Source Sans 3, a 60 px header, a 56 px rail, the transcript at x 57 (280 wide), Detected at
x 337 (804 wide), the live rail at x 1140, a 182 × 126 card with a 22 px footer, and the
church's real blue-gradient slide theme. Any state shown is one the app reached in the
captures.
