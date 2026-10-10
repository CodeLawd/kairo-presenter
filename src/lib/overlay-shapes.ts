// ─── Shape catalog ──────────────────────────────────────────────────────────────
// Every preset shape is one SVG path in a 100×100 box. The renderer stretches it
// to the element's box (preserveAspectRatio="none"), the way Office shapes
// stretch, and the Add menu draws its thumbnails from the same paths.
// Pure data — shared by the overlay template and the Theme editor.

export interface OverlayShapeDef {
  id: string
  label: string
  path: string
  /** Lines and connectors: drawn with the border only, never filled. */
  lineOnly?: boolean
}

export interface OverlayShapeGroup {
  label: string
  shapes: OverlayShapeDef[]
}

const r = (n: number): number => Math.round(n * 100) / 100

/** A regular polygon, first corner straight up. */
function polygon(sides: number): string {
  const points = Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides
    return `${r(50 + 50 * Math.cos(a))} ${r(50 + 50 * Math.sin(a))}`
  })
  return `M${points.join(' L')} Z`
}

/** A star with `points` tips; `inner` is the valley radius as a share of the tip radius. */
function star(points: number, inner: number): string {
  const corners = Array.from({ length: points * 2 }, (_, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / points
    const radius = i % 2 === 0 ? 50 : 50 * inner
    return `${r(50 + radius * Math.cos(a))} ${r(50 + radius * Math.sin(a))}`
  })
  return `M${corners.join(' L')} Z`
}

/** A disc with separate triangular rays — separate pieces, so even-odd fill keeps them all solid. */
function sun(rays: number): string {
  const disc = 'M24 50 A26 26 0 1 0 76 50 A26 26 0 1 0 24 50 Z'
  const spikes = Array.from({ length: rays }, (_, i) => {
    const a = (i * 2 * Math.PI) / rays
    const half = Math.PI / rays / 1.8
    const p = (angle: number, radius: number): string =>
      `${r(50 + radius * Math.sin(angle))} ${r(50 - radius * Math.cos(angle))}`
    return `M${p(a - half, 32)} L${p(a, 50)} L${p(a + half, 32)} Z`
  })
  return [disc, ...spikes].join(' ')
}

/** A ring with a diagonal bar: the two openings are holes in the disc. */
function noSymbol(): string {
  const R = 34
  const d = 7
  const s2 = Math.SQRT1_2
  const along = Math.sqrt(R * R - d * d)
  const piece = (side: 1 | -1): string => {
    // Normal to the bar (up-right for side 1), and the bar's direction.
    const nx = s2 * side
    const ny = -s2 * side
    const ax = 50 + d * nx - along * s2
    const ay = 50 + d * ny - along * s2
    const bx = 50 + d * nx + along * s2
    const by = 50 + d * ny + along * s2
    return `M${r(ax)} ${r(ay)} L${r(bx)} ${r(by)} A${R} ${R} 0 0 ${side === 1 ? 0 : 1} ${r(ax)} ${r(ay)} Z`
  }
  return `M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z ${piece(1)} ${piece(-1)}`
}

