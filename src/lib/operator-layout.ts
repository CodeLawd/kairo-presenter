export type OperatorPanelSide = "left" | "right";

/**
 * Startup widths. The live rail opens at its max so the booth preview is
 * readable; the operator can drag it narrower. Transcript gets a bit more
 * room than the old 240px default.
 */
export const OPERATOR_PANEL_DEFAULTS: Record<OperatorPanelSide, number> = {
  left: 280,
  right: 460,
};

export const OPERATOR_PANEL_BOUNDS: Record<
  OperatorPanelSide,
  { min: number; max: number }
> = {
  left: { min: 180, max: 420 },
  right: { min: 280, max: 460 },
};

/** Previous defaults — treated as unset so the new startup sizes land once. */
const LEGACY_DEFAULTS: Record<OperatorPanelSide, number> = {
  left: 240,
  right: 320,
};

export function resizeOperatorPanel(
  side: OperatorPanelSide,
  startWidth: number,
  pointerDeltaX: number,
): number {
  const direction = side === "left" ? 1 : -1;
  const requestedWidth = startWidth + pointerDeltaX * direction;
  const { min, max } = OPERATOR_PANEL_BOUNDS[side];
  return Math.min(max, Math.max(min, Math.round(requestedWidth)));
}

export function normalizeOperatorPanelWidth(
  side: OperatorPanelSide,
  storedValue: string | null,
  fallback: number = OPERATOR_PANEL_DEFAULTS[side],
): number {
  if (storedValue === null) return resizeOperatorPanel(side, fallback, 0);
  const parsed = Number(storedValue);
  if (!Number.isFinite(parsed)) return resizeOperatorPanel(side, fallback, 0);
  // Exact legacy default → adopt the new startup size (custom widths stay).
  if (parsed === LEGACY_DEFAULTS[side]) {
    return resizeOperatorPanel(side, OPERATOR_PANEL_DEFAULTS[side], 0);
  }
  return resizeOperatorPanel(side, parsed, 0);
}

/** Bottom reference strip under Detected content (detections + playlist). */
export const OPERATOR_REFERENCE_HEIGHT = {
  default: 200,
  min: 120,
  max: 420,
} as const;

/** Dragging the top edge up increases height (negative deltaY → taller). */
export function resizeOperatorReferenceHeight(
  startHeight: number,
  pointerDeltaY: number,
): number {
  const requested = startHeight - pointerDeltaY;
  return Math.min(
    OPERATOR_REFERENCE_HEIGHT.max,
    Math.max(OPERATOR_REFERENCE_HEIGHT.min, Math.round(requested)),
  );
}

export function normalizeOperatorReferenceHeight(
  storedValue: string | null,
  fallback: number = OPERATOR_REFERENCE_HEIGHT.default,
): number {
  if (storedValue === null) return resizeOperatorReferenceHeight(fallback, 0);
  const parsed = Number(storedValue);
  if (!Number.isFinite(parsed)) return resizeOperatorReferenceHeight(fallback, 0);
  return resizeOperatorReferenceHeight(parsed, 0);
}
