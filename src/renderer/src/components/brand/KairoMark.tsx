import type { CSSProperties } from 'react'
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '@shared/brand'
import { cn } from '@/lib/utils'
import kairoTile from '@/assets/kairo-tile.png'
import kairoMark from '@/assets/kairo-mark.png'
import kairoWordmark from '@/assets/kairo-wordmark.png'

/** The brand files, for effects that need their shapes (e.g. a glint masked to the tile). */
export const KAIRO_TILE_URL = kairoTile
export const KAIRO_MARK_URL = kairoMark

type MarkSize = 'sm' | 'md' | 'lg'

const SIZE: Record<MarkSize, number> = { sm: 28, md: 56, lg: 72 }

/**
 * The Kairo mark — four rounded quarters forming a K.
 *
 * - `mark` (default): the bare mark in the current text colour (off-white in
 *   dark, ink in light). Used everywhere inside the app — blue is reserved for
 *   what is live on screen, so the brand mark stays neutral.
 * - `tile`: the off-white mark on the blue app-icon tile, matching the Dock
 *   icon, for the rare place that should look like the app icon itself.
 */
export function KairoMark({
  size = 'md',
  variant = 'mark',
  className,
}: {
  size?: MarkSize
  variant?: 'tile' | 'mark'
  className?: string
}): React.ReactElement {
  const px = SIZE[size]
  if (variant === 'mark') {
    // A mask so one file serves every theme: the shape comes from the PNG,
    // the colour from the theme's text token.
    const box = Math.round(px * 0.72)
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block shrink-0 bg-[rgb(var(--text-primary))]', className)}
        style={{ width: box, height: box, ...maskOf(kairoMark) }}
      />
    )
  }
  return (
    <img
      src={kairoTile}
      alt=""
      width={px}
      height={px}
      className={cn('inline-block shrink-0 select-none', className)}
      draggable={false}
    />
  )
}

/** Mark + wordmark, as drawn by the brand — not a font approximation. */
export function KairoLockup({
  size = 'md',
  tagline = false,
  align = 'center',
  className,
}: {
  size?: MarkSize
  tagline?: boolean
  align?: 'center' | 'start'
  className?: string
}): React.ReactElement {
  // The horizontal lockup's height; its width follows the artwork's ratio.
  const height = size === 'lg' ? 40 : size === 'md' ? 32 : 24
  return (
    <div
      className={cn(
        'flex flex-col gap-3',
        align === 'center' ? 'items-center text-center' : 'items-start text-left',
        className,
      )}
    >
      <span
        role="img"
        aria-label={PRODUCT_NAME}
        className="inline-block bg-[rgb(var(--text-primary))]"
        style={{ height, aspectRatio: '1002 / 240', ...maskOf(kairoWordmark) }}
      />
      {tagline && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
          {PRODUCT_TAGLINE}
        </p>
      )}
    </div>
  )
}

function maskOf(url: string): CSSProperties {
  return {
    WebkitMaskImage: `url(${url})`,
    maskImage: `url(${url})`,
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
  }
}
