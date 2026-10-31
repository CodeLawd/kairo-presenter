import { AbsoluteFill, Sequence, useVideoConfig } from 'remotion'
import { Stage } from '../../components/Stage'
import captions from '../../data/hero-captions.json'
import { Subtitles } from '../Subtitles'
import { Soundtrack } from '../Soundtrack'
import { HERO_SOUND } from '../sound-cues'
import vo from '../../data/hero-vo.json'
import { EndCard, Trust } from './Closing'
import { OneTake } from './OneTake'
import { Opening } from './Opening'
import { Sunday } from './Sunday'
import { Title } from './Title'

/** Scene windows, seconds. The VO segments in compositions/shots.ts line up with these. */
export const HERO_V2 = [
  { id: 'opening', from: 0, dur: 18, C: Opening },
  { id: 'title', from: 18, dur: 6, C: Title },
  { id: 'one-take', from: 24, dur: 31, C: OneTake },
  { id: 'sunday', from: 55, dur: 20, C: Sunday },
  { id: 'trust', from: 75, dur: 9, C: Trust },
  { id: 'end', from: 84, dur: 8, C: EndCard },
] as const

export const HERO_V2_SECONDS = 92

export function HeroV2({ subtitles = true }: { subtitles?: boolean }): React.ReactElement {
  const { fps } = useVideoConfig()
  return (
    <Stage>
      <AbsoluteFill style={{ background: '#0C111D' }} />
      {HERO_V2.map(({ id, from, dur, C }) => (
        <Sequence key={id} name={id} from={Math.round(from * fps)} durationInFrames={Math.round(dur * fps)} premountFor={fps}>
          <C />
        </Sequence>
      ))}
      {subtitles && <Subtitles cues={captions} />}
      <Soundtrack vo={vo} {...HERO_SOUND} />
    </Stage>
  )
}
