/**
 * A feature's points.
 *
 * Each row used to carry its own top hairline. Across two columns of uneven
 * length that rendered as a broken ladder — rules stopping halfway down one
 * side — so the rules are gone and the spacing carries the separation.
 */
export function Bullets({
  items,
  single,
}: {
  items: string[]
  /** One column — for the pinned panel, where the copy column is narrow. */
  single?: boolean
}): React.ReactElement {
  return (
    <ul
      className={[
        'm-0 grid list-none gap-x-[clamp(32px,5vw,72px)] gap-y-[13px] pl-0',
        single ? '' : 'sm:grid-cols-2',
      ].join(' ')}
    >
      {items.map((item) => (
        <li
          key={item}
          className="grid grid-cols-[14px_1fr] gap-3 text-[15.5px] leading-[1.55] text-dim before:mt-[9px] before:block before:h-[5px] before:w-[5px] before:rounded-full before:bg-accent"
        >
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}
