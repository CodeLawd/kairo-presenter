import { DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import type { OverlayElementKind } from '@shared/ipc'
import { OVERLAY_SHAPE_GROUPS } from '@shared/overlay-shapes'

/** What a gallery tile adds: a catalog shape, or one of the box-drawn kinds. */
export interface ShapePick {
  kind: Extract<OverlayElementKind, 'rectangle' | 'ellipse' | 'shape'>
  shape?: string
  radiusPx?: number
}

interface Tile {
  key: string
  label: string
  path: string
  lineOnly?: boolean
  pick: ShapePick
}

/** Rectangle and ellipse draw from their box (radius, inset border), so they lead their groups as their own kinds. */
const BOX_TILES: Record<string, Tile[]> = {
  Rectangles: [
    { key: 'rectangle', label: 'Rectangle', path: 'M0 0 H100 V100 H0 Z', pick: { kind: 'rectangle' } },
    {
      key: 'rounded-rectangle',
      label: 'Rounded rectangle',
      path: 'M15 0 H85 A15 15 0 0 1 100 15 V85 A15 15 0 0 1 85 100 H15 A15 15 0 0 1 0 85 V15 A15 15 0 0 1 15 0 Z',
      pick: { kind: 'rectangle', radiusPx: 48 },
    },
  ],
  'Basic shapes': [
    { key: 'ellipse', label: 'Ellipse', path: 'M0 50 A50 50 0 1 0 100 50 A50 50 0 1 0 0 50 Z', pick: { kind: 'ellipse' } },
  ],
}

export function ShapeThumb({ path, lineOnly }: { path: string; lineOnly?: boolean }): React.ReactElement {
  return (
    <svg viewBox="-6 -6 112 112" className="size-[18px]" aria-hidden="true">
      <path
        d={path}
        fill={lineOnly ? 'none' : 'currentColor'}
        fillOpacity={lineOnly ? undefined : 0.18}
        fillRule="evenodd"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/**
 * The shape catalog as grouped tiles, for a DropdownMenuContent — the Add menu
 * and the element panel's "Change shape" both use it. Arrow keys move between tiles.
 */
export function ShapeMenuItems({
  onPick,
  includeBoxShapes = true,
}: {
  onPick: (pick: ShapePick) => void
  /** Off where a box-drawn kind can't be swapped in (changing a catalog shape's outline). */
  includeBoxShapes?: boolean
}): React.ReactElement {
  return (
    <>
      {OVERLAY_SHAPE_GROUPS.map((group) => {
        const tiles: Tile[] = [
          ...(includeBoxShapes ? BOX_TILES[group.label] ?? [] : []),
          ...group.shapes.map((shape) => ({
            key: shape.id,
            label: shape.label,
            path: shape.path,
            lineOnly: shape.lineOnly,
            pick: { kind: 'shape' as const, shape: shape.id },
          })),
        ]
        return (
          <div key={group.label}>
            <DropdownMenuLabel className="px-1 pb-1 pt-2 text-[11px] font-medium text-slate-500">{group.label}</DropdownMenuLabel>
            <div className="grid grid-cols-9 gap-0.5">
              {tiles.map((tile) => (
                <DropdownMenuItem
                  key={tile.key}
                  aria-label={tile.label}
                  title={tile.label}
                  onSelect={() => onPick(tile.pick)}
                  className="grid size-8 place-items-center p-0 text-slate-300 focus:text-white"
                >
                  <ShapeThumb path={tile.path} lineOnly={tile.lineOnly} />
                </DropdownMenuItem>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
