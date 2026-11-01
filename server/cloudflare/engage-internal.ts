import { getContainer } from '@cloudflare/containers'

/** Lifecycle/email calls only. Live traffic remains in SQLite and sockets. */
export async function engageInternal(env: Record<string, unknown>, path: 'index' | 'invite', body: unknown): Promise<Response> {
  const secret = env.ENGAGE_INTERNAL_SECRET
  if (typeof secret !== 'string' || !secret) return Response.json({ message: 'Engage email and storage are not configured.' }, { status: 503 })
  const request = new Request(`https://internal/v1/internal/engage/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) })
  if (typeof env.LOCAL_API_URL === 'string') return fetch(new Request(new URL(new URL(request.url).pathname, env.LOCAL_API_URL), request))
  if (!env.KAIRO_API) return new Response('Unavailable', { status: 503 })
  const api = getContainer(env.KAIRO_API as Parameters<typeof getContainer>[0], 'api-v2')
  await api.startAndWaitForPorts({ ports: 3000, cancellationOptions: { portReadyTimeoutMS: 90_000 } })
  return api.fetch(request)
}
