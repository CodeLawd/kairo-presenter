import { useNow } from '@/hooks/useProgramState'
import { cn } from '@/lib/utils'
import { OVERLAY_FRAME_HEIGHT, OVERLAY_FRAME_WIDTH } from '@/components/overlay/ScaledOverlayPreview'
import { formatClock, formatTimer, timerReadout, timerRunning, type ConfidenceInfo } from '@shared/program'

// The program layers over the live preview, drawn from the same data the
// screen windows get (programLayersFor / confidenceFor in src/lib/program.ts),
// at the screen's 1920×1080 metrics scaled to the preview.

type Layers = { props: string; message: string; logo: string }

/** Props, message, countdown/clock/stage message, then the logo on top — the screen's stacking order. */
export function ProgramLayersPreview({
  layers,
  info,
  width,
}: {
  layers: Layers
  info: ConfidenceInfo | null
  width: number
}): React.ReactElement {
  const slot = (html: string): React.ReactElement | null =>
    html ? <div className="absolute inset-0 overflow-hidden [&>*]:absolute [&>*]:inset-0" dangerouslySetInnerHTML={{ __html: html }} /> : null
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute left-0 top-0 origin-top-left font-sans"
        style={{ width: OVERLAY_FRAME_WIDTH, height: OVERLAY_FRAME_HEIGHT, transform: `scale(${width / OVERLAY_FRAME_WIDTH})` }}
      >
        {slot(layers.props)}
        {slot(layers.message)}
        {info && <InfoLayer info={info} />}
        {slot(layers.logo)}
      </div>
    </div>
  )
}

/** Mirrors the info layer in src/main/services/output/overlay.html. */
function InfoLayer({ info }: { info: ConfidenceInfo }): React.ReactElement {
  const { timer, clock, stageMessage, layout, sizes, style } = info
  // Sub-second only while a countdown runs; the clock alone changes by the minute.
  const now = useNow(timer && timerRunning(timer) ? 250 : 1000)
  const readout = timer ? timerReadout(timer, now, style.rollover) : null
  const hasBar = !!timer || clock
  const edge = layout.position

  return (
    <>
      {hasBar && (
        <div
          className="absolute inset-x-0 flex items-center justify-between font-bold tabular-nums text-white"
          style={{
            [edge]: 0,
            padding: '20px 48px',
            fontSize: sizes.barPx,
            background: style.backdrop ? 'rgba(0,0,0,0.72)' : undefined,
            textShadow: style.backdrop ? undefined : '0 2px 8px rgba(0,0,0,0.8)',
          }}
        >
          <span>{clock ? formatClock(new Date(now)) : ''}</span>
          {readout && (
            <span className={cn(readout.paused && 'opacity-60')} style={{ color: readout.timeUp ? style.overrunColor : style.color }}>
              {formatTimer(readout.seconds)}
            </span>
          )}
        </div>
      )}
      {stageMessage && (
        <div
          className="absolute rounded-[14px] bg-red-700 text-center font-bold text-white"
          style={{
            left: 40,
            right: 40,
            [edge]: hasBar ? sizes.barPx * 1.25 + 40 : 40,
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
