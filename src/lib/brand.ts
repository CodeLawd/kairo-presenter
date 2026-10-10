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

/** NDI sender shown in ProPresenter’s video-input list. */
export const NDI_SENDER_NAME = `${PRODUCT_NAME} Scripture`

/** Message template created in ProPresenter. Older installs used ProAutomate. */
export const PP_MESSAGE_NAME = `${PRODUCT_NAME} Scripture`
export const PP_MESSAGE_NAMES = [PP_MESSAGE_NAME, 'ProAutomate Scripture'] as const

export function isOwnedNdiName(name: string): boolean {
  return /kairo|proautomate/i.test(name)
}
