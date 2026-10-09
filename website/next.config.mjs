import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

/** Shared cloud helpers live in the desktop workspace, so Turbopack must include it. */
const projectRoot = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  turbopack: { root: dirname(projectRoot) },
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
