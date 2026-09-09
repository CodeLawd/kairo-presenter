import Link from 'next/link'
import { KairoMark } from './KairoMark'

/**
 * Mark + name, linking home. Defined once and shared by the site header, the
 * footer and the auth shell — the original landing page inlined this twice and
 * the two copies had already drifted apart.
 */
export function Wordmark({
  size = 24,
  href = '/',
  className,
}: {
  size?: number
  /** `null` renders the lockup as plain text — for use on the home page itself. */
  href?: string | null
  className?: string
}): React.ReactElement {
  const inner = (
    <>
      <KairoMark size={size} />
      <span className="font-display font-bold tracking-[-0.03em] text-paper">Kairo</span>
    </>
  )

  const classes = `inline-flex items-center gap-2.5 text-[15px]${className ? ` ${className}` : ''}`

  if (href === null) return <span className={classes}>{inner}</span>

  return (
    <Link href={href} className={`${classes} transition-opacity hover:opacity-80`}>
      {inner}
    </Link>
  )
}
