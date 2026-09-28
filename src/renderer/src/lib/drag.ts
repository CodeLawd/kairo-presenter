/**
 * Small pieces that make drag and drop feel native.
 *
 * The browser's defaults are what made dropping onto the sidebar feel rough:
 * the ghost is a translucent screenshot of the whole row, and `dragleave`
 * fires every time the pointer crosses a child of the target, so highlights
 * flicker. These helpers replace both.
 */

/**
 * A compact "♪ Title" pill as the drag image, instead of a screenshot of the
 * row. Built off-screen, handed to the browser, then removed.
 */
export function setDragPreview(event: React.DragEvent, label: string, glyph = '♪'): void {
  const pill = document.createElement('div')
  pill.textContent = `${glyph}  ${label}`
  Object.assign(pill.style, {
    position: 'fixed',
    top: '-1000px',
    left: '-1000px',
    maxWidth: '260px',
    padding: '6px 12px',
    borderRadius: '0',
    background: '#2c2c2e',
    border: '1px solid rgba(255,255,255,0.14)',
    color: '#f4f4f5',
    font: '600 12px -apple-system, BlinkMacSystemFont, "Source Sans 3", sans-serif',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    pointerEvents: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  document.body.appendChild(pill)
  event.dataTransfer.setDragImage(pill, 14, 14)
  // The image is captured synchronously; the element is not needed after.
  requestAnimationFrame(() => pill.remove())
}

/**
 * True when a `dragleave` is really leaving the target, not just moving onto
 * one of its children (an icon, the name, the count).
 */
export function leavesTarget(event: React.DragEvent): boolean {
  const next = event.relatedTarget as Node | null
  return !next || !event.currentTarget.contains(next)
}
