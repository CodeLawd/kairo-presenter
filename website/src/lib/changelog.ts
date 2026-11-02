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
    version: '1.0.26',
    date: '2026-11-02',
    title: 'More control over your live presentation',
    notes: [
      'Show live video full screen, picture-in-picture, or side by side. Position and size the inset, choose its corner style, or adjust the split between video and slides.',
      'Design each countdown with your own text, shapes, images, colours and timer readout. The live preview lets you choose any configured screen, see when it is off, and clear individual layers.',
      'Rename audio tracks, find their files, or move them to the Trash from Kairo. Show your pointer on screens while presenting a web page that follows the preview.',
      'Engage can renew expired access and reconnect. The workspace navigation, presentation controls, scripture tools and download experience have also been refined.',
    ],
  },
  {
    version: '1.0.25',
    date: '2026-11-01',
    title: 'Clearer account recovery',
    notes: [
      'If a saved sign-in expires or is rejected, Kairo now asks you to sign in again instead of incorrectly saying you are offline.',
      'Kairo gives its cloud connection more time to start after an update and avoids overlapping sign-in checks.',
    ],
  },
  {
    version: '1.0.24',
    date: '2026-11-01',
    title: 'Engage loads reliably when the connection changes',
    notes: [
      'Engage uses a backup connection when the usual Kairo address cannot be reached, and shows an offline message instead of loading forever.',
      'Kairo opens without a Bible translation warning when its cloud connection is unavailable; installed translations remain ready.',
    ],
  },
  {
    version: '1.0.23',
    date: '2026-11-01',
    title: 'Questions and polls for your congregation',
    notes: [
      'Create an Engage event ahead of a service and share a join code so people can ask questions and vote in polls.',
      'Review, answer, and show audience questions or poll results on your presentation screens.',
      'Invite moderators to help manage questions, and return to an event later with the same join code.',
      'Screen and settings controls are clearer, with improved confirmation when closing Kairo.',
    ],
  },
  {
    version: '1.0.22',
    date: '2026-11-01',
    title: 'Softer sidebars and clearer passages',
    notes: [
      'Reading a passage in one translation keeps the verses that follow in that translation, and the verse already on screen is no longer suggested again.',
      'Scripture, Lyrics, Documents and Web sidebars now sit on a soft, see-through panel that sets them apart from the page.',
      'Each passage in a scripture playlist opens with a header bar that stays in view while you scroll, and the verse cards are lighter and easier to scan.',
    ],
  },
  {
    version: '1.0.21',
    date: '2026-10-31',
    title: 'A calmer, clearer Kairo',
    notes: [
      'A new neutral grey look, closer to ProPresenter, with clearer Scripture and Lyrics sidebars, easier-to-read scripture cards and a separate panel for each passage in a playlist.',
      'Improved scripture detection finds distinctive quoted verses even when the preacher does not say the book, chapter or verse. It checks available Bible text on your computer first, handles small transcription mistakes, and offers matches for you to review before presenting.',
      'A simpler Theme Editor: add shapes, images and video from a floating bar over the slide, pick layers from a list, and style text from a tidier panel.',
      'Offline Bibles show their download progress, and the Amplified Classic can be installed.',
    ],
  },
  {
    version: '1.0.19',
    date: '2026-10-25',
    title: 'Activate Kairo with one key — no more API keys',
    notes: [
      'Live transcription, scripture lookup and lyric tools now come included. Your church no longer needs its own Deepgram or API.Bible accounts.',
      'Church owners and admins create activation keys on the Licence & devices page and paste one into Kairo to activate each computer. Licences are free for now.',
      'Pick a theme for each screen or feed straight from the toolbar, and set lyric text size even when Fit to box is on.',
      'Scripture detection remembers the book and chapter the preacher is in, so “verse 30 of chapter 19” lands on the right passage.',
    ],
  },
  {
    version: '1.0.18',
    date: '2026-10-24',
    title: 'A smoother way back to your church workspace',
    notes: [
      'Return to your dashboard from the website without signing in again while your session is active.',
      'Export your account data or delete your account from the dashboard’s Account page.',
      'A refreshed desktop palette brings Kairo’s app and website closer together.',
      'Smoother website animations and an updated preview when you share Kairo.',
    ],
  },
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
