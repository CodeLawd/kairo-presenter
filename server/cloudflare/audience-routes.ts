import { engageRoutes } from './engage-routes'
import { AUDIENCE_CODE, normalizeAudienceRoomSettings, type AudienceRoomSettings } from '../../src/lib/audience-protocol'
import { audienceTokenHash, type AudienceRoom } from './audience-room'

export interface AudienceEnv {
  AUDIENCE_ROOM: DurableObjectNamespace<AudienceRoom>
  ENGAGE_INTERNAL_SECRET?: unknown
  WEB_ORIGIN?: unknown
  PUBLIC_WEB_URL?: unknown
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function roomCode(): string {
  // 32 symbols: no modulo bias.
  return [...crypto.getRandomValues(new Uint8Array(6))].map(n => ALPHABET[n % ALPHABET.length]).join('')
}

export async function audienceRoutes(
  request: Request,
  env: AudienceEnv,
  verify: (request: Request) => Promise<Response>,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/v1/audience/') && url.pathname !== '/v1/engage' && !url.pathname.startsWith('/v1/engage/')) return null
  const webOrigin = typeof env.WEB_ORIGIN === 'string' ? env.WEB_ORIGIN : 'https://kairopresenter.com'
  const origin = request.headers.get('Origin')
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (origin && origin !== webOrigin && !(local && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))) return new Response('Origin not allowed', { status: 403 })
  const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Credentials', 'true')
    headers.set('Vary', 'Origin')
  }
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-PA-Client')
    return new Response(null, { status: 204, headers })
  }
  if (url.pathname.startsWith('/v1/engage') && !/^\/v1\/engage\/[^/]+\/(session|ws)$/.test(url.pathname)) return engageRoutes(request, env, verify, headers)
  if (url.pathname === '/v1/audience/rooms' && request.method === 'POST') {
    if (!request.headers.get('Authorization')?.startsWith('Bearer ')) return Response.json({ message: 'Sign in to Kairo to start a Q&A.' }, { status: 401, headers })
    if (Number(request.headers.get('Content-Length') || 0) > 2048) return new Response('Request too large', { status: 413, headers })
    const text = await request.text()
    if (text.length > 2048) return new Response('Request too large', { status: 413, headers })
    let title: string
    let settings: AudienceRoomSettings
    try {
      const body = JSON.parse(text)
      if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100) throw new Error()
      title = body.title.trim()
      settings = normalizeAudienceRoomSettings(body.settings)
    } catch { return Response.json({ message: 'Give the Q&A a title of up to 100 characters.' }, { status: 400, headers }) }
    // Only room creation touches Nest. Its existing JWT, membership and device
    // licence checks establish the identity; no tokens or sockets go through it later.
    const authHeaders = new Headers({ Authorization: request.headers.get('Authorization')! })
    const licence = await verify(new Request(new URL('/v1/licensing', url), { headers: authHeaders }))
    if (!licence.ok) return new Response(licence.body, { status: licence.status, headers })
    const snapshot = await licence.json() as { activated?: boolean; lease?: { claims: { orgId: string } } }
    if (!snapshot.activated || !snapshot.lease) return Response.json({ message: 'Activate this computer to start a Q&A.' }, { status: 403, headers })
    const orgId = snapshot.lease.claims.orgId
    const orgResponse = await verify(new Request(new URL(`/v1/orgs/${encodeURIComponent(orgId)}`, url), { headers: authHeaders }))
    if (!orgResponse.ok) return Response.json({ message: 'Couldn’t check your church account. Try again.' }, { status: 403, headers })
    const org = await orgResponse.json() as { name?: string }
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = roomCode()
      const token = crypto.randomUUID() + crypto.randomUUID()
      const room = env.AUDIENCE_ROOM.getByName(code)
      if (!await room.initialize({ code, title, orgName: String(org.name || 'Kairo Q&A').slice(0, 100), tokenHash: await audienceTokenHash(token), settings })) continue
      const publicUrl = typeof env.PUBLIC_WEB_URL === 'string' ? env.PUBLIC_WEB_URL : 'https://kairopresenter.com'
      return Response.json({ roomId: room.id.toString(), code, operatorToken: token, title, settings, url: `${publicUrl.replace(/\/$/, '')}/q/${code}` }, { status: 201, headers })
    }
    return Response.json({ message: 'Couldn’t get a join code. Try again.' }, { status: 503, headers })
  }
  const match = /^(?:\/v1\/audience\/rooms|\/v1\/engage)\/([^/]+)\/(session|ws)$/.exec(url.pathname)
  if (!match || !AUDIENCE_CODE.test(match[1]) || request.method !== 'GET') return new Response('Not found', { status: 404, headers })
  const code = match[1]
  if (match[2] === 'session') {
    // The random identifier is not an account and contains no identifying data.
    const cookieName = `kairo-audience-${code}`
    let participant = request.headers.get('Cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
    if (!participant || !/^[a-f0-9-]{36}$/.test(participant)) participant = crypto.randomUUID()
    const room = await env.AUDIENCE_ROOM.getByName(code).availability(participant)
    if (!room.exists || room.ended) return Response.json({ message: room.exists ? 'This Q&A has ended.' : 'This join code was not found.' }, { status: room.exists ? 410 : 404, headers })
    headers.set('Set-Cookie', `${cookieName}=${participant}; HttpOnly; SameSite=Lax; Path=${url.pathname.slice(0, -8)}; Max-Age=2592000${local ? '' : '; Secure'}`)
    return Response.json({ ready: true, snapshot: room.snapshot, engage: room.engage }, { headers })
  }
  const cookieName = `kairo-audience-${code}`
  const participant = request.headers.get('Cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  const forwarded = new Request(request)
  // Never trust an externally supplied internal participant header.
  forwarded.headers.delete('X-Audience-Participant')
  if (participant && /^[a-f0-9-]{36}$/.test(participant)) forwarded.headers.set('X-Audience-Participant', participant)
  return env.AUDIENCE_ROOM.getByName(code).fetch(forwarded)
}
