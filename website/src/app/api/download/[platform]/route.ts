import { after, NextRequest, NextResponse } from 'next/server'
import { apiTarget } from '@/lib/api-target'
import { changelog } from '@/lib/changelog'

type ReleaseAsset = { name: string; browser_download_url: string }
type GitHubRelease = { tag_name?: string; assets?: ReleaseAsset[] }

const matches: Record<string, (name: string) => boolean> = {
  'mac-arm64': (name) => /arm64\.dmg$/i.test(name),
  'mac-x64': (name) => /\.dmg$/i.test(name) && !/(arm64|aarch64)/i.test(name),
  'windows-x64': (name) => /\.exe$/i.test(name),
  'linux-x64': (name) => /\.AppImage$/i.test(name),
}

const fallbackFilenames: Record<string, (version: string) => string> = {
  'windows-x64': (v) => `Kairo-Setup-${v}.exe`,
  'mac-arm64': (v) => `Kairo-${v}-arm64.dmg`,
  'mac-x64': (v) => `Kairo-${v}.dmg`,
  'linux-x64': (v) => `Kairo-${v}.AppImage`,
}

let cachedRelease: { release: GitHubRelease; expiresAt: number } | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform } = await context.params
  const match = matches[platform]
  if (!match) return new NextResponse('Unknown platform', { status: 404 })

  let version = ''
  let release: GitHubRelease | null = null

  // 1. Check in-memory cache
  if (cachedRelease && Date.now() < cachedRelease.expiresAt) {
    release = cachedRelease.release
  } else {
    try {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Kairo-website',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }
      const response = await fetch('https://api.github.com/repos/CodeLawd/kairo-presenter/releases/latest', {
        headers,
        next: { revalidate: 300 },
      })
      if (response.ok) {
        release = (await response.json()) as GitHubRelease
        cachedRelease = {
          release,
          expiresAt: Date.now() + CACHE_TTL_MS,
        }
      } else if (cachedRelease) {
        // Retain stale cache if GitHub rate-limits (e.g. HTTP 403)
        release = cachedRelease.release
      }
    } catch {
      if (cachedRelease) {
        release = cachedRelease.release
      }
    }
  }

  // 2. If release info is available, find asset matching platform
  if (release) {
    version = release.tag_name?.replace(/^v/, '') ?? ''
    const asset = release.assets?.find((item) => match(item.name))
    if (asset && asset.browser_download_url.startsWith('https://github.com/CodeLawd/kairo-presenter/releases/download/')) {
      record(request, platform, version, true)
      return NextResponse.redirect(asset.browser_download_url)
    }
  }

  // 3. Fallback: construct direct release asset URL using latest known changelog version
  const fallbackVersion = changelog[0]?.version
  const getFilename = fallbackFilenames[platform]
  if (fallbackVersion && getFilename) {
    const fallbackUrl = `https://github.com/CodeLawd/kairo-presenter/releases/download/v${fallbackVersion}/${getFilename(fallbackVersion)}`
    record(request, platform, fallbackVersion, true)
    return NextResponse.redirect(fallbackUrl)
  }

  // 4. Last resort: direct to GitHub releases page rather than a broken "missing installer" screen
  record(request, platform, version, false)
  return NextResponse.redirect('https://github.com/CodeLawd/kairo-presenter/releases')
}

/**
 * Counts the download for the admin console, after the redirect has gone out
 * so the visitor never waits on it. Off unless DOWNLOAD_INGEST_KEY is set;
 * a failure here is logged and never affects the download.
 */
function record(request: NextRequest, platform: string, version: string, served: boolean): void {
  const key = process.env.DOWNLOAD_INGEST_KEY
  if (!key || request.nextUrl.searchParams.get('retry') === '1') return
  const source = request.nextUrl.searchParams.get('source')
  const country = request.headers.get('x-vercel-ip-country')
  after(async () => {
    try {
      await fetch(`${apiTarget()}/v1/downloads/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Ingest-Key': key },
        body: JSON.stringify({
          platform,
          version: version || undefined,
          source: source && /^[a-z0-9-]{1,32}$/.test(source) ? source : 'direct',
          country: country && /^[A-Z]{2}$/.test(country) ? country : undefined,
          served,
        }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (error) {
      console.warn('[download] could not record event:', (error as Error).message)
    }
  })
}
