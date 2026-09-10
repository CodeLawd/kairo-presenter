/**
 * A 2px rail rather than a step picker.
 *
 * The desktop wizard uses the same treatment, so the two surfaces rhyme even
 * though the layout deliberately does not.
 */
export function Progress({ step, total }: { step: number; total: number }): React.ReactElement {
  return (
    <div>
      <div className="h-[2px] w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full bg-accent transition-[width] duration-300 ease-out"
          style={{ width: `${(step / total) * 100}%` }}
        />
      </div>
      <p className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
        Setup · {step} of {total}
      </p>
    </div>
  )
}