export const OVERLAY_SHAPE_GROUPS: OverlayShapeGroup[] = [
  {
    label: 'Lines',
    shapes: [
      { id: 'line', label: 'Line', path: 'M0 50 H100', lineOnly: true },
      { id: 'line-diagonal', label: 'Diagonal line', path: 'M0 0 L100 100', lineOnly: true },
      { id: 'line-arrow', label: 'Arrow', path: 'M0 50 H100 M86 36 L100 50 L86 64', lineOnly: true },
      { id: 'line-double-arrow', label: 'Double arrow', path: 'M0 50 H100 M14 36 L0 50 L14 64 M86 36 L100 50 L86 64', lineOnly: true },
      { id: 'line-elbow', label: 'Elbow', path: 'M0 0 H50 V100 H100', lineOnly: true },
      { id: 'line-curve', label: 'Curve', path: 'M0 100 C30 100 70 0 100 0', lineOnly: true },
      { id: 'line-wave', label: 'Wavy line', path: 'M0 50 C12.5 0 37.5 0 50 50 C62.5 100 87.5 100 100 50', lineOnly: true },
    ],
  },
  {
    label: 'Rectangles',
    shapes: [
      { id: 'snip-corner', label: 'Snipped corner', path: 'M0 0 H80 L100 20 V100 H0 Z' },
      { id: 'snip-corners', label: 'Snipped corners', path: 'M20 0 H80 L100 20 V100 H0 V20 Z' },
      { id: 'snip-diagonal', label: 'Snipped diagonal', path: 'M0 0 H80 L100 20 V100 H20 L0 80 Z' },
      { id: 'round-top', label: 'Round top', path: 'M0 100 V30 C0 10 10 0 30 0 H70 C90 0 100 10 100 30 V100 Z' },
      { id: 'frame', label: 'Frame', path: 'M0 0 H100 V100 H0 Z M12 12 V88 H88 V12 Z' },
      { id: 'half-frame', label: 'Corner', path: 'M0 0 H100 L82 18 H18 V82 L0 100 Z' },
      { id: 'l-shape', label: 'L-shape', path: 'M0 0 H30 V70 H100 V100 H0 Z' },
    ],
  },
  {
    label: 'Basic shapes',
    shapes: [
      { id: 'triangle', label: 'Triangle', path: 'M50 0 L100 100 L0 100 Z' },
      { id: 'right-triangle', label: 'Right triangle', path: 'M0 0 L100 100 L0 100 Z' },
      { id: 'parallelogram', label: 'Parallelogram', path: 'M25 0 H100 L75 100 H0 Z' },
      { id: 'trapezoid', label: 'Trapezoid', path: 'M20 0 H80 L100 100 H0 Z' },
      { id: 'diamond', label: 'Diamond', path: 'M50 0 L100 50 L50 100 L0 50 Z' },
      { id: 'pentagon', label: 'Pentagon', path: polygon(5) },
      { id: 'hexagon', label: 'Hexagon', path: 'M25 0 H75 L100 50 L75 100 H25 L0 50 Z' },
      { id: 'heptagon', label: 'Heptagon', path: polygon(7) },
      { id: 'octagon', label: 'Octagon', path: 'M30 0 H70 L100 30 V70 L70 100 H30 L0 70 V30 Z' },
      { id: 'decagon', label: 'Decagon', path: polygon(10) },
      { id: 'dodecagon', label: 'Dodecagon', path: polygon(12) },
      { id: 'donut', label: 'Donut', path: 'M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z M25 50 A25 25 0 1 1 75 50 A25 25 0 1 1 25 50 Z' },
      { id: 'pie', label: 'Pie', path: 'M50 50 V0 A50 50 0 1 1 0 50 Z' },
      { id: 'chord', label: 'Half circle', path: 'M0 50 A50 50 0 0 1 100 50 Z' },
      { id: 'arch', label: 'Arch', path: 'M0 100 V50 A50 50 0 0 1 100 50 V100 H78 V50 A28 28 0 0 0 22 50 V100 Z' },
      { id: 'teardrop', label: 'Teardrop', path: 'M50 0 H100 V50 A50 50 0 1 1 50 0 Z' },
      { id: 'cylinder', label: 'Cylinder', path: 'M0 15 A50 15 0 0 1 100 15 V85 A50 15 0 0 1 0 85 Z' },
      { id: 'cube', label: 'Cube', path: 'M0 25 L25 0 H100 V75 L75 100 H0 Z' },
      { id: 'plaque', label: 'Plaque', path: 'M15 0 H85 A15 15 0 0 0 100 15 V85 A15 15 0 0 0 85 100 H15 A15 15 0 0 0 0 85 V15 A15 15 0 0 0 15 0 Z' },
      { id: 'heart', label: 'Heart', path: 'M50 95 C20 72 0 54 0 30 C0 13 13 2 28 2 C39 2 46 8 50 17 C54 8 61 2 72 2 C87 2 100 13 100 30 C100 54 80 72 50 95 Z' },
      { id: 'lightning', label: 'Lightning', path: 'M38 0 H78 L56 38 H82 L22 100 L40 56 H18 Z' },
      { id: 'sun', label: 'Sun', path: sun(10) },
      { id: 'moon', label: 'Moon', path: 'M75 4 A48 48 0 1 0 75 96 A40 46 0 1 1 75 4 Z' },
      { id: 'cloud', label: 'Cloud', path: 'M24 88 C8 88 0 78 0 66 C0 54 9 46 20 46 C20 30 32 20 46 20 C56 20 64 25 68 33 C72 30 77 28 82 28 C93 28 100 37 100 48 C100 50 100 52 99 54 C100 58 100 61 100 64 C100 77 91 88 78 88 Z' },
      { id: 'smiley', label: 'Smiley', path: 'M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z M30 35 A6 6 0 1 0 42 35 A6 6 0 1 0 30 35 Z M58 35 A6 6 0 1 0 70 35 A6 6 0 1 0 58 35 Z M26 60 Q50 84 74 60 Q50 74 26 60 Z' },
      { id: 'no-symbol', label: 'No symbol', path: noSymbol() },
      { id: 'brackets', label: 'Brackets', path: 'M20 0 H35 V8 H28 V92 H35 V100 H20 Z M80 0 H65 V8 H72 V92 H65 V100 H80 Z' },
    ],
  },
  {
    label: 'Block arrows',
    shapes: [
      { id: 'arrow-right', label: 'Right arrow', path: 'M0 30 H60 V5 L100 50 L60 95 V70 H0 Z' },
      { id: 'arrow-left', label: 'Left arrow', path: 'M100 30 H40 V5 L0 50 L40 95 V70 H100 Z' },
      { id: 'arrow-up', label: 'Up arrow', path: 'M30 100 V40 H5 L50 0 L95 40 H70 V100 Z' },
      { id: 'arrow-down', label: 'Down arrow', path: 'M30 0 V60 H5 L50 100 L95 60 H70 V0 Z' },
      { id: 'arrow-left-right', label: 'Left-right arrow', path: 'M0 50 L25 10 V30 H75 V10 L100 50 L75 90 V70 H25 V90 Z' },
      { id: 'arrow-up-down', label: 'Up-down arrow', path: 'M50 0 L90 25 H70 V75 H90 L50 100 L10 75 H30 V25 H10 Z' },
      { id: 'arrow-quad', label: 'Four-way arrow', path: 'M50 0 L68 18 H58 V42 H82 V32 L100 50 L82 68 V58 H58 V82 H68 L50 100 L32 82 H42 V58 H18 V68 L0 50 L18 32 V42 H42 V18 H32 Z' },
      { id: 'arrow-notched', label: 'Notched arrow', path: 'M0 30 H60 V5 L100 50 L60 95 V70 H0 L12 50 Z' },
      { id: 'arrow-striped', label: 'Striped arrow', path: 'M0 30 H6 V70 H0 Z M12 30 H18 V70 H12 Z M24 30 H60 V5 L100 50 L60 95 V70 H24 Z' },
      { id: 'arrow-bent', label: 'Bent arrow', path: 'M0 100 V45 C0 30 10 20 25 20 H65 V0 L100 32 L65 64 V44 H30 C27 44 25 46 25 49 V100 Z' },
      { id: 'arrow-u-turn', label: 'U-turn arrow', path: 'M0 100 V40 A40 40 0 0 1 80 40 V55 H100 L70 90 L40 55 H58 V40 A18 18 0 0 0 22 40 V100 Z' },
      { id: 'pentagon-arrow', label: 'Pentagon', path: 'M0 0 H75 L100 50 L75 100 H0 Z' },
      { id: 'chevron', label: 'Chevron', path: 'M0 0 H75 L100 50 L75 100 H0 L25 50 Z' },
      { id: 'chevron-left', label: 'Left chevron', path: 'M100 0 H25 L0 50 L25 100 H100 L75 50 Z' },
    ],
  },
  {
    label: 'Equation shapes',
    shapes: [
      { id: 'plus', label: 'Plus', path: 'M38 0 H62 V38 H100 V62 H62 V100 H38 V62 H0 V38 H38 Z' },
      { id: 'minus', label: 'Minus', path: 'M0 38 H100 V62 H0 Z' },
      { id: 'multiply', label: 'Multiply', path: 'M17 0 L50 33 L83 0 L100 17 L67 50 L100 83 L83 100 L50 67 L17 100 L0 83 L33 50 L0 17 Z' },
      { id: 'divide', label: 'Divide', path: 'M0 40 H100 V60 H0 Z M38 16 A12 12 0 1 0 62 16 A12 12 0 1 0 38 16 Z M38 84 A12 12 0 1 0 62 84 A12 12 0 1 0 38 84 Z' },
      { id: 'equal', label: 'Equal', path: 'M0 20 H100 V42 H0 Z M0 58 H100 V80 H0 Z' },
    ],
  },
  {
    label: 'Flowchart',
    shapes: [
      { id: 'flow-document', label: 'Document', path: 'M0 0 H100 V84 C75 66 50 100 25 92 C13 88 6 85 0 84 Z' },
      { id: 'flow-terminator', label: 'Terminator', path: 'M25 0 H75 A25 50 0 0 1 75 100 H25 A25 50 0 0 1 25 0 Z' },
      { id: 'flow-delay', label: 'Delay', path: 'M0 0 H50 A50 50 0 0 1 50 100 H0 Z' },
      { id: 'flow-manual-input', label: 'Manual input', path: 'M0 25 L100 0 V100 H0 Z' },
      { id: 'flow-manual-operation', label: 'Manual operation', path: 'M0 0 H100 L80 100 H20 Z' },
      { id: 'flow-off-page', label: 'Off-page', path: 'M0 0 H100 V75 L50 100 L0 75 Z' },
      { id: 'flow-card', label: 'Card', path: 'M20 0 H100 V100 H0 V20 Z' },
      { id: 'flow-preparation', label: 'Preparation', path: 'M20 0 H80 L100 50 L80 100 H20 L0 50 Z' },
      { id: 'flow-merge', label: 'Merge', path: 'M0 0 H100 L50 100 Z' },
      { id: 'flow-collate', label: 'Collate', path: 'M0 0 H100 L0 100 H100 Z' },
    ],
  },
  {
    label: 'Stars and banners',
    shapes: [
      { id: 'star-4', label: '4-point star', path: star(4, 0.38) },
      { id: 'star-5', label: '5-point star', path: star(5, 0.4) },
      { id: 'star-6', label: '6-point star', path: star(6, 0.55) },
      { id: 'star-7', label: '7-point star', path: star(7, 0.6) },
      { id: 'star-8', label: '8-point star', path: star(8, 0.62) },
      { id: 'star-10', label: '10-point star', path: star(10, 0.7) },
      { id: 'star-12', label: '12-point star', path: star(12, 0.75) },
      { id: 'star-16', label: '16-point star', path: star(16, 0.8) },
      { id: 'star-24', label: '24-point star', path: star(24, 0.85) },
      { id: 'star-32', label: '32-point star', path: star(32, 0.88) },
      { id: 'burst', label: 'Explosion', path: 'M50 0 L58 26 L82 8 L74 36 L100 34 L80 52 L98 72 L70 68 L72 98 L52 76 L34 100 L32 72 L4 82 L22 58 L0 42 L26 36 L14 10 L40 24 Z' },
      { id: 'ribbon', label: 'Ribbon', path: 'M0 20 H100 L88 50 L100 80 H0 L12 50 Z' },
      { id: 'banner-wave', label: 'Wave', path: 'M0 15 C25 -5 50 35 75 15 C88 5 95 10 100 15 V85 C75 105 50 65 25 85 C12 95 5 90 0 85 Z' },
      { id: 'banner-double-wave', label: 'Double wave', path: 'M0 15 C17 0 33 30 50 15 C67 0 83 30 100 15 V85 C83 100 67 70 50 85 C33 100 17 70 0 85 Z' },
      { id: 'scroll', label: 'Scroll', path: 'M10 0 H100 V10 C100 15 95 15 90 15 V90 C90 96 86 100 80 100 H0 V90 C0 85 5 85 10 85 Z' },
    ],
  },
  {
    label: 'Callouts',
    shapes: [
      { id: 'callout-rect', label: 'Speech rectangle', path: 'M0 0 H100 V72 H42 L20 100 L26 72 H0 Z' },
      { id: 'callout-round-rect', label: 'Speech rounded', path: 'M12 0 H88 C95 0 100 5 100 12 V60 C100 67 95 72 88 72 H42 L20 100 L26 72 H12 C5 72 0 67 0 60 V12 C0 5 5 0 12 0 Z' },
      { id: 'callout-oval', label: 'Speech oval', path: 'M50 0 C78 0 100 16 100 37 C100 58 78 74 50 74 C44 74 39 73 34 72 L15 98 L20 66 C8 59 0 49 0 37 C0 16 22 0 50 0 Z' },
      { id: 'callout-cloud', label: 'Thought', path: 'M22 70 C8 70 0 62 0 52 C0 43 7 37 15 36 C14 22 25 12 40 12 C47 6 56 4 64 8 C72 4 84 6 90 14 C97 18 100 26 100 34 C100 46 92 56 80 58 C76 66 66 70 56 68 C48 72 34 74 22 70 Z M14 84 A6 6 0 1 0 26 84 A6 6 0 1 0 14 84 Z M4 96 A4 4 0 1 0 12 96 A4 4 0 1 0 4 96 Z' },
    ],
  },
]

const BY_ID = new Map(OVERLAY_SHAPE_GROUPS.flatMap((g) => g.shapes).map((shape) => [shape.id, shape]))

export const OVERLAY_SHAPE_IDS: readonly string[] = [...BY_ID.keys()]

export function overlayShape(id: string | undefined): OverlayShapeDef | null {
  return (id && BY_ID.get(id)) || null
}
