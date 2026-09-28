import { NextRequest, NextResponse } from 'next/server'

type ReleaseAsset = { name: string; browser_download_url: string }
type GitHubRelease = { assets?: ReleaseAsset[] }

const matches: Record<string, (name: string) => boolean> = {
  'mac-arm64': (name) => /arm64\.dmg$/i.test(name),
  'mac-x64': (name) => /\.dmg$/i.test(name) && !/(arm64|aarch64)/i.test(name),
  'windows-x64': (name) => /\.exe$/i.test(name),
  'linux-x64': (name) => /\.AppImage$/i.test(name),
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ platform: string }> },
): Promise<NextResponse> {
  const { platform } = await context.params
  const match = matches[platform]
  if (!match) return new NextResponse('Unknown platform', { status: 404 })

  try {
    const response = await fetch('https://api.github.com/repos/CodeLawd/kairo-presenter/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Kairo-website' },
      cache: 'no-store',
    })
    if (response.ok) {
      const release = (await response.json()) as GitHubRelease
      const asset = release.assets?.find((item) => match(item.name))
      if (asset && asset.browser_download_url.startsWith('https://github.com/CodeLawd/kairo-presenter/releases/download/')) {
        return NextResponse.redirect(asset.browser_download_url)
      }
    }
  } catch {
    // A missing or unreachable release gets the same useful fallback page.
  }

  return NextResponse.redirect(new URL(`/download?platform=${encodeURIComponent(platform)}`, request.url))
}
