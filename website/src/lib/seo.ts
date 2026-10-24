/** Set SITE_URL to the preferred production origin, including https://. */
const configuredUrl = process.env.SITE_URL || process.env.PUBLIC_WEB_URL || 'https://kairopresenter.com'

export const siteUrl = new URL(configuredUrl).origin
export const isIndexable = process.env.SITE_INDEXING !== 'false' &&
  process.env.NODE_ENV !== 'development' &&
  new URL(siteUrl).protocol === 'https:' &&
  (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production')
export const siteTitle = 'Kairo — Church Presentation Software for Lyrics & Scripture'
export const siteDescription =
  'Run church lyrics, Bible verses, slides and media with Kairo. Present on projectors, stage displays and NDI feeds, and find Scripture during live sermons.'
export const socialImage = {
  url: '/brand/kairo-og.jpg',
  width: 1200,
  height: 670,
  alt: 'Kairo church presentation software — Run the service. Keep up with the message.',
}
