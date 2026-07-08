/// <reference types="vite/client" />

import type { ProAutomateAPI } from "@shared/ipc";

export {};

declare global {
  interface Window {
    /** Exposed by preload via contextBridge. Full typed IPC bridge. */
    api: ProAutomateAPI;
    /** @electron-toolkit/preload utilities (openExternal, etc.) */
    electron: import("@electron-toolkit/preload").ElectronAPI;
  }
}
