import type { OverlayDispatchResult, ServiceHealth } from './ipc'

export interface HealthLine {
  status: ServiceHealth['status']
  lastError?: string
}

export function dispatchHealth(
  results: readonly OverlayDispatchResult[],
): { output: HealthLine } {
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

  return { output }
}
