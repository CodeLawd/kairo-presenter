/// <reference types="vite/client" />

import type { KairoAPI } from "@shared/ipc";

export {};

declare global {
  /** package.json version, baked in at build time. */
  const __APP_VERSION__: string

  interface Window {
    /** Exposed by preload via contextBridge. Full typed IPC bridge. */
    api: KairoAPI;
    /** @electron-toolkit/preload utilities (openExternal, etc.) */
    electron: import("@electron-toolkit/preload").ElectronAPI;
  }
}
