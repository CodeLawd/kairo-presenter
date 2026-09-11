import { type NextRequest, NextResponse } from 'next/server'
import { apiTarget } from '@/lib/api-target'

/**
 * Forwards `/v1/*` to the Nest API so the browser talks same-origin.
 *
 * The refresh cookie is HttpOnly and must be first-party. Calling Render from
 * a Vercel origin makes it a third-party cookie — browsers drop it, and every
 * `/v1/auth/refresh` then returns "No refresh token supplied".
 */
const TARGET = apiTarget()

const HOP_BY_HOP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const incoming = new URL(request.url)
  const target = `${TARGET}/v1/${path.join('/')}${incoming.search}`

  const headers = new Headers()
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'host' || lower === 'content-length') return
    headers.set(key, value)
  })

  const method = request.method.toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' ? undefined : await request.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json(
      { message: 'Could not reach Kairo. Check your connection.' },
      { status: 502 },
    )
  }

  const out = new Headers()
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'set-cookie' || HOP_BY_HOP.has(lower)) return
    out.set(key, value)
  })

  // Node/undici exposes each Set-Cookie distinctly; a plain Headers walk can
  // collapse them and break the refresh cookie.
  const setCookies =
    typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : []
  for (const cookie of setCookies) {
    out.append('set-cookie', cookie)
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: out,
  })
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(request, path)
}

export async function POST(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(request, path)
}

export async function PUT(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(request, path)
}

export async function PATCH(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(request, path)
}

export async function DELETE(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(request, path)
}

export async function OPTIONS(request: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params
  return proxy(request, path)
}
