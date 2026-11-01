import { cleanIpcError } from './ipc-error'

/** Local Nest handles account HTTP; the local Worker owns room sockets/storage. */
export function audienceApiBaseUrl(apiBaseUrl: string, override?: string): string {
  if (override?.trim()) return override.trim().replace(/\/$/, '')
  try {
    const url = new URL(apiBaseUrl)
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '3000') return 'http://localhost:8787'
  } catch { /* Preserve the existing API configuration error rather than failing startup. */ }
  return apiBaseUrl.replace(/\/$/, '')
}

export function audienceRoomError(error: unknown, local: boolean): string {
  const status = (error as { status?: unknown } | null)?.status
  if (status === 404) return local
    ? 'Audience Q&A is not available on the local server. Start the server with bun run start:dev, then try again.'
    : 'Audience Q&A is not available on this server yet. Please update the Kairo server.'
  if (status === 401) return 'Sign in to Kairo to start a Q&A.'
  if (local && status === null) return 'Could not reach the local Audience service. Start the server with bun run start:dev, then try again.'
  return cleanIpcError(error)
}
