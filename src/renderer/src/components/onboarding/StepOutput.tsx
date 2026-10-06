import { Check } from '@/icons'
import { cn } from '@/lib/utils'
import type { AppSettings, OverlayOutput } from '@shared/ipc'
import { outputDestinationLabel } from '@shared/overlay-outputs'
import { applyOutputRoute, outputRouteOf, type OutputRoute } from '@shared/overlay-defaults'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { DisplayPicker, useDisplays } from '@/components/screens/displays'
import StepShell from './StepShell'

const ROUTES: Array<{ id: OutputRoute; title: string; detail: string }> = [
  {
    id: 'screen',
    title: 'Directly to a screen',
    detail: 'A projector or TV plugged into this computer. No ProPresenter needed.',
  },
  {
    id: 'propresenter',
    title: 'Through ProPresenter',
    detail: 'Kairo sends to ProPresenter, and ProPresenter drives the screens.',
  },
  {
    id: 'both',
    title: 'Both',
    detail: 'A screen from Kairo, plus ProPresenter for stage and stream.',
  },
]

/**
 * How pushes reach the room, then which destinations are on. The route answer
 * only switches outputs on and off — the same `overlay.outputs` the Theme →
 * Output panel edits — so nothing is wizard-only, and whether the ProPresenter
 * steps come next is read straight off the result.
 *
 * Rendered as hairline-separated lists rather than a stack of cards — five of
 * those in a 520px dialog reads as clutter, not as choices.
 */
export default function StepOutput(): React.ReactElement {
  const overlay = useBootstrapStore((s) => s.settings.overlay)
  const settings = useBootstrapStore((s) => s.settings)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const displays = useDisplays()
  const route = outputRouteOf(overlay.outputs)

  const save = async (outputs: OverlayOutput[]): Promise<void> => {
    const next: AppSettings['overlay'] = { ...overlay, outputs }
    patchSettings('overlay', next)
    await window.api.settings.set('overlay', next)
  }

  // The answer is also the ProPresenter switch: only a setup that goes through
  // ProPresenter turns the integration on (Settings → ProPresenter).
  const chooseRoute = async (route: OutputRoute): Promise<void> => {
    const propresenter = { ...settings.propresenter, enabled: route !== 'screen' }
    patchSettings('propresenter', propresenter)
    await window.api.settings.set('propresenter', propresenter)
    await save(applyOutputRoute(overlay.outputs, route))
  }

  const patchOutput = (id: string, patch: Partial<OverlayOutput>): Promise<void> =>
    save(overlay.outputs.map((output) => (output.id === id ? { ...output, ...patch } : output)))

  const screen = overlay.outputs.find((output) => output.kind === 'screen' && output.enabled)

  return (
    <StepShell
      title="How does Kairo reach your screens?"
      blurb="You can change this any time in Theme → Output."
    >
      <ul className="-mx-1" role="radiogroup">
        {ROUTES.map((option) => {
          const selected = route === option.id
          return (
            <li key={option.id}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => void chooseRoute(option.id)}
                className="flex w-full items-start gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <span
                  className={cn(
                    'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border transition-colors',
                    selected ? 'border-teal-500 bg-teal-500' : 'border-transparent bg-surface-elevated',
                  )}
                  aria-hidden="true"
                >
                  {selected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-slate-200">{option.title}</span>
                  <span className="block text-[11px] leading-snug text-slate-500">{option.detail}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      {screen && (
        <DisplayPicker
          id="onboarding-display"
          target={screen}
          displays={displays}
          others={[]}
          onChange={(patch) => void patchOutput(screen.id, patch)}
        />
      )}

      {route && (
        <details className="group">
          <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
            Fine-tune which outputs are on
          </summary>
          <ul className="-mx-1 mt-2">
            {overlay.outputs.map((output) => (
              <li key={output.id}>
                <button
                  type="button"
                  onClick={() => void patchOutput(output.id, { enabled: !output.enabled })}
                  aria-pressed={output.enabled}
                  className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                      output.enabled
                        ? 'border-teal-500 bg-teal-500 text-white'
                        : 'border-transparent bg-surface-elevated'
                    }`}
                    aria-hidden="true"
                  >
                    {output.enabled && <Check size={11} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">
                    {output.name}
                  </span>
                  <span className="shrink-0 text-[11px] text-slate-600">
                    {outputDestinationLabel(output.kind)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </StepShell>
  )
}
