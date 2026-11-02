import { useRef } from 'react'
import { useNow } from '@/hooks/useProgramState'
import { usePropTimerTick } from '@/hooks/usePropTimerTick'
import { OVERLAY_FRAME_HEIGHT, OVERLAY_FRAME_WIDTH } from '@/components/overlay/ScaledOverlayPreview'
import { formatClock, type ConfidenceInfo } from '@shared/program'

// The program layers over the live preview, drawn from the same data the
// screen windows get (programLayersFor / confidenceFor in src/lib/program.ts),
// at the screen's 1920×1080 metrics scaled to the preview.

type Layers = { props: string; timer: string; message: string; question: string; poll: string; logo: string }

/** Props, the timer design, message, clock/stage message, then the logo — the screen's stacking order. */
export function ProgramLayersPreview({
  layers,
  info,
  width,
}: {
  layers: Layers
  info: ConfidenceInfo | null
  width: number
}): React.ReactElement {
  const designRef = useRef<HTMLDivElement>(null)
  const slot = (html: string): React.ReactElement | null =>
    html ? <div className="absolute inset-0 overflow-hidden [&>*]:absolute [&>*]:inset-0" dangerouslySetInnerHTML={{ __html: html }} /> : null
  // A timer's readout ticks in place, like it does on the screens.
  usePropTimerTick(designRef, layers.props.includes('data-kairo-timer') || layers.timer.includes('data-kairo-timer'))
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute left-0 top-0 origin-top-left font-sans"
        style={{ width: OVERLAY_FRAME_WIDTH, height: OVERLAY_FRAME_HEIGHT, transform: `scale(${width / OVERLAY_FRAME_WIDTH})` }}
      >
        <div ref={designRef} className="absolute inset-0">
          {slot(layers.props)}
          {slot(layers.timer)}
        </div>
        {slot(layers.message)}
        {slot(layers.poll)}
        {slot(layers.question)}
        {info && <InfoLayer info={info} />}
        {slot(layers.logo)}
      </div>
    </div>
  )
}

/** Mirrors the info layer in src/main/services/output/overlay.html. */
function InfoLayer({ info }: { info: ConfidenceInfo }): React.ReactElement {
  const { clock, stageMessage, layout, sizes, style } = info
  // The clock changes by the minute; a second is plenty.
  const now = useNow(1000)
  const edge = layout.position

  return (
    <>
      {clock && (
        <div
          className="absolute inset-x-0 flex items-center font-bold tabular-nums text-white"
          style={{
            [edge]: 0,
            padding: '20px 48px',
            fontSize: sizes.barPx,
            background: style.backdrop ? 'rgba(0,0,0,0.72)' : undefined,
            textShadow: style.backdrop ? undefined : '0 2px 8px rgba(0,0,0,0.8)',
          }}
        >
          <span>{formatClock(new Date(now))}</span>
        </div>
      )}
      {stageMessage && (
        <div
          className="absolute rounded-[14px] bg-red-700 text-center font-bold text-white"
          style={{
            left: 40,
            right: 40,
            [edge]: clock ? sizes.barPx * 1.25 + 40 : 40,
            padding: '18px 28px',
            fontSize: sizes.messagePx,
            lineHeight: 1.15,
            overflowWrap: 'break-word',
          }}
        >
          {stageMessage}
        </div>
      )}
    </>
  )
}
