import type { OverlayContentKind, OverlayDispatchResult, OverlayOutput } from '@shared/ipc'
import { getDispatchPlan } from '@shared/overlay-outputs'

/** Dispatch immediately to every program destination; one failure cannot block another. */
export async function dispatchToOutputs(
  outputs: readonly OverlayOutput[],
  kind: OverlayContentKind,
  push: (output: OverlayOutput) => Promise<string | null>,
): Promise<OverlayDispatchResult[]> {
  const plan = getDispatchPlan(outputs, (output) => output.show[kind])
  const attempt = async (output: OverlayOutput): Promise<OverlayDispatchResult> => {
    const base = { outputId: output.id, name: output.name, kind: output.kind }
    try {
      const reason = await push(output)
      return reason === null ? { ...base, ok: true } : { ...base, ok: false, reason }
    } catch (error) {
      return { ...base, ok: false, reason: (error as Error).message }
    }
  }
  const results = await Promise.all(plan.rendered.map(attempt))
  if (!results.some((result) => result.ok)) {
    for (const output of plan.fallbacks) {
      const result = await attempt(output)
      results.push(result)
      if (result.ok) break
    }
  }
  return results
}
