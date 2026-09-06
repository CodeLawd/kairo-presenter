/// <reference types="vite/client" />

/**
 * Build-time configuration for the main process.
 *
 * Everything here is INLINED INTO THE BUNDLE, so it is public by definition —
 * URLs and feature flags only, never a credential.
 */
interface ImportMetaEnv {
  /** ProAutomate API base URL, e.g. https://api.proautomate.app */
  readonly MAIN_VITE_API_URL?: string
  /** Web app base URL, for links opened in the system browser. */
  readonly MAIN_VITE_WEB_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
