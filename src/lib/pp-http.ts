/** How long we wait for ProPresenter REST when the box is this machine. */
export const PP_LOCAL_TIMEOUT_MS = 3_000
/**
 * LAN / Wi-Fi. NDI on the same AP routinely adds seconds of jitter; 3s was
 * aborting a healthy handshake.
 */
export const PP_REMOTE_TIMEOUT_MS = 10_000
/** Extra handshake tries on a remote host after a timeout, before we surface error. */
export const PP_REMOTE_CONNECT_ATTEMPTS = 2

export function isLocalProPresenterHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]'
}

export function proPresenterHttpTimeoutMs(host: string): number {
  return isLocalProPresenterHost(host) ? PP_LOCAL_TIMEOUT_MS : PP_REMOTE_TIMEOUT_MS
}

export function proPresenterConnectAttempts(host: string): number {
  return isLocalProPresenterHost(host) ? 1 : PP_REMOTE_CONNECT_ATTEMPTS
}
