/** User-facing product name. Internal ids (stores, APIs, folders) stay stable. */
export const PRODUCT_NAME = 'Kairo'
export const PRODUCT_TAGLINE = 'Scripture  |  Lyrics  |  Presentation'

/** The palette: ink is primary, paper the white, stone muted, CTA blue marks live. */
export const BRAND = {
  primary: '#0C111D',
  white: '#F9FAFB',
  muted: '#374151',
  live: '#315EDE',
} as const

/** Stable NDI sender identity for existing receivers. */
export const NDI_SENDER_NAME = `${PRODUCT_NAME} Scripture`
