# Kairo films: treatment and voiceover (step 2, for approval)

House voice: plain, warm, confident. At most 14 words a sentence. US spelling. About 140 wpm.
Every claim below is checked against the code (see "Claims check" at the end).

Decisions from step 1:
- **Trust** is about control, not local audio. Transcription and paraphrase matching run in
  the cloud today, so the film never says "no audio leaves the building" or shows Whisper.
- **No confidence score on screen.** The Operator queue doesn't show one. The hero moment is
  the transcript line → matched words light up → reference chip → passage lands in the queue.
- Scratch track is **timed captions**; no TTS yet. Music is chosen at the animatic.

---

## 1. Hero film (16:9, ~92 s)

The preacher's on-screen words are the preacher's own paraphrase, not verse text. Verse text
on screen is KJV.

| # | Time | Beat | Picture | Voiceover |
|---|------|------|---------|-----------|
| 1 | 0:00–0:08 | Cold open | Dark sanctuary, the pastor mid-sentence. A hand hovers over a booth keyboard. The pastor's line types on: *"Jesus said, drink the water I give, and you'll never be thirsty again."* | *(room tone, no VO)* |
| 2 | 0:08–0:18 | The problem | The volunteer's view: a search box, a guessed reference, a wrong chapter. The cut rate tightens. Cut to black. | The pastor goes off script. Nobody planned that verse. / In the booth, someone is guessing at a reference. / By the time it's up, the moment has passed. |
| 3 | 0:18–0:24 | Title | Radiant lines warp in from the center. "Because every moment matters." Then the Kairo logo. | *(silence under the lines; music lifts)* |
| 4 | 0:24–0:45 | Listens and matches | Illustration: the sound desk feed flows into Kairo as a waveform. Push into the real Operator view, transcript scrolling, meter moving. The pastor's line arrives; "drink the water I give" lights up; lines draw to **John 4:14**. The passage drops into the queue. The radiant lines flare once behind it. | Kairo takes a clean feed from the sound desk and listens. / It follows the sermon word by word. / When the pastor quotes Scripture, Kairo finds the passage. / Even when it's paraphrased, and nobody says where it's from. / It's staged in your queue, in your translation, ready. |
| 5 | 0:45–0:55 | You send it | The operator's finger over send. One beat of silence. Press. The live rail outlines red; the projector in the room fills with John 4:14 (KJV). The congregation reads along. | You read it. You press send. / *(beat)* / And the whole room reads along. |
| 6 | 0:55–1:15 | The rest of Sunday | A rhythmic montage of real UI, one card each: sermon notes becoming a playlist; a song with colored sections; the theme editor; screens and an NDI feed; auto-follow moving to the next verse. | Kairo runs the rest of Sunday, too. / Import your sermon notes. Every reference becomes a verse. / Songs keep their sections. Themes look exactly as they will on screen. / Drive your screens, or send NDI to the stream. / Arm a passage, and the next verse moves up as it's read. |
| 7 | 1:15–1:24 | Trust | Illustration: the transcript and staged verses flow freely, but a single gate sits before the screen, and only a person's press opens it. Type: "You approve every slide." | Kairo suggests. You decide. / Nothing reaches the screen until your team sends it. |
| 8 | 1:24–1:32 | End card | Radiant lines settle. Logo. "Free during early access." kairopresenter.com. Mac and Windows marks. | Kairo. Free during early access, on Mac and Windows. / Because every moment matters. |

**VO words:** 168 → about 72 s spoken, plus about 20 s of silence and holds. **Runtime ≈ 92 s.**

On-screen type (≤ 6 words, ≤ 2 lines): "Because every moment matters." · "It heard the verse." · "You send it." · "Sermon notes, ready Saturday." · "Songs keep their sections." · "What you see goes out." · "Every screen. Every stream." · "Follows the reading." · "You approve every slide." · "Free during early access."

---

## 2. Walkthrough (16:9, ~3:30): "One Sunday with Kairo"

Calmer pace and longer holds. Chapter title cards use the same type system.

