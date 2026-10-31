import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion'
import { Stage } from '../../components/Stage'
import captions from '../../data/walkthrough-captions.json'
import { Chapter, type Beat } from '../Chapter'
import { EndCard } from '../hero/Closing'
import { OneTake } from '../hero/OneTake'
import { Follow, Notes, Outputs, Songs, Theme } from '../hero/Sunday'
import { OP_COLORS as C } from '../Operator'
import { Subtitles } from '../Subtitles'
import { Soundtrack } from '../Soundtrack'
import { WALK_SOUND } from '../sound-cues'
import vo from '../../data/walkthrough-vo.json'
import {
  Capture,
  DocsWeb,
  ImportSong,
  LiveAndQueue,
  Meaning,
  Media,
  NotesDoc,
  Playlist,
  Range,
  Screens,
  Search,
  SendCard,
  Setlist,
  StageNext,
  Translations,
  WideOperator,
} from '../views'

/**
 * "One Sunday with Kairo", 3:30. Beats start on the VO line slots that
 * scripts/captions.mjs gives each chapter (line starts listed per chapter).
 */

const SCRIPTURE = 'rgb(110 172 255)'
const LYRICS = 'rgb(167 139 245)'
const PANEL = { w: 860, h: 500 }

const OneTakeBeat: React.FC<{ t: number }> = () => <OneTake />
const EndBeat: React.FC<{ t: number }> = () => <EndCard />

const CHAPTERS: { n: number; name: string; dur: number; beats: Beat[] }[] = [
  {
    n: 1,
    name: 'Set up',
    dur: 35,
    beats: [
      { at: 1.6, full: WideOperator },
      { at: 7.9, title: 'Connect your screens.', hue: C.cyan, panel: { w: 860, h: 470 }, View: Screens },
      { at: 14.6, title: 'Add an NDI feed.', hue: C.cyan, panel: { w: 820, h: 520 }, View: Outputs },
      { at: 21.4, title: 'Pick your translation.', hue: SCRIPTURE, panel: { w: 760, h: 470 }, View: Translations },
    ],
  },
  {
    n: 2,
    name: 'Saturday',
    dur: 40,
    beats: [
      { at: 1.6, title: 'The day before.', hue: SCRIPTURE, panel: { w: 760, h: 440 }, View: NotesDoc },
      { at: 8.9, title: 'Import your sermon notes.', hue: SCRIPTURE, panel: { w: 820, h: 520 }, View: Notes },
      { at: 16.6, title: 'They become a playlist.', hue: SCRIPTURE, panel: { w: 860, h: 440 }, View: Playlist },
      { at: 24.4, title: 'Design the slide once.', hue: C.pink, panel: { w: 860, h: 470 }, View: Theme },
      { at: 32.1, title: 'The preview is the output.', hue: C.pink, panel: { w: 860, h: 470 }, View: Theme },
    ],
  },
  {
    n: 3,
    name: 'Songs',
    dur: 30,
    beats: [
      { at: 1.6, title: 'Import a song.', hue: LYRICS, panel: { w: 860, h: 440 }, View: ImportSong },
      { at: 10.7, title: 'It keeps its sections.', hue: LYRICS, panel: { w: 860, h: 500 }, View: Songs },
      { at: 20.3, title: 'Build the set.', hue: LYRICS, panel: { w: 700, h: 440 }, View: Setlist },
    ],
  },
  {
    n: 4,
    name: 'The sermon',
    dur: 55,
    beats: [
      { at: 0, full: OneTakeBeat },
      { at: 22.6, title: 'It works from meaning.', hue: SCRIPTURE, panel: { w: 800, h: 430 }, View: Meaning },
      { at: 28.0, title: 'A range, in order.', hue: SCRIPTURE, panel: { w: 860, h: 400 }, View: Range },
      { at: 33.4, full: LiveAndQueue },
      { at: 38.8, full: StageNext },
      { at: 44.1, title: 'It follows the reading.', hue: C.green, panel: { w: 820, h: 460 }, View: Follow },
      { at: 49.5, full: SendCard },
    ],
  },
  {
    n: 5,
    name: 'Everything else',
    dur: 35,
    beats: [
      { at: 1.6, title: 'Search by a phrase.', hue: SCRIPTURE, panel: { w: 760, h: 470 }, View: Search },
      { at: 9.6, title: 'Documents and web pages.', hue: C.cyan, panel: { w: 860, h: 470 }, View: DocsWeb },
      { at: 18.0, title: 'Backgrounds from your media.', hue: C.orange, panel: { w: 760, h: 380 }, View: Media },
      { at: 26.5, title: 'Record any output.', hue: C.live, panel: { w: 860, h: 420 }, View: Capture },
    ],
  },
  {
    n: 6,
    name: 'Benediction',
    dur: 15,
    beats: [{ at: 0, full: EndBeat }],
  },
]

export const WALKTHROUGH_V2_SECONDS = CHAPTERS.reduce((s, c) => s + c.dur, 0)

export function WalkthroughV2(): React.ReactElement {
  const { fps } = useVideoConfig()
  let from = 0
  return (
    <Stage>
      <AbsoluteFill style={{ background: '#0C111D' }} />
      {CHAPTERS.map((c) => {
        const start = from
        from += c.dur
        return (
          <Sequence key={c.n} name={`${c.n} ${c.name}`} from={Math.round(start * fps)} durationInFrames={Math.round(c.dur * fps)} premountFor={fps}>
            <Chapter n={c.n} name={c.name} dur={c.dur} beats={c.beats} />
          </Sequence>
        )
      })}
      <Subtitles cues={captions} />
      <Soundtrack vo={vo} {...WALK_SOUND} />
    </Stage>
  )
}
