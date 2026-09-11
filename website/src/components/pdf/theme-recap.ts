import { professionalTheme } from "./theme-professional";
import type { PdfcnTheme } from "./theme-types";

/**
 * Compact recap preset, derived from the professional theme.
 *
 * The professional defaults are built for multi-page reports — section gaps
 * of 28pt and h2 top margins to match. A sermon recap is a single dense
 * document: the same values leave bands of empty paper between every block.
 * This keeps the professional palette, switches the serif headings to the
 * same sans family as the body, and only tightens the vertical rhythm, so
 * the preview and the downloaded PDF stay identical.
 *
 * "Inter" is registered with the PDF renderer in the PDF route and loaded
 * on the page in the root layout; Helvetica/Arial carry it if either side
 * ever fails to load the webfont.
 */
const SANS = 'Inter, Helvetica, Arial, sans-serif'

export const recapTheme: PdfcnTheme = {
  ...professionalTheme,
  name: 'recap',
  spacing: {
    ...professionalTheme.spacing,
    componentGap: 8,
    paragraphGap: 6,
    sectionGap: 16,
  },
  typography: {
    body: {
      ...professionalTheme.typography.body,
      fontFamily: SANS,
      fontSize: 10.5,
      lineHeight: 1.55,
    },
    heading: {
      ...professionalTheme.typography.heading,
      fontFamily: SANS,
      fontWeight: 600,
      lineHeight: 1.2,
      fontSize: {
        ...professionalTheme.typography.heading.fontSize,
        h1: 18,
        h2: 12.5,
        h3: 11,
      },
    },
  },
}
