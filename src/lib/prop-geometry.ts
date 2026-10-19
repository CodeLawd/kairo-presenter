// Dragging a prop object on the Props editor stage: pure, so it can be tested.

import type { PropBox } from './program'

/** Smallest an object can be sized to, as a share of the frame. */
export const MIN_PROP_OBJECT_SIZE = 0.02

export type PropCorner = 'nw' | 'ne' | 'sw' | 'se'

export type PropGesture =
  | { kind: 'move'; objectId: string; startX: number; startY: number; origin: PropBox }
  | { kind: 'resize'; objectId: string; corner: PropCorner; startX: number; startY: number; origin: PropBox }

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/**
 * Moves or resizes `gesture.origin` by a pointer delta given as shares of the
 * frame. The object always stays on the frame, and a resize stops at the
 * minimum size rather than turning inside out; the opposite corner holds still.
 */
export function applyPropGesture(gesture: PropGesture, dx: number, dy: number): PropBox {
  const o = gesture.origin
  if (gesture.kind === 'move') {
    return { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) }
  }
  let { x, y, w, h } = o
  if (gesture.corner === 'ne' || gesture.corner === 'se') w = clamp(o.w + dx, MIN_PROP_OBJECT_SIZE, 1 - o.x)
  if (gesture.corner === 'nw' || gesture.corner === 'sw') {
    const right = o.x + o.w
    x = clamp(o.x + dx, 0, right - MIN_PROP_OBJECT_SIZE)
    w = right - x
  }
  if (gesture.corner === 'sw' || gesture.corner === 'se') h = clamp(o.h + dy, MIN_PROP_OBJECT_SIZE, 1 - o.y)
  if (gesture.corner === 'nw' || gesture.corner === 'ne') {
    const bottom = o.y + o.h
    y = clamp(o.y + dy, 0, bottom - MIN_PROP_OBJECT_SIZE)
    h = bottom - y
  }
  return { x, y, w, h }
}
