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

export const AUDIENCE: { icon: IconName; who: string; body: string }[] = [
  {
    icon: 'monitor',
    who: 'Projection operators',
    body: 'Stop typing during the sermon. The verse is already loaded and waiting for you to send it.',
  },
  {
    icon: 'mic',
    who: 'Pastors and preachers',
    body: 'Quote a passage without checking whether the booth caught it. Preach at your own pace.',
  },
  {
    icon: 'camera',
    who: 'Media and stream teams',
    body: 'One less thing to go wrong on camera. Slides land on time, service after service.',
  },
]

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
    q: 'Can we prepare verses before the service?',
    a: [
      'Yes. Import your sermon notes and Kairo pulls out every reference in the document, looks each one up, and saves the result as a named playlist.',
      'On Sunday you step through it with Previous and Next. Detection still runs alongside it, so anything that was not in the notes still gets caught.',
    ],
  },
  {
    q: 'Which translations can we use?',
    a: [
      'KJV, WEB, ASV and the other public-domain translations ship inside the app and need no key and no internet.',
      'NKJV, NIV, NLT and the rest come from API.Bible, using a key your church requests and enables for the translations you are licensed to use. The app only lists the ones your key can actually reach.',
    ],
  },
  {
    q: 'Does it work without internet?',
    a: [
      'The bundled translations always do. Licensed ones work offline once they are cached, and you can download a whole translation ahead of a service, one chapter at a time, with pause and resume.',
      'API.Bible requires cached text to be refreshed every 30 days. Past that point the app asks you to refresh rather than showing text that has gone stale.',
    ],
  },
  {
    q: 'Do I need ProPresenter?',
    a: [
      'For the ProPresenter path, yes — ProPresenter 7, with the host, port and password from its Network preferences.',
      'The NDI output is independent. If you run a different playback system, or you would rather the switcher composite the verse, that path works on its own.',
    ],
  },
  {
    q: 'What does it run on?',
    a: [
      'macOS and Windows. It needs an audio input it can listen to and a network route to the ProPresenter machine. A feed off the sound desk works far better than a laptop microphone.',
    ],
  },
  {
    q: 'Where do our API keys go?',
    a: [
      'They stay on the machine, held by the main process and never handed to the interface layer. Cached scripture is encrypted with AES-256-GCM using a key from the OS keychain.',
    ],
  },
]
