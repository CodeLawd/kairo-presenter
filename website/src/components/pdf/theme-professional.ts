import { defaultPrimitives } from "./primitives";
import type { PdfcnTheme } from "./theme-types";

/**
 * Professional theme preset.
 *
 * Character: Serif headings (Times-Roman), refined zinc/slate palette,
 * generous margins, formal document feel. shadcn-inspired minimal aesthetic.
 * Ideal for business documents, reports, and official correspondence.
 */
export const professionalTheme: PdfcnTheme = {
  colors: {
    accent: "#3b82f6",
    background: "#FFFBF4",
    border: "#E7E4DC",
    destructive: "#dc2626",
    foreground: "#181913",
    info: "#0ea5e9",
    muted: "#F7F3EC",
    mutedForeground: "#747267",
    primary: "#181913",
    primaryForeground: "#FFFBF4",
    success: "#16a34a",
    warning: "#4F6888",
  },
  name: "professional",
  page: {
    orientation: "portrait",
    size: "A4",
  },
  primitives: defaultPrimitives,
  spacing: {
    componentGap: 14,
    page: {
      marginBottom: 56,
      marginLeft: 48,
      marginRight: 48,
      marginTop: 56,
    },
    paragraphGap: 10,
    sectionGap: 28,
  },
  typography: {
    body: {
      fontFamily: "Helvetica",
      fontSize: 11,
      lineHeight: 1.6,
    },
    heading: {
      fontFamily: "Times-Roman",
      fontSize: {
        h1: 32,
        h2: 24,
        h3: 20,
        h4: 16,
        h5: 14,
        h6: 12,
      },
      fontWeight: 700,
      lineHeight: 1.25,
    },
  },
};
