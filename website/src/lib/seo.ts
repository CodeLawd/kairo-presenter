/** Set SITE_URL to the preferred production origin, including https://. */
const configuredUrl = process.env.SITE_URL || process.env.PUBLIC_WEB_URL || 'https://kairopresenter.com'

export const siteUrl = new URL(configuredUrl).origin
export const isIndexable = process.env.SITE_INDEXING !== 'false' &&
  process.env.NODE_ENV !== 'development' &&
  new URL(siteUrl).protocol === 'https:' &&
  (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production')
export const siteName = 'Kairo Presenter'
export const siteTitle = 'Kairo Presenter — Church Presentation & Service Planning'
export const siteDescription =
  'Plan church services, present lyrics, Scripture, slides and media, manage stage and NDI screens, and create sermon recaps with Kairo Presenter.'
export const socialImage = {
  url: '/brand/kairo-og.jpg',
  width: 1200,
  height: 670,
  alt: 'Kairo Presenter church presentation software — Run the service. Keep up with the message.',
}
