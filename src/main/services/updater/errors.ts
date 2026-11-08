/** Keep updater diagnostics in the log, not in the operator-facing interface. */
export function updateErrorMessage(error: unknown, operation: 'check' | 'download'): string {
  const message = error instanceof Error ? error.message : String(error)
  const network = /\b(?:5\d\d|408|429)\b|network|timeout|timed out|econn|enotfound|offline|net::/i.test(message)
  const action = operation === 'download' ? 'download the update' : 'check for updates'
  return `Could not ${action}. ${network ? 'Please check your connection and try again.' : 'Please try again.'}`
}
