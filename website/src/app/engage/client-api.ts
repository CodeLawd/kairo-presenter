import { audiencePhoneApiBase } from '../q/api-base'

export function engageApiBase(): string {
  return audiencePhoneApiBase(window.location.hostname, process.env.NEXT_PUBLIC_AUDIENCE_API_URL)
}
export class EngageRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}
export async function engagePost<T>(code: string, action: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`${engageApiBase()}/v1/engage/${encodeURIComponent(code)}/${action}`, {
    method: 'POST', credentials: 'include', referrerPolicy: 'no-referrer',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) {
    // These endpoints may return plain text or a JSON message. Never echo an invitation request.
    const text = await response.text()
    let message = text
    try { const data = JSON.parse(text) as { message?: unknown }; message = typeof data.message === 'string' ? data.message : 'Could not complete the action.' } catch { /* Plain-text Worker response. */ }
    throw new EngageRequestError(message.slice(0, 300) || 'Could not complete the action.', response.status)
  }
  return response.json() as Promise<T>
}
