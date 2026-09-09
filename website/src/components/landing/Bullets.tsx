export function Bullets({
  items,
}: {
  items: { lead: string; rest: string }[]
}): React.ReactElement {
  return (
    <ul className="m-0 mt-7 grid list-none gap-[15px] p-0">
      {items.map((b) => (
        <li
          key={b.lead}
          className="grid grid-cols-[15px_1fr] gap-3 text-[15px] leading-[1.6] text-dim before:mt-[9px] before:block before:h-[5px] before:w-[5px] before:rounded-full before:bg-accent before:shadow-[0_0_10px_rgba(245,158,11,0.25)]"
        >
          <span>
            <b className="font-semibold text-paper">{b.lead}.</b> {b.rest}
          </span>
        </li>
      ))}
    </ul>
  )
}
