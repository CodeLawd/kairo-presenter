import { cx } from './primitives'

/** The numbered eyebrow above a section heading — "02 / Listening". */
export function Kicker({
  n,
  label,
  className,
}: {
  n: string
  label: string
  className?: string
}): React.ReactElement {
  return (
    <p
      className={cx(
        'm-0 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-mute',
        className,
      )}
    >
      <b className="font-medium text-faint">{n}</b>
      <i className="mx-[0.7em] not-italic text-faint">/</i>
      {label}
    </p>
  )
}
