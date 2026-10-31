import { Audio, Sequence, staticFile, useVideoConfig } from 'remotion'

/**
 * Voice, music and effects for one film. Times are in seconds. Music ducks
 * under the voice and can dip for a held beat; effects land on picture cues.
 */

export type VoLine = { file: string; startMs: number; durMs: number }
export type MusicPass = {
  at: number
  /** Where in the track to start, seconds. */
  from: number
  until: number
  fadeIn?: number
  fadeOut?: number
  base: number
  /** Level under the voice. */
  ducked: number
  /** Held beats: [start, end, level]. */
  dips?: [number, number, number][]
}
export type Sfx = { at: number; name: 'key' | 'tick' | 'click' | 'pop' | 'whoosh' | 'shimmer' | 'swell' | 'rise' | 'impact'; gain: number }

const ramp = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))

export function Soundtrack({ vo, music, sfx, voGain = 1 }: { vo: VoLine[]; music: MusicPass[]; sfx: Sfx[]; voGain?: number }): React.ReactElement {
  const { fps } = useVideoConfig()
  const f = (s: number): number => Math.round(s * fps)
  const speaking = (s: number): number =>
    vo.reduce((m, l) => {
      const a = l.startMs / 1000
      const b = a + l.durMs / 1000
      // Duck a little before the line and release a little after.
      return Math.max(m, ramp((s - (a - 0.25)) / 0.25) * ramp((b + 0.4 - s) / 0.4))
    }, 0)
  return (
    <>
      {music.map((m, k) => (
        <Sequence key={`m${k}`} from={f(m.at)} durationInFrames={f(m.until - m.at)} name={`music ${k}`}>
          <Audio
            src={staticFile('audio/music/mixkit-32.mp3')}
            trimBefore={f(m.from)}
            volume={(frame) => {
              const s = m.at + frame / fps
              const fadeIn = m.fadeIn ? ramp((s - m.at) / m.fadeIn) : 1
              const fadeOut = m.fadeOut ? ramp((m.until - s) / m.fadeOut) : 1
              const duck = m.base + (m.ducked - m.base) * speaking(s)
              // Ease down into a held beat; the hit at its end brings the music straight back.
              const dip = (m.dips ?? []).reduce((v, [a, b, level]) => (s >= a && s <= b ? Math.min(v, duck + (level - duck) * ramp((s - a) / 0.3)) : v), duck)
              return Math.max(0, dip * fadeIn * fadeOut)
            }}
          />
        </Sequence>
      ))}
      {vo.map((l, k) => (
        <Sequence key={`v${k}`} from={f(l.startMs / 1000)} durationInFrames={f(l.durMs / 1000) + 2} name={`vo ${k}`}>
          <Audio src={staticFile(l.file)} volume={voGain} />
        </Sequence>
      ))}
      {sfx.map((e, k) => (
        <Sequence key={`s${k}`} from={f(e.at)} durationInFrames={f(3.4)} name={`${e.name} ${k}`}>
          <Audio src={staticFile(`audio/sfx/${e.name}.wav`)} volume={e.gain} />
        </Sequence>
      ))}
    </>
  )
}
