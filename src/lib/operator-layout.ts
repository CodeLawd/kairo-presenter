export type OperatorPanelSide = "left" | "right";

const PANEL_BOUNDS: Record<OperatorPanelSide, { min: number; max: number }> = {
  left: { min: 180, max: 420 },
  right: { min: 280, max: 460 },
};

export function resizeOperatorPanel(
  side: OperatorPanelSide,
  startWidth: number,
  pointerDeltaX: number,
): number {
  const direction = side === "left" ? 1 : -1;
  const requestedWidth = startWidth + pointerDeltaX * direction;
  const { min, max } = PANEL_BOUNDS[side];
  return Math.min(max, Math.max(min, Math.round(requestedWidth)));
}

export function normalizeOperatorPanelWidth(
  side: OperatorPanelSide,
  storedValue: string | null,
  fallback: number,
): number {
  const parsed = storedValue === null ? Number.NaN : Number(storedValue);
  if (!Number.isFinite(parsed)) return fallback;
  return resizeOperatorPanel(side, parsed, 0);
}
