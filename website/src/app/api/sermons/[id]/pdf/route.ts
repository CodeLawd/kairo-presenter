import { type NextRequest, NextResponse } from 'next/server'
import { googleFonts, type FontSubset } from '@takumi-rs/helpers'
import { render } from 'takumi-pdf'
import {
  RECAP_PAGE_MARGIN,
  SermonRecapDocument,
  SermonRecapFooter,
} from '@/components/pdf/SermonRecapDocument'
import { apiTarget } from '@/lib/api-target'
import type { SermonDetail } from '@/lib/sermons'

/** takumi-pdf is a WASM renderer — it needs the Node runtime, not the edge. */
export const runtime = 'nodejs'

/**
 * Inter, fetched once per process and reused.
 *
 * The recap theme sets everything in Inter, so the PDF has to embed it —
 * otherwise headings fall back to a renderer default that matches neither
 * the preview nor the design. A failed fetch resolves to no custom fonts
 * rather than a failed PDF; the `fontFamilies` fallback then carries it.
 */
let cachedFonts: Promise<FontSubset[]> | null = null
function interFonts(): Promise<FontSubset[]> {
  cachedFonts ??= googleFonts(['Inter']).catch(() => [])
  return cachedFonts
}

/** A filename a church can find again in a Downloads folder six months later. */
function filenameFor(sermon: SermonDetail): string {
  const date = sermon.preachedAt.slice(0, 10)
  const name = (sermon.summary?.headline ?? sermon.title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `${date}-${name || 'recap'}.pdf`
}

/**
 * Renders one recap as a PDF.
 *
 * The sermon is re-fetched from the API with the caller's own token rather
 * than accepted from the request body. That does two things: the PDF can only
 * ever contain a recap this user is already allowed to read, and authorization
 * stays in one place — whatever the API says about this sermon is what happens
 * here, including 401, 403 and 404.
 */
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const orgId = request.nextUrl.searchParams.get('orgId')
  const authorization = request.headers.get('authorization')

  if (!orgId) {
    return NextResponse.json({ message: 'Missing orgId.' }, { status: 400 })
  }
  if (!authorization) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${apiTarget()}/v1/orgs/${orgId}/sermons/${id}`, {
      headers: { authorization },
      cache: 'no-store',
    })
  } catch {
    return NextResponse.json(
      { message: 'Could not reach Kairo. Check your connection.' },
      { status: 502 },
    )
  }

  if (!upstream.ok) {
    // Hand back the API's own refusal so the page can react to a 401 exactly
    // as it does for every other request.
    const body = await upstream.json().catch(() => ({ message: 'Unauthorized' }))
    return NextResponse.json(body, { status: upstream.status })
  }

  const sermon = (await upstream.json()) as SermonDetail
  if (!sermon.summary) {
    return NextResponse.json(
      { message: 'This recap has not been written yet.' },
      { status: 409 },
    )
  }

  // The church name is read from the session rather than taken from the query
  // string: it is printed on a document a congregation receives, so it should
  // not be something the caller can type.
  const churchName = await fetch(`${apiTarget()}/v1/auth/session`, {
    headers: { authorization },
    cache: 'no-store',
  })
    .then((response) => (response.ok ? response.json() : null))
    .then((session: { orgs?: { id: string; name: string }[] } | null) =>
      session?.orgs?.find((org) => org.id === orgId)?.name ?? '',
    )
    .catch(() => '')

  const pdf = await render(
    SermonRecapDocument({
      title: sermon.title,
      speaker: sermon.speaker,
      preachedAt: sermon.preachedAt,
      churchName,
      summary: sermon.summary,
    }),
    {
      size: 'a4',
      margin: RECAP_PAGE_MARGIN,
      fonts: await interFonts(),
      fontFamilies: ['Inter', 'sans-serif'],
      // A footer option is laid out per page and receives the page counters;
      // the same markup inside the content flow would print once, unnumbered.
      footer: SermonRecapFooter({ churchName, title: sermon.title }),
    },
  )

  return new NextResponse(pdf as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filenameFor(sermon)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
