import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

/** Shared cloud helpers live in the desktop workspace, so Turbopack must include it. */
const projectRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    const privateRoutes = ['/api/:path*', '/v1/:path*', '/dashboard/:path*', '/admin/:path*', '/s/:path*', '/download/:path*', '/activate', '/login', '/signup', '/onboarding', '/verify-email', '/reset-password']
    return privateRoutes.map((source) => ({
      source,
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }))
  },
  // OpenNext detects the website's own lockfile as its deployment root.
  // Webpack bundles shared contract imports; development Turbopack still needs the repo root.
  turbopack: { root: process.env.NEXT_PRIVATE_STANDALONE === 'true' ? projectRoot : dirname(projectRoot) },
  /**
   * `takumi-pdf` is a WebAssembly renderer used only by the recap PDF route.
   * Bundling it breaks: its export map offers a `module` condition pointing at
   * a Vite-specific entry, which Turbopack matches before `node`, and that
   * entry imports the `.wasm` with a `?url` suffix only Vite understands.
   * Leaving it external lets Node resolve it at runtime, where the `node`
   * condition wins and the WASM is read from disk.
   */
  serverExternalPackages: ['takumi-pdf', '@takumi-rs/helpers'],
}

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}

export default nextConfig
