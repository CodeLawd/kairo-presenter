import { AppShot } from './AppShot'
import { AUDIENCE } from './content'
import { Detail } from './Detail'
import { ICONS } from './icons'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { SplitFeature } from './SplitFeature'
import { card, cx, display, feature, iconTile, lede, section, thin, wrap } from './primitives'

export function Problem(): React.ReactElement {
  return (
    <section className={cx(section, wrap)}>
      <Reveal>
        <Kicker n="00" label="The problem" />
        <h2 className={cx(display, 'mt-[22px] max-w-[16ch] text-[clamp(31px,3.9vw,52px)]')}>
          <span className={thin}>The verse gets quoted.</span> Then you start typing.
        </h2>
        <div className="mt-6 grid gap-x-[clamp(32px,5vw,80px)] gap-y-5 lg:grid-cols-2">
          <p className={lede}>
            You catch a phrase. You guess the book. You type it into the search, pick the right verse
            out of the results, check the translation, and send it. Thirty seconds gone. The sermon
            moved on twenty seconds ago, and everyone in the room watched it happen.
          </p>
          <p className={lede}>
            Kairo takes the finding off your plate. It hears the reference, pulls the passage in your
            translation, and drops it into your queue while you are still listening. What reaches the
            screen is still your call, made in one click instead of thirty seconds.
          </p>
        </div>
      </Reveal>
    </section>
  )
}

export function Audience(): React.ReactElement {
  return (
    <section className={cx(wrap, 'relative pb-[clamp(72px,8.5vw,124px)]')}>
      <Reveal>
        <Kicker n="01" label="Who it is for" />
        <h2 className={cx(display, 'mt-[22px] max-w-[18ch] text-[clamp(31px,3.9vw,52px)]')}>
          <span className={thin}>Built for the people</span> running the service.
        </h2>
        <div className="mt-[clamp(34px,4vw,52px)] grid gap-4 min-[860px]:grid-cols-3">
          {AUDIENCE.map((item) => {
            const Icon = ICONS[item.icon]
            return (
              <div key={item.who} className={card}>
                <div className={iconTile}>
                  <Icon />
                </div>
                <h3 className="mb-2 mt-4 font-display text-[17px] font-bold tracking-[-0.025em]">
                  {item.who}
                </h3>
                <p className="m-0 text-[14.5px] leading-[1.6] text-mute">{item.body}</p>
              </div>
            )
          })}
        </div>
      </Reveal>
    </section>
  )
}

export function FeaturesDivider(): React.ReactElement {
  return (
    <div className={wrap}>
      <p
        id="features"
        className="flex items-center gap-[22px] py-[clamp(56px,7vw,96px)] font-mono text-[11px] uppercase tracking-[0.32em] text-mute"
      >
        <span className="rule-left h-px flex-1" aria-hidden="true" />
        Features
        <span className="rule-right h-px flex-1" aria-hidden="true" />
      </p>
    </div>
  )
}

const Rule = (): React.ReactElement => <hr className="hairline m-0 h-px border-0" />

/**
 * The eight feature sections.
 *
 * The `zoom`/`x`/`y` numbers on each Detail are tuned to the 2200x1365
 * screenshot geometry — see public/shots/README.md before replacing a capture.
 */
