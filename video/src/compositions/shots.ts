/** Shot list: timings, storyboard stills and VO. Pure data, read by the compositions and the storyboard script. */

export type ShotMeta = { id: string; beat: string; duration: number; still: number; vo: string }

export const HERO_SHOTS: ShotMeta[] = [
  { id: '01-cold-open', beat: '1 · Cold open', duration: 8, still: 6.5, vo: '(room tone, no VO)' },
  { id: '02-problem', beat: '2 · The problem', duration: 10, still: 4.4, vo: "The pastor goes off script. Nobody planned that verse. In the booth, someone is guessing at a reference. By the time it's up, the moment has passed." },
  { id: '03-title', beat: '3 · Title', duration: 6, still: 2.6, vo: '(silence under the lines; music lifts)' },
  { id: '04a-feed', beat: '4 · Listens', duration: 5, still: 3, vo: 'Kairo takes a clean feed from the sound desk and listens.' },
  { id: '04b-transcript', beat: '4 · Listens', duration: 5, still: 5, vo: 'It follows the sermon word by word. When the pastor quotes Scripture, Kairo finds the passage.' },
  { id: '04c-meaning', beat: '4 · Matches', duration: 5, still: 4.2, vo: "Even when it's paraphrased, and nobody says where it's from." },
  { id: '04d-staged', beat: '4 · Staged', duration: 6, still: 3.5, vo: "It's staged in your queue, in your translation, ready." },
  { id: '05a-send', beat: '5 · You send it', duration: 7, still: 5.2, vo: 'You read it. You press send. (beat)' },
  { id: '05b-room', beat: '5 · The room', duration: 3, still: 2.5, vo: 'And the whole room reads along.' },
  { id: '06a-notes', beat: '6 · Rest of Sunday', duration: 4, still: 2.5, vo: 'Kairo runs the rest of Sunday, too. Import your sermon notes. Every reference becomes a verse.' },
  { id: '06b-songs', beat: '6 · Rest of Sunday', duration: 4, still: 2.5, vo: 'Songs keep their sections.' },
  { id: '06c-themes', beat: '6 · Rest of Sunday', duration: 4, still: 2.5, vo: 'Themes look exactly as they will on screen.' },
  { id: '06d-outputs', beat: '6 · Rest of Sunday', duration: 4, still: 3, vo: 'Drive your screens, or send NDI to the stream.' },
  { id: '06e-follow', beat: '6 · Rest of Sunday', duration: 4, still: 2.5, vo: "Arm a passage, and the next verse moves up as it's read." },
  { id: '07-trust', beat: '7 · Trust', duration: 9, still: 5, vo: 'Kairo suggests. You decide. Nothing reaches the screen until your team sends it.' },
  { id: '08-end', beat: '8 · End card', duration: 8, still: 4, vo: 'Kairo. Free during early access, on Mac and Windows. Because every moment matters.' },
]

export const SOCIAL_SHOTS: ShotMeta[] = [
  { id: 's1-pastor', beat: 'Social · Problem', duration: 6.4, still: 3, vo: 'The pastor quotes a verse. Nobody planned it.' },
  { id: 's2-heard', beat: 'Social · Found', duration: 7.6, still: 4.5, vo: 'Kairo heard it. Found the passage. Even paraphrased.' },
  { id: 's3-sent', beat: 'Social · Send', duration: 4.5, still: 3, vo: 'You press send.' },
  { id: 's4-end', beat: 'Social · End', duration: 5.5, still: 3.5, vo: 'Because every moment matters.' },
]

/** Start times in seconds, from the durations. */
export const withStarts = (shots: ShotMeta[]): (ShotMeta & { start: number })[] => {
  let start = 0
  return shots.map((shot) => {
    const placed = { ...shot, start }
    start += shot.duration
    return placed
  })
}
