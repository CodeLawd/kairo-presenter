import type { ReactNode } from 'react'
import type { Style } from '@/lib/pdf-primitives'

/**
 * The props every pdfcn component accepts.
 *
 * Hand-written rather than installed: pdfcn ships this as `registry/types/
 * pdf-components.ts`, which is pulled in as a file of other registry items
 * rather than published as an item of its own, so the shadcn CLI has no way to
 * fetch it. The shape is fixed by how every installed component uses it —
 * each one destructures `children` and spreads `style` onto its style array.
 */
export interface PDFComponentProps {
  children?: ReactNode
  style?: Style | Style[]
}
