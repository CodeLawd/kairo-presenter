import { Faq } from '@/components/landing/Faq'
import { GetKairo } from '@/components/landing/GetKairo'
import { Hero } from '@/components/landing/Hero'
import { Privacy } from '@/components/landing/Privacy'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { SiteHeader } from '@/components/landing/SiteHeader'
import { HowItWorks } from '@/components/landing/HowItWorks'
import { Features } from '@/components/landing/Features'
import { MoreFeatures } from '@/components/landing/sections'

/**
 * Server component. Only the header's scroll listener and the scroll-reveal
 * observer ship as client JavaScript; everything else — the copy, the FAQ
 * accordion — is rendered on the server.
 *
 * The hero backdrop is mounted here rather than inside `Hero` so it can pass
 * behind the sticky header in one piece. It cannot be wrapped around the header
 * and hero together: a sticky element only sticks within its own containing
 * block, so that wrapper would drop the header at the end of the hero.
 */
export default function HomePage(): React.ReactElement {
  return (
    <div className="relative overflow-x-clip">
      <div
        className="field pointer-events-none absolute inset-x-[-10%] top-0 z-0 h-[clamp(640px,88svh,940px)]"
        aria-hidden="true"
      />
      <div
        className="grain pointer-events-none absolute inset-x-0 top-0 z-0 h-[clamp(640px,88svh,940px)]"
        aria-hidden="true"
      />

      <SiteHeader />
      <main id="top">
        <Hero />
        <HowItWorks />
        <Features />
        <MoreFeatures />
        <Privacy />
        <GetKairo />
        <Faq />
      </main>
      <SiteFooter />
    </div>
  )
}
