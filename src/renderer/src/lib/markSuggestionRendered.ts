/**
 * Report that a suggestion has reached the operator's eyes.
 *
 * Called the moment a suggestion arrives in the renderer, but it does not stamp
 * immediately — setting React state is not the same as the verse being visible.
 * Two nested `requestAnimationFrame` calls are the standard way to wait for the
 * frame that contains the change: the first fires *before* the browser paints
 * the pending update, the second on the frame after it has been composited.
 *
 * That is the closest honest proxy available from script for "the operator can
 * see it", and it is deliberately an over-estimate rather than an under-estimate
 * — a latency number that flatters the app is worse than no number.
 *
 * Fire-and-forget by design: nothing here may add to the latency it measures.
 */
export function markSuggestionRendered(correlationId: string | undefined): void {
  if (!correlationId) return

  // No rAF outside a browser (tests, SSR): report straight away rather than
  // silently dropping the sample.
  if (typeof requestAnimationFrame !== 'function') {
    window.api?.scripture?.markRendered?.(correlationId)
    return
  }

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        window.api.scripture.markRendered(correlationId)
      } catch {
        // Telemetry must never break a live service.
      }
    })
  })
}
