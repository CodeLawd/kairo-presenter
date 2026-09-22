/**
 * The message an IPC failure should show an operator.
 *
 * Electron wraps anything thrown in a main-process handler:
 *
 *   Error invoking remote method 'lyrics:pushSlide': Error: ProPresenter is
 *   not connected. Connect in Settings → ProPresenter first.
 *
 * The channel name and the doubled "Error:" are plumbing. What the service
 * actually said is the part worth putting on screen mid-service, so the
 * wrapper is stripped back to it.
 */

const REMOTE_WRAPPER = /^Error invoking remote method '[^']*':\s*/
const LEADING_ERROR = /^(?:[A-Za-z]*Error):\s*/

export function cleanIpcError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String((error as { message?: unknown } | null)?.message ?? error ?? '')

  let message = raw.replace(REMOTE_WRAPPER, '').trim()
  // A handler that rethrows can nest the prefix more than once.
  while (LEADING_ERROR.test(message)) {
    message = message.replace(LEADING_ERROR, '').trim()
  }

  return message || 'Something went wrong.'
}
