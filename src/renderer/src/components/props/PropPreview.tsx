import { useLayoutEffect, useRef, useState } from 'react'
import { usePropTimerTick } from '@/hooks/usePropTimerTick'
import { renderPropHTML, type ProgramProp, type PropTimerView } from '@shared/program'
import { cn } from '@/lib/utils'

/** Overlays are laid out on a 1920-wide frame. */
const FRAME_W = 1920
const FRAME_H = 1080

/**
 * A prop drawn at 16:9 with the markup the screens use. A clear prop sits on a
 * checkerboard, as in ProPresenter, so you can see it's see-through.
 *
 * The drawing scales to the width the card actually has. A fixed scale inside
 * a wider cell shifted every object left and clipped the right-hand side, so a
 * prop placed at the top centre did not look like one.
 */
export function PropPreview({
  prop,
  width,
  timer,
  className,
}: {
  prop: ProgramProp
  /** Fixed width in px; omit to fill the parent. */
  width?: number
  timer?: PropTimerView
  className?: string
}): React.ReactElement {
  const ref = useRef<HTMLSpanElement>(null)
  const contentRef = useRef<HTMLSpanElement>(null)
  const [measured, setMeasured] = useState(0)
  usePropTimerTick(contentRef, prop.objects.some((object) => object.kind === 'timer'))

  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const measure = (): void => setMeasured(node.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const scale = (measured || width || FRAME_W) / FRAME_W
  return (
    <span
      ref={ref}
      className={cn('relative block shrink-0 overflow-hidden', className)}
      style={{
        width: width ?? '100%',
        aspectRatio: '16 / 9',
        background: 'repeating-conic-gradient(rgb(var(--surface-stage)) 0% 25%, rgb(var(--surface-secondary)) 0% 50%) 0 0 / 12px 12px',
      }}
      aria-hidden="true"
    >
      <span
        ref={contentRef}
        className="pointer-events-none absolute left-0 top-0 block origin-top-left"
        style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})` }}
        dangerouslySetInnerHTML={{ __html: renderPropHTML(prop, timer) }}
      />
    </span>
  )
}
