import { Composition } from 'remotion'
import { HeroV2, HERO_V2_SECONDS } from './v2/hero/HeroV2'
import { OperatorTest } from './v2/OperatorTest'
import { SocialV2, SOCIAL_V2_SECONDS } from './v2/social/SocialV2'
import { WalkthroughV2, WALKTHROUGH_V2_SECONDS } from './v2/walk/WalkthroughV2'

const FPS = 60

export function Root(): React.ReactElement {
  return (
    <>
      <Composition id="Hero" component={HeroV2} durationInFrames={HERO_V2_SECONDS * FPS} fps={FPS} width={3840} height={2160} />
      <Composition id="Hero1080" component={HeroV2} durationInFrames={HERO_V2_SECONDS * FPS} fps={FPS} width={1920} height={1080} />
      <Composition id="Walkthrough" component={WalkthroughV2} durationInFrames={Math.round(WALKTHROUGH_V2_SECONDS * FPS)} fps={FPS} width={1920} height={1080} />
      <Composition id="Social" component={SocialV2} durationInFrames={Math.round(SOCIAL_V2_SECONDS * FPS)} fps={FPS} width={1080} height={1920} />
      {/* Fidelity check: the Operator rebuild in the captured live state. */}
      <Composition id="OperatorTest" component={OperatorTest} durationInFrames={1} fps={FPS} width={1600} height={960} />
    </>
  )
}
