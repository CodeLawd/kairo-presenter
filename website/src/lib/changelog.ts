/**
 * What's new in each Kairo release, newest first, written for the people who
 * run Sunday — not the commit log. Add an entry here with every release that
 * changes something a church would notice; purely internal releases can skip it.
 */

export type ChangelogEntry = {
  version: string
  /** Release date, YYYY-MM-DD. */
  date: string
  title: string
  notes: string[]
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.0.16',
    date: '2026-10-24',
    title: 'A new home at kairopresenter.com',
    notes: [
      'Kairo now signs in and syncs through kairopresenter.com.',
      'Update to keep your account and cloud features working.',
    ],
  },
  {
    version: '1.0.14',
    date: '2026-10-24',
    title: 'Websites on screen, and crash reports',
    notes: [
      'The new Web page opens a website and puts it on your screens behind the words. Links and scrolling follow on every screen.',
      'If Kairo crashes, a short report is sent while you’re signed in so it can be fixed. Turn it off in Privacy settings.',
      'Windows updates install correctly again.',
      'Smaller touches: your logo in the header in full screen, import cards for documents and sermon notes, and a clearer Import Song dialog.',
    ],
  },
  {
    version: '1.0.12',
    date: '2026-10-24',
    title: 'Capture',
    notes: [
      'On Mac, record any output — a screen, an NDI feed or a video card — to a movie file, with an optional audio input.',
      'H.264, HEVC or ProRes, in 1080p or 720p at up to 60 fps.',
      'The ProPresenter integration is retired: Kairo runs your screens itself.',
    ],
  },
  {
    version: '1.0.11',
    date: '2026-10-17',
    title: 'Steadier video cards',
    notes: [
      'Works with Blackmagic Desktop Video 15.3.1.',
      'The Hardware tab shows which Desktop Video version is installed, with clearer messages when a driver isn’t supported.',
      'Right-click a screen or feed to delete it.',
    ],
  },
  {
    version: '1.0.8',
    date: '2026-10-11',
    title: 'Better ears for Scripture',
    notes: [
      'Catches references said with a pause, like “Zephaniah, three sixteen”.',
      'When “sixteen” is heard as “sixty”, Kairo picks the verse that exists.',
    ],
  },
  {
    version: '1.0.7',
    date: '2026-10-11',
    title: 'Blackmagic video cards',
    notes: [
      'Send any screen to a Blackmagic DeckLink card, in every Mac build.',
      'Lighter, smoother output to video cards and NDI.',
      'A refreshed Screens page.',
    ],
  },
  {
    version: '1.0.5',
    date: '2026-10-10',
    title: 'Overlays that fit',
    notes: [
      'Overlays keep their shape on screens of any size.',
      'Lyric slides are easier to manage.',
    ],
  },
  {
    version: '1.0.4',
    date: '2026-10-09',
    title: 'Mac updates install themselves',
    notes: [
      'Kairo on Mac downloads and installs updates on its own.',
      'A refreshed colour palette across the app.',
    ],
  },
]
