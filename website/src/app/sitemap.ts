import type { MetadataRoute } from 'next'
import { isIndexable, siteUrl } from '@/lib/seo'

export default function sitemap(): MetadataRoute.Sitemap {
  // Downloads are utility pages; auth, dashboards and token recaps are noindex.
  // Add future public pages here together with their canonical metadata.
  return isIndexable ? [{ url: `${siteUrl}/` }] : []
}
