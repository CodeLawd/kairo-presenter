import { renderPropHTML, type ProgramProp } from '@shared/program'
import { cn } from '@/lib/utils'

/** Overlays are laid out on a 1920-wide frame. */
const FRAME_W = 1920
const FRAME_H = 1080

/**
 * A prop drawn small at 16:9, with the markup the screens use. A clear prop
 * sits on a checkerboard, as in ProPresenter, so you can see it's see-through.
 */
export function PropPreview({
  prop,
  width,
  className,
}: {
  prop: ProgramProp
  width: number
  className?: string
}): React.ReactElement {
  const scale = width / FRAME_W
  return (
    <span
      className={cn('relative block shrink-0 overflow-hidden', className)}
      style={{
        width,
        height: FRAME_H * scale,
        background: 'repeating-conic-gradient(rgb(var(--surface-stage)) 0% 25%, rgb(var(--surface-secondary)) 0% 50%) 0 0 / 12px 12px',
      }}
      aria-hidden="true"
    >
      <span
        className="pointer-events-none absolute left-0 top-0 block origin-top-left"
        style={{ width: FRAME_W, height: FRAME_H, transform: `scale(${scale})` }}
        dangerouslySetInnerHTML={{ __html: renderPropHTML(prop) }}
      />
    </span>
  )
}
