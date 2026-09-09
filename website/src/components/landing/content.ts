import type { IconName } from './icons'

/** The scrolling strip under the hero. */
export const STRIP = [
  'Live transcription',
  'Paraphrase matching',
  'Auto-follow a reading',
  'Sermon note import',
  'Verse playlists',
  'Offline Bibles',
  'ProPresenter control',
  'Transparent NDI output',
  'Theme editor',
  'Song library',
  'Lyric translation',
] as const

export const PRIVACY: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'lock',
    title: 'Keys never reach the browser layer',
    body: 'API keys live in the Electron main process. The part of the app that draws the interface never sees them.',
  },
  {
    icon: 'shield',
    title: 'Cached verses are encrypted',
    body: 'AES-256-GCM, with the key held in the OS keychain. If the operating system has no encryption to offer, the app caches nothing at all.',
  },
  {
    icon: 'plug',
    title: 'Licensed text cannot be exported',
    body: 'No bulk copy, no export, no print route. Nothing in the app can hand you a right the publisher did not give.',
  },
]

export const PLATFORMS: {
  icon: IconName
  name: string
  body: string
  meta: string
  cta: string
  href: string
}[] = [
  {
    icon: 'apple',
    name: 'macOS',
    body: 'Apple silicon and Intel. Needs an audio input and a network route to ProPresenter.',
    meta: 'Early access',
    cta: 'Request a build',
    href: '/signup',
  },
  {
    icon: 'windows',
    name: 'Windows',
    body: 'Windows 10 and 11, 64-bit. Same app, same workspace, same output paths.',
    meta: 'Early access',
    cta: 'Request a build',
    href: '/signup',
  },
  {
    icon: 'plug',
    name: 'Your booth',
    body: 'ProPresenter 7 over its network API, or NDI straight into the switcher. Both, if you want.',
    meta: 'Requirements',
    cta: 'Read the details',
    href: '#faq',
  },
]

export const FAQ: { q: string; a: string[] }[] = [
  {
    q: 'What does Kairo actually do?',
    a: [
      'It listens to your service through an audio input, works out which passage is being referenced, looks the text up in your translation, and puts it in a queue for you to send to the screen.',
      'You approve every one. The app does the finding and the formatting; the decision stays with the operator.',
    ],
  },
  {
    q: 'What if the pastor paraphrases instead of reading it out?',
    a: [
      'That is the case it is built for. Detection runs on the meaning of what was said, not on hearing a book, chapter and verse spoken aloud, so a close paraphrase still resolves to the passage.',
      'Every match carries a confidence score, so you can see at a glance how sure it is before you send anything.',
    ],
  },
  {
    q: 'Do we still need someone in the booth?',
    a: [
      'Yes, and that is deliberate. The default is manual: the app suggests, you send. It takes away the typing, not the operator.',
      'There is an auto mode with a confidence threshold and a debounce interval if your team decides they want it.',
    ],
  },
  {
    q: 'Which translations can we use?',
    a: [
      'KJV, WEB, ASV and the other public-domain translations ship inside the app and need no key and no internet.',
      'NKJV, NIV, NLT and the rest come from API.Bible, using a key your church requests and enables for the translations you are licensed to use.',
    ],
  },
  {
    q: 'Do I need ProPresenter?',
    a: [
      'For the ProPresenter path, yes — ProPresenter 7, with the host, port and password from its Network preferences.',
      'The NDI output is independent. If you run a different playback system, or you would rather the switcher composite the verse, that path works on its own.',
    ],
  },
]

export const ALSO: { title: string; body: string }[] = [
  {
    title: 'Prepare on Saturday',
    body: 'Import the sermon notes and every reference becomes a looked-up verse in a playlist you step through live.',
  },
  {
    title: 'Your translation',
    body: 'Public-domain versions ship inside the app; licensed ones come through your church\'s own API.Bible key.',
  },
  {
    title: 'Themes that match',
    body: 'Build the slide look on a live canvas — what you approve in the preview is exactly what leaves the machine.',
  },
  {
    title: 'Songs too',
    body: 'Import a song, keep its labelled sections, and push the set to ProPresenter from the same place.',
  },
]
