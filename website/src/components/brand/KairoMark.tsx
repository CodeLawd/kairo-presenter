import Image from 'next/image'
import kairoIcon from '../../../public/brand/kairo-icon.png'

/**
 * The Kairo app mark — the same rounded amber K the desktop app shows on its
 * splash, auth wall and setup wizard.
 *
 * It is a PNG rather than an SVG because no vector of the mark exists in either
 * repo, and drawing one here would fork the brand into two subtly different
 * marks. next/image serves a small WebP from it, so the source file's size does
 * not reach the browser.
 */
export function KairoMark({
  size = 24,
  glow = false,
  className,
}: {
  size?: number
  /** Soft amber halo behind the mark, as on the desktop auth screens. */
  glow?: boolean
  className?: string
}): React.ReactElement {
  return (
    <span
      className={`relative inline-flex flex-none${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size }}
    >
      {glow && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-4 rounded-[28%] bg-accent/20 blur-2xl"
        />
      )}
      <Image
        src={kairoIcon}
        alt=""
        width={size}
        height={size}
        className="relative rounded-[26%]"
        priority={size >= 40}
      />
    </span>
  )
}
