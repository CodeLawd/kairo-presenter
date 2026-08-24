import type { AppSettings } from "./ipc";

export type ScriptureDispatchMechanism = "ndi" | "library" | "message";

export function getOverlayDispatchOrder(
  mode: AppSettings["overlay"]["mode"],
): ScriptureDispatchMechanism[] {
  if (mode === "ndi") return ["ndi", "message"];
  if (mode === "message") return ["library", "message"];
  return ["ndi", "library", "message"];
}
