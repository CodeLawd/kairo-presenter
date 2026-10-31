import { useCurrentFrame, useVideoConfig } from 'remotion'
import { ui } from './fonts'
import { seg } from './motion'

export type Cue = { text: string; startMs: number; endMs: number }

/** Scratch VO as plain subtitles: no box, no badge. Replaced by the recorded voice. */
export function Subtitles({ cues, bottom = 64, size = 30 }: { cues: Cue[]; bottom?: number; size?: number }): React.ReactElement | null {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const ms = (frame / fps) * 1000
  const cue = cues.find((c) => ms >= c.startMs && ms < c.endMs)
  if (!cue) return null
  const a = seg(ms, cue.startMs, cue.startMs + 120) * (1 - seg(ms, cue.endMs - 120, cue.endMs))
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <span style={{ fontFamily: ui, fontSize: size, fontWeight: 500, color: `rgb(249 250 251 / ${0.92 * a})`, textShadow: '0 2px 18px rgb(0 0 0 / 0.85), 0 0 2px rgb(0 0 0 / 0.6)' }}>{cue.text}</span>
    </div>
  )
}
