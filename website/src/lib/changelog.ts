/**
 * What's new in each Kairo release, newest first, written for the people who
 * run Sunday — not the commit log. Add an entry here with every release that
 * changes something a church would notice; purely internal releases can skip it.
 */

/**
 * A headline feature for the in-app "What's New" sheet: a coloured mark, a
 * short title, one or two sentences. `icon` names a mark in the app's
 * What's New sheet (see WHATS_NEW_ICONS there); unknown names fall back.
 */
export type ChangelogHighlight = {
  icon: 'operator' | 'scripture' | 'lyrics' | 'documents' | 'theme' | 'media' | 'screens' | 'cloud' | 'speed' | 'tip'
  title: string
  body: string
}

export type ChangelogEntry = {
  version: string
  /** Release date, YYYY-MM-DD. */
  date: string
  title: string
  notes: string[]
  /**
   * Optional: what the app's "What's New" sheet leads with after this update.
   * Without it the sheet shows `notes` as a list.
   */
  highlights?: ChangelogHighlight[]
}

export const changelog: ChangelogEntry[] = [
  {
    version: '1.0.31',
    date: '2026-11-08',
    title: 'Smoother scripture and transcription',
    notes: [
      'Following a passage aloud is less likely to trigger duplicate scripture suggestions while it is on screen.',
      'Transcription handles interruptions more reliably, with clearer messages when a service cannot start.',
      'Larger slide images can now be imported, and video card output is more reliable.',
    ],
  },
  {
    version: '1.0.30',
    date: '2026-11-07',
    title: 'Slides that look like the original',
    notes: [
      'Documents is now called Slides, and every slide in a deck shows in one grid you can zoom, so you can see what is coming next at a glance.',
      'PowerPoint slides keep every picture, font and effect. If this computer has no PowerPoint or Keynote, Kairo offers a free one-time download that stays inside Kairo and works offline.',
      'A screen you already set up can now be moved onto a video card output such as a DeckLink, without making a new one.',
      'Media cards now show the scaling you picked for each image or video, such as scale to fit.',
    ],
    highlights: [
      { icon: 'documents', title: 'Slides, all in view', body: 'Every slide in a deck shows in one zoomable grid. Click any slide to put it on screen.' },
      { icon: 'documents', title: 'PowerPoint, exactly as designed', body: 'Pictures, fonts and effects come through. Kairo offers a free one-time download when this computer has no PowerPoint or Keynote.' },
      { icon: 'screens', title: 'Move a screen to a video card', body: 'Pick a DeckLink output straight from an existing screen\'s Output menu.' },
    ],
  },
  {
    version: '1.0.29',
    date: '2026-11-07',
    title: 'Trim media and share feedback',
    notes: [
      'Trim a video or audio file to just the part you need with the new timeline in the media inspector, and media overlays and playback behave more reliably.',
      'Send feedback to the Kairo team straight from the workspace sidebar, so you can report a problem or suggest an idea without leaving the app.',
      'After each update, a What\'s New sheet shows you what changed, once, the first time you open Kairo.',
      'Kairo for Mac is now signed and approved by Apple, so it installs and opens without any extra security steps, and the start-up screen now plays a short animation while Kairo loads.',
    ],
    highlights: [
      { icon: 'media', title: 'Trim your media', body: 'Use the new timeline in the media inspector to play just the part of a video or audio file you need.' },
      { icon: 'tip', title: 'Send us feedback', body: 'Use the feedback button in the workspace sidebar to report a problem or share an idea without leaving Kairo.' },
      { icon: 'speed', title: 'Easier Mac install', body: 'Kairo for Mac is now signed and approved by Apple, so it opens without any extra security steps.' },
    ],
  },
  {
    version: '1.0.28',
    date: '2026-11-03',
    title: 'A roomier live preview',
    notes: [
      'The buttons that clear what is on screen now sit in a row under the live preview, so the slide gets the full width of the panel.',
      'When a scripture passage is queued, pick which verse goes up from the row itself, one verse per slide.',
      'Menus and pop-ups, including the audio input picker, are softer and easier to read and tap.',
      'The start-up screen has a fresh look while Kairo loads.',
    ],
    highlights: [
      { icon: 'operator', title: 'A roomier live preview', body: 'The buttons that clear what is on screen now sit in a row under the live preview, so the slide gets the full width of the panel.' },
      { icon: 'scripture', title: 'Pick the verse that goes up', body: 'When a passage is queued, choose which verse goes up right from the row, one verse per slide.' },
      { icon: 'tip', title: 'Softer menus', body: 'Menus and pop-ups, including the audio input picker, are easier to read and tap.' },
    ],
  },
  {
    version: '1.0.27',
    date: '2026-11-03',
    title: 'A simpler workspace',
    notes: [
      'The top bar gives your workspace controls more room, while the sidebar continues to show which section is open.',
      'Refreshed icons throughout Kairo keep familiar navigation and video controls.',
      'Improved sign-in handling prevents an older account check from clearing a newer sign-in.',
    ],
  },
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