export function Features(): React.ReactElement {
  return (
    <>
      <SplitFeature
        n="02"
        label="Listening"
        title="It hears the room."
        lede="Point Kairo at any audio input on the machine. The transcript runs down the side of the operator view as the service happens, with the input level underneath so you can see it is still hearing something."
        bullets={[
          { lead: 'Any input on the machine', rest: 'Take a clean send off the sound desk instead of a laptop mic.' },
          { lead: 'Deepgram or local Whisper', rest: 'Stream it out for accuracy, or run the model on the machine and keep the audio in the building.' },
          { lead: 'You can see it working', rest: 'A live signal meter, and a pipeline you can pause at any point without closing anything.' },
        ]}
        visual={
          <Detail
            src="/shots/operator.png"
            alt="The live transcript panel in Kairo, filling with the sermon as it is spoken, with an audio input signal meter at the bottom."
            zoom={430}
            x={0}
            y={50}
            ratio="4 / 5"
          />
        }
      />

      <Rule />

      <SplitFeature
        n="03"
        label="Detection"
        title="It finds verses nobody announced."
        lede={
          <>
            Reading out &ldquo;Ephesians three fourteen to twenty-one&rdquo; is the easy case. So is
            quoting the words with no reference at all. Both arrive in the detected list as finished
            slides.
          </>
        }
        bullets={[
          { lead: 'It matches on meaning', rest: 'A paraphrase still resolves to the passage, and every match carries a confidence score.' },
          { lead: 'You see the actual slide', rest: 'Detections render in your theme, so what you are approving is what the room is about to get.' },
          { lead: 'Auto-follow a reading', rest: 'Arm it on a passage and the next verse moves up on its own as the reading carries on.' },
          { lead: 'Ranges come through whole', rest: 'Ephesians 3:14–21 arrives as eight slides in order, not one wall of text.' },
        ]}
        visual={
          <Detail
            src="/shots/operator.png"
            alt="Detected scripture in Kairo, shown as a grid of themed slide previews with confidence scores and auto-follow armed."
            zoom={230}
            x={34}
            y={16}
          />
        }
        flipped
      />

      <Rule />

      <SplitFeature
        n="04"
        label="The desk"
        title="You approve every slide."
        lede="Live output at the top, the queue underneath. Stage a verse with the plus on a detection, or search for one yourself, then click the row to send it to ProPresenter."
        bullets={[
          { lead: 'Stage before you send', rest: 'Line up the next few moments while the current verse is still on screen.' },
          { lead: 'Search by reference or by memory', rest: 'Type John 3:16, or type “love is patient” and let it find the rest.' },
          { lead: 'Watch the pipeline', rest: 'ProPresenter, speech-to-text and detection each report their own state, so you know which one went quiet.' },
          { lead: 'Clear actually clears', rest: 'One control that knows how the last slide was sent and clears that path, not a different one.' },
        ]}
        visual={
          <Detail
            src="/shots/operator.png"
            alt="The live output preview and staging queue in Kairo, with ProPresenter, speech-to-text and detection status indicators."
            zoom={364}
            x={100}
            y={16}
            ratio="4 / 5"
          />
        }
      />

      <Rule />

      <SplitFeature
        n="05"
        label="Preparing"
        title="Most of Sunday can be ready by Saturday."
        lede="Drop in the sermon notes. Kairo pulls out every reference, looks each one up, and saves them as a playlist you can walk through with Previous and Next while the message runs."
        bullets={[
          { lead: 'Import sermon notes', rest: 'Every reference in the document becomes a verse in the list, already looked up.' },
          { lead: 'One playlist per message', rest: 'Named and saved, so the same series opens again the next time it is preached.' },
          { lead: 'Walk it live', rest: 'Previous and Next step the playlist. Go live sends whatever is selected.' },
          { lead: 'Or skip it entirely', rest: 'Detection still runs alongside. The playlist is a head start, not a requirement.' },
        ]}
        visual={
          <Detail
            src="/shots/scripture.png"
            alt="Saved sermon playlists in Kairo with their verse counts, and the ordered list of references built from imported sermon notes."
            zoom={380}
            x={0}
            y={6}
            ratio="4 / 5"
          />
        }
        flipped
      />

      <Rule />

      <SplitFeature
        n="06"
        label="Translations"
        title="Your translation, and an honest fallback."
        lede="Pick the translation once. Public-domain versions live inside the app; licensed ones come through your church's own API.Bible key. When a verse is not available in your pick, the app says so on the card instead of quietly failing."
        bullets={[
          { lead: 'Public domain ships inside', rest: 'KJV, WEB, ASV and others. No key, no network, no expiry.' },
          { lead: 'Licensed versions use your key', rest: 'You only ever see the ones your key is actually licensed for.' },
          { lead: 'Download one for offline use', rest: 'A chapter at a time, with pause and resume if the download is interrupted.' },
          { lead: 'It never shows stale text', rest: 'API.Bible wants a refresh every 30 days. Past that the app asks you rather than showing old text.' },
          { lead: 'The fallback is labelled', rest: '“NLT unavailable — showing KJV” sits right on the verse, so nobody is guessing which one went out.' },
        ]}
        visual={
          <AppShot
            src="/shots/scripture.png"
            alt="The scripture workspace in Kairo: the NKJV translation picker, verse cards rendered in the current theme, and a notice reading NLT unavailable, showing KJV."
          />
        }
      />

      <Rule />

      <SplitFeature
        n="07"
        label="Themes"
        title="Slides that match your service."
        lede="Build the look inside the app and drag the verse where you want it. The canvas is the renderer, so what you approve in the preview is exactly what leaves the machine."
        bullets={[
          { lead: 'Place it by hand', rest: 'Drag the verse and the reference around the canvas. Resize either from the corners.' },
          { lead: 'Backgrounds', rest: 'Transparent, solid, gradient, image or video, set to cover, contain or stretch, with an opacity control.' },
          { lead: 'Fit text to box', rest: 'Turn it on and a long passage stays inside the frame instead of running off the bottom.' },
          { lead: 'Keep a library', rest: 'Broadcast, Warm paper and Midnight are built in. Save your own next to them.' },
          { lead: 'Draft without risk', rest: 'Adjustments preview privately. Apply to output when you are ready, or discard the draft.' },
        ]}
        visual={
          <AppShot
            src="/shots/theme.png"
            alt="The Kairo theme editor: background and fit controls beside a live 1920x1080 canvas with a draggable verse and reference."
          />
        }
        flipped
      />

      <Rule />

      <SplitFeature
        n="08"
        label="Songs"
        title="Your songs live here too."
        lede="Import a song, let it break into labelled sections, and push the set to ProPresenter from the same place you send scripture."
        bullets={[
          { lead: 'Search your library or the web', rest: 'By title, by artist, or by a line you only half-remember.' },
          { lead: 'Sections keep their labels', rest: 'Chorus, Verse 2, Verse 3, each with its own slide count.' },
          { lead: 'Translate a song inline', rest: 'Auto-detect the language and render an English line under the original. Undo it if you would rather not.' },
          { lead: 'Push, preview or export', rest: 'Send the set to ProPresenter, check it first, or take it out of the app entirely.' },
        ]}
        visual={
          <AppShot
            src="/shots/lyrics.png"
            alt="The lyrics workspace in Kairo showing a Hausa worship song split into labelled sections with English translations under each line."
          />
        }
      />

      <Rule />
    </>
  )
}

export function Output(): React.ReactElement {
  return (
    <section className={cx(feature, wrap)}>
      <Reveal>
        <div className="text-center">
          <Kicker n="09" label="Output" className="text-left" />
          <h2 className={cx(display, 'mx-auto mt-[22px] max-w-[18ch] text-[clamp(31px,4vw,52px)]')}>
            <span className={thin}>Two ways</span> to reach the screen.
          </h2>
          <p className={cx(lede, 'mx-auto mt-5 max-w-[62ch]')}>
            Kairo drives ProPresenter&rsquo;s message layer over its network API, which is the
            quickest route when ProPresenter is your playback. If it is not, or you would rather the
            switcher handle the composite, the app puts out a transparent 1080p NDI source of its
            own. Set it per theme, or leave it on Auto and let the app take whichever path is up.
          </p>
          <div className="mx-auto mt-[clamp(38px,5vw,62px)] max-w-[900px]">
            <Detail
              src="/shots/theme.png"
              alt="The NDI status panel in Kairo: sender available, sending frames and ProPresenter video input bound, each reporting ready."
              zoom={180}
              x={100}
              y={95}
              ratio="16 / 5"
            />
            <p className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
              Every leg of the output path reports for itself
            </p>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
