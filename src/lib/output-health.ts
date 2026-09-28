// ─── Dispatch health (standalone phase 1, D8) ──────────────────────────────────
// Pure — no Node/DOM APIs. One push's per-output results become two health
// lines: `output` (did the slide reach the screens) and `propresenter` (the PP
// link and the outputs that go through it). Kept apart so a Kairo-screens-only
// booth is never shown red because ProPresenter is not running.

import type { OverlayDispatchResult, ServiceHealth } from './ipc'
import { outputRequiresPropresenter } from './overlay-outputs'

export interface HealthLine {
  status: ServiceHealth['status']
  lastError?: string
}

export function dispatchHealth(
  results: readonly OverlayDispatchResult[],
  input: { ppOffline: boolean; usesPropresenter: boolean },
): { output: HealthLine; propresenter: HealthLine } {
  const describe = (failed: readonly OverlayDispatchResult[]): string =>
    `Output failed: ${failed.map((f) => `${f.name} (${f.reason ?? 'unknown'})`).join('; ')}`
  const failed = results.filter((r) => !r.ok)

  const output: HealthLine =
    results.length === 0
      ? { status: 'error', lastError: 'No outputs are enabled' }
      : failed.length === results.length
        ? { status: 'error', lastError: describe(failed) }
        : failed.length > 0
          ? { status: 'degraded', lastError: describe(failed) }
          : { status: 'ok' }

  if (input.ppOffline) {
    return {
      output,
      propresenter: input.usesPropresenter
        ? { status: 'error', lastError: 'ProPresenter disconnected' }
        : { status: 'ok' },
    }
  }
  const ppFailed = failed.filter((r) => outputRequiresPropresenter(r.kind))
  return {
    output,
    propresenter: ppFailed.length > 0 ? { status: 'degraded', lastError: describe(ppFailed) } : { status: 'ok' },
  }
}
