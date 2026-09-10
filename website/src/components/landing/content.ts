import type { IconName } from './icons'

/**
 * Every string on the landing page lives here, so copy edits never touch a
 * layout file.
 *
 * House rules for anything added below:
 *   - No block over 40 words. No sentence over 20.
 *   - Feature bullets are one verb-led sentence, 14 words or fewer.
 *   - US spelling.
 */

/** The three facts under the hero. Replaced the scrolling marquee. */
export const FACTS = [
  'Runs on your machine',
  'No audio leaves the building',
  'You approve every slide',
] as const

/**
 * The flow, as a spec list rather than a numbered three-up.
 *
 * This was `01 / 02 / 03` over three equal columns with a mono eyebrow on top,
 * which is the most template-looking arrangement on the web and told the same
 * three ideas the feature blocks below already carry. Verbs in a left column
 * read as one continuous statement and take a third of the height.
 */
export const STEPS: { verb: string; body: string }[] = [
  {
    verb: 'Listens',
    body: 'to a clean feed off the sound desk, and transcribes the sermon as it happens.',
  },
  {
    verb: 'Matches',
    body: 'what it hears to the passage, even when nobody says where it is from.',
  },
  {
    verb: 'Stages',
    body: 'the verse in your queue, in your translation, ready for you to send.',
  },
]

/**
 * The three feature blocks. These carry the detail; the steps above carry the
 * shape. Deliberately no overlap in wording between the two.
 */
export const FEATURES: {
  /** Short name for the index rail — the full title wraps badly at that width. */
  label: string
  title: string
  lede: string
  bullets: string[]
}[] = [
  {
    label: 'Listening',
    title: 'Hear every word',
    lede: 'Point Kairo at any audio input. The transcript scrolls live next to the operator view.',
    bullets: [
      'Take a clean feed off the sound desk instead of a laptop mic.',
      'Run Deepgram in the cloud, or Whisper on the machine.',
      'Watch a live meter so you always know it is still hearing.',
    ],
  },
  {
    label: 'Detection',
    title: 'Catch verses nobody announced',
    lede: 'A spoken reference is the easy case. Kairo also catches the words when nobody says where they are from.',
    bullets: [
      'Matches on meaning, so a paraphrase still finds the passage.',
      'Shows a confidence score on every match.',
      'Renders previews in your theme, so what you see is what goes out.',
      'Brings a range through as slides in order, not one wall of text.',
    ],
  },
  {
    label: 'The booth',
    title: 'Nothing goes out without you',
    lede: 'Live output on top, your staging queue below. Add a detection or search one yourself, then send.',
    bullets: [
      'Stage the next verse while the current one is still live.',
      'Search by reference, or by a phrase you half-remember.',
      'Shows ProPresenter, transcription and detection status at a glance.',
      'Sends over the ProPresenter API, or out as a transparent NDI source.',
    ],
  },
]

/** Everything else, one line each. */
export const MORE: { title: string; body: string }[] = [
  {
    title: 'Sermon notes',
    body: 'Import your notes on Saturday. Every reference becomes a verse in a playlist.',
  },
  {
    title: 'Your translation',
    body: 'KJV, WEB and ASV are built in. NIV, NLT and more come through your API.Bible key.',
  },
  {
    title: 'Themes',
    body: 'Design the slide once. The preview is exactly what leaves the machine.',
  },
  {
    title: 'Songs',
    body: 'Import a song, keep its sections, send the set to ProPresenter.',
  },
  {
    title: 'Works offline',
    body: 'Built-in Bibles and local transcription need no internet at all.',
  },
  {
    title: 'Auto-follow',
    body: 'Arm a passage and the next verse moves up as the reading goes on.',
  },
]

export const PRIVACY: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'mic',
    title: 'Audio stays local',
    body: 'Run Whisper on the machine and no audio ever leaves the building.',
  },
  {
    icon: 'lock',
    title: 'Keys stay local',
    body: 'Your API keys are encrypted and stored in your operating system keychain.',
  },
  {
    icon: 'shield',
    title: 'Licensed text is protected',
    body: 'No bulk copy, no export, no print. Publisher terms are respected.',
  },
]

export const FAQ: { q: string; a: string }[] = [
  {
    q: 'What does Kairo actually do?',
    a: 'It listens to your service, works out which passage is being referenced, looks it up in your translation, and puts it in your queue. You approve every one before it reaches the screen.',
  },
  {
    q: 'What if the pastor paraphrases instead of reading it out?',
    a: 'That is the case it is built for. Detection runs on meaning, not on hearing a book and chapter spoken aloud, so a close paraphrase still resolves. Every match carries a confidence score.',
  },
  {
    q: 'Do we still need someone in the booth?',
    a: 'Yes, by design. The app suggests, you send. It takes away the typing, not the operator. There is an auto mode with a confidence threshold if your team decides they want it.',
  },
  {
    q: 'Which translations can we use?',
    a: 'KJV, WEB, ASV and the other public-domain translations ship inside the app and need no key. NIV, NLT and the rest come through an API.Bible key your church requests.',
  },
  {
    q: 'Do I need ProPresenter?',
    a: 'For the ProPresenter path, yes — version 7, with the details from its Network preferences. The NDI output works on its own if you run a different playback system.',
  },
  {
    q: 'What will it cost?',
    a: 'Kairo is free while it is in early access. Pricing comes at launch, and anyone testing it with us will hear about it before it changes.',
  },
]
