export interface DetectorRecoveryState {
  consecutiveErrors: number;
  fallbackActive: boolean;
  probing: boolean;
}

export type DetectorRecoveryEvent =
  | "request_failed"
  | "begin_probe"
  | "request_succeeded";

export function transitionDetectorRecovery(
  state: DetectorRecoveryState,
  event: DetectorRecoveryEvent,
): DetectorRecoveryState {
  if (event === "request_succeeded") {
    return { consecutiveErrors: 0, fallbackActive: false, probing: false };
  }
  if (event === "begin_probe") {
    return { ...state, fallbackActive: false, probing: true };
  }
  const consecutiveErrors = state.consecutiveErrors + 1;
  return {
    consecutiveErrors,
    fallbackActive: consecutiveErrors >= 2,
    probing: false,
  };
}
