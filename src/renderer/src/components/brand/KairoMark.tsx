import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@shared/brand'
import { cn } from '@/lib/utils'
import kairoIcon from '@/assets/kairo-icon.png'

type MarkSize = 'sm' | 'md' | 'lg'

const SIZE: Record<MarkSize, { box: string; img: number }> = {
  sm: { box: 'h-9 w-9', img: 36 },
  md: { box: 'h-14 w-14', img: 56 },
  lg: { box: 'h-[4.5rem] w-[4.5rem]', img: 72 },
}

/**
 * The Kairo app mark — rounded amber K icon used on splash, auth, and setup.
 */
export function KairoMark({
  size = 'md',
  className,
  glow = false,
}: {
  size?: MarkSize
  className?: string
  /** Soft amber halo behind the mark (auth / onboarding heroes). */
  glow?: boolean
}): React.ReactElement {
  const dim = SIZE[size]
  return (
    <span
      className={cn(
        'relative inline-grid place-items-center',
        dim.box,
        className,
      )}
    >
      {glow && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-4 rounded-[28%] bg-[#F59E0B]/20 blur-2xl"
        />
      )}
      <img
        src={kairoIcon}
        alt=""
        width={dim.img}
        height={dim.img}
        className={cn('relative h-full w-full object-contain drop-shadow-sm', dim.box)}
        draggable={false}
      />
    </span>
  )
}

/**
 * Icon + wordmark (+ optional tagline). Brand-first lockup for auth and setup.
 */
export function KairoLockup({
  size = 'md',
  tagline = false,
  align = 'center',
  glow = false,
  className,
}: {
  size?: MarkSize
  tagline?: boolean
  align?: 'center' | 'start'
  glow?: boolean
  className?: string
}): React.ReactElement {
  const titleSize =
    size === 'lg' ? 'text-[26px]' : size === 'md' ? 'text-[22px]' : 'text-[17px]'

  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      <KairoMark size={size} glow={glow} />
      <div className={cn(align === 'center' && 'flex flex-col items-center')}>
        <p
          className={cn(
            'font-semibold leading-none tracking-[-0.03em] text-white',
            titleSize,
          )}
        >
          {PRODUCT_NAME}
        </p>
        {tagline && (
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            {PRODUCT_TAGLINE}
          </p>
        )}
      </div>
    </div>
  )
}
