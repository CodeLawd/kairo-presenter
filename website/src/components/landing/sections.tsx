import { ALSO } from './content'
import { Kicker } from './Kicker'
import { Reveal } from './Reveal'
import { SplitFeature } from './SplitFeature'
import { card, cx, display, lede, section, thin, wrap } from './primitives'

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

/** The core loop — the three sections that carry the pitch. */
export function Features(): React.ReactElement {
  return (
    <>
      <SplitFeature
        n="01"
        label="Listening"
        title="It hears the room."
        lede="Point Kairo at any audio input and the transcript scrolls live beside the operator view. An input meter sits underneath, so you always know it is still hearing the room."
        bullets={[
          { lead: 'Any input on the machine', rest: 'Take a clean send off the sound desk instead of a laptop mic.' },
          { lead: 'Deepgram or local Whisper', rest: 'Stream it out for accuracy, or run the model on the machine and keep the audio in the building.' },
          { lead: 'You can see it working', rest: 'A live signal meter, and a pipeline you can pause at any point without closing anything.' },
        ]}
      />

      <Rule />

      <SplitFeature
        n="02"
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
      />

      <Rule />

      <SplitFeature
        n="03"
        label="The desk"
        title="You approve every slide."
        lede="Live output up top, the staging queue below. Add a verse from a detection or search for one yourself, then click to send it straight to ProPresenter."
        bullets={[
          { lead: 'Stage before you send', rest: 'Line up the next few moments while the current verse is still on screen.' },
          { lead: 'Search by reference or by memory', rest: 'Type John 3:16, or type “love is patient” and let it find the rest.' },
          { lead: 'Watch the pipeline', rest: 'ProPresenter, transcription and detection each show their own state, so you know which one went quiet.' },
          { lead: 'Two ways to the screen', rest: 'ProPresenter over its network API, or a transparent 1080p NDI source straight into the switcher.' },
        ]}
      />
    </>
  )
}

/** Everything else, in one compact grid instead of four more full sections. */
export function AlsoDoes(): React.ReactElement {
  return (
    <section className={cx(section, wrap)}>
      <Reveal>
        <Kicker n="04" label="And more" />
        <h2 className={cx(display, 'mt-[22px] max-w-[18ch] text-[clamp(31px,3.9vw,52px)]')}>
          <span className={thin}>Everything else</span> the booth needs.
        </h2>
        <div className="mt-[clamp(34px,4vw,52px)] grid gap-4 min-[860px]:grid-cols-2">
          {ALSO.map((item) => (
            <div key={item.title} className={card}>
              <h3 className="m-0 font-display text-[17px] font-bold tracking-[-0.025em]">
                {item.title}
              </h3>
              <p className="m-0 mt-2 text-[14.5px] leading-[1.6] text-mute">{item.body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  )
}
