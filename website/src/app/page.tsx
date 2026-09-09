import { Faq } from '@/components/landing/Faq'
import { GetKairo } from '@/components/landing/GetKairo'
import { Hero } from '@/components/landing/Hero'
import { Privacy } from '@/components/landing/Privacy'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteHeader } from '@/components/landing/SiteHeader'
import {
  Audience,
  Features,
  FeaturesDivider,
  Output,
  Problem,
} from '@/components/landing/sections'

/**
 * Server component. Only the header's scroll listener and the scroll-reveal
 * observer ship as client JavaScript; everything else — the copy, the icons,
 * the FAQ accordion — is rendered on the server.
 */
export default function HomePage(): React.ReactElement {
  return (
    <div className="overflow-x-clip">
      <SiteHeader />
      <main id="top">
        <Hero />
        <Problem />
        <Audience />
        <FeaturesDivider />
        <Features />
        <Output />
        <Privacy />
        <GetKairo />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  )
}
