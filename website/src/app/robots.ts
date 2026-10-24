import type { MetadataRoute } from 'next'
import { isIndexable, siteUrl } from '@/lib/seo'

export default function robots(): MetadataRoute.Robots {
  return {
    // Leave HTML crawlable so crawlers can see its noindex directives.
    rules: { userAgent: '*', ...(isIndexable
      ? { allow: '/', disallow: ['/api/', '/v1/'] }
      : { disallow: '/' }) },
    ...(isIndexable ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  }
}
