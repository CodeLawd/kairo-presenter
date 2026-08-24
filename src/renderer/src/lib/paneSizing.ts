export function clampPaneWidth(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function maxPaneWidthForViewport(
  viewportWidth: number,
  otherPaneWidth: number,
  previewMinimum: number,
  configuredMaximum: number,
): number {
  return Math.min(configuredMaximum, viewportWidth - otherPaneWidth - previewMinimum)
}

export function scaleToFit(containerWidth: number, sourceWidth: number): number {
  if (containerWidth <= 0 || sourceWidth <= 0) return 0
  return containerWidth / sourceWidth
}
