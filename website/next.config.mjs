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

export default nextConfig
