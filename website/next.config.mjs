import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/**
 * The desktop app lives one directory up and ships its own Tailwind v3
 * `postcss.config.js`. Without pinning the root, Turbopack walks up to the
 * parent repo, finds that config, and tries to build this site's CSS with it.
 */
const projectRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: projectRoot },
}

export default nextConfig
