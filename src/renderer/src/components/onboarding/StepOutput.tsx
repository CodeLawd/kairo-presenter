import { Check } from '@/icons'
import { layerLabel, layerOfKind } from '@shared/overlay-outputs'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import StepShell from './StepShell'

/**
 * Which destinations a push lands on. Toggling here writes the same
 * `overlay.outputs` the Theme → Output panel edits, so nothing is wizard-only.
 *
 * Rendered as a hairline-separated list rather than a stack of cards — five of
 * those in a 520px dialog reads as clutter, not as choices.
 */
export default function StepOutput(): React.ReactElement {
  const overlay = useBootstrapStore((s) => s.settings.overlay)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)

  const toggle = async (id: string, enabled: boolean): Promise<void> => {
    const next = {
      ...overlay,
      outputs: overlay.outputs.map((output) => (output.id === id ? { ...output, enabled } : output)),
    }
    patchSettings('overlay', next)
    await window.api.settings.set('overlay', next)
  }

  return (
    <StepShell
      title="Where scripture goes"
      blurb="Turn on what this machine pushes to. You can restyle any of them later in Theme."
    >
      {overlay.outputs.length === 0 ? (
        <p className="text-[13px] text-slate-500">
          No outputs yet — add one in Theme → Output once setup is done.
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-surface-border/40">
          {overlay.outputs.map((output) => (
            <li key={output.id}>
              <button
                type="button"
                onClick={() => void toggle(output.id, !output.enabled)}
                aria-pressed={output.enabled}
                className="flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left transition-colors hover:bg-surface-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                    output.enabled
                      ? 'border-teal-500 bg-teal-500 text-white'
                      : 'border-surface-border bg-transparent'
                  }`}
                  aria-hidden="true"
                >
                  {output.enabled && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">
                  {output.name}
                </span>
                <span className="shrink-0 text-[11px] text-slate-600">
                  {layerLabel(layerOfKind(output.kind))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </StepShell>
  )
}