**Chapter 1: Set up (0:00–0:35)**
Welcome to Kairo. Let's walk through one Sunday, from setup to benediction. / First, connect your screens. Kairo shows each one on a canvas. / Add an NDI feed if your switcher or stream takes one. / Pick your translation. KJV, BSB and BBE are built in. / Others come through your church's license.

**Chapter 2: Saturday (0:35–1:15)**
Most of the work happens the day before. / Import your sermon notes. Kairo reads every reference it finds. / Review them, and they become a playlist of verses. / Now open the Theme Editor and design the slide once. / The preview is exactly what goes out on Sunday.

**Chapter 3: Songs (1:15–1:45)**
Open Lyrics and import a song. / Kairo keeps its sections: verse, chorus, bridge. / Add songs to the set, and present them in order.

**Chapter 4: The sermon (1:45–2:40)**
When the sermon starts, open Operator and press Start. / Kairo listens to the feed from your sound desk. / The meter shows it's hearing, and the transcript scrolls as the pastor speaks. / When a passage comes up, Kairo stages it in your queue. / It works from meaning, so a paraphrase still finds the verse. / A range comes through as slides, in order. / Live output is on top. Your queue is below. / Stage the next verse while this one is still live. / Arm a passage, and Kairo follows the reading verse by verse. / Nothing goes on screen until you send it.

**Chapter 5: Everything else (2:40–3:15)**
Need something nobody said? Search by reference, or by a phrase. / Put a document or a web page on screen. / Drop in backgrounds from your media folder. / On a Mac, record any output to a movie file.

**Chapter 6: Benediction (3:15–3:30)**
That's one Sunday with Kairo. / It's free during early access, at kairopresenter.com. / Because every moment matters.

**VO words:** ≈ 330 → about 2:25 spoken plus chapter cards and holds ≈ 3:30.

---

## 3. Social cut (9:16, ~24 s, works with sound off)

Burned-in captions are the story; the VO repeats them where present.

| Time | Picture | Caption |
|------|---------|---------|
| 0–3 s | Pastor, dark sanctuary | The pastor quotes a verse. |
| 3–6 s | Booth, hand over keyboard, empty search | Nobody planned it. |
| 6–9 s | Radiant lines flare | *(no caption; lines only)* |
| 9–13 s | Transcript line, matched words light up | Kairo heard it. |
| 13–16 s | John 4:14 drops into the queue | Found the passage. Even paraphrased. |
| 16–19 s | Press send; the screen fills (KJV) | You press send. |
| 19–24 s | Radiant lines, logo, URL | Because every moment matters. kairopresenter.com |

---

## Claims check (code, 2026-10-27)

| Said or shown | Where it lives |
|---|---|
| Listens to an audio input, live transcript, level meter | `operator/Operator.tsx` (input meter, transcript), `main/services/stt/` (Deepgram) |
| Matches paraphrases | `main/services/scripture/detector.ts` (`detectionType: "paraphrase"`) |
| Staged in your translation; change translation | Operator queue passage header, translation dropdown |
| Ranges as ordered slides | `splitVerseSuggestions`, `groupScriptureSuggestions` |
| Auto-follow ("Reading v14") | Operator queue, `updatePassageFollow` |
| Sermon notes → playlist | `SermonNotesReviewModal`, `PlaylistSidebar` |
| Songs with sections | `lyrics/`, `section-colors.ts` |
| Theme preview = output | `theme/ThemeEditor.tsx` |
| Screens, NDI, Blackmagic | `screens/`, `main/services/ndi/`, `video-devices/` |
| Capture (Mac) | `main/services/capture/`, header capture section |
| Documents, web pages | `documents/`, `web/` |
| KJV, BSB, BBE built in, offline | `src/lib/bible-translations.ts` (`bundled: true`), `resources/bible.db` |

**Not claimed:** local/Whisper transcription, "no audio leaves the building", confidence
score on screen, API keys (the licence replaced them), ProPresenter, pricing beyond early
access.
