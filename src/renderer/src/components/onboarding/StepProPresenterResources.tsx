import ResourceCatalogue from '@/components/propresenter/ResourceCatalogue'
import StepShell from './StepShell'

/**
 * Resource selection is deliberately optional. It is useful when the operator
 * already has a prepared ProPresenter workspace, but a failed discovery must
 * never prevent the rest of setup from completing.
 */
export default function StepProPresenterResources(): React.ReactElement {
  return (
    <StepShell
      title="Use existing ProPresenter resources"
      blurb="Choose resources Kairo may reuse for scripture, lower-thirds, looks, or video input. Nothing in ProPresenter was changed."
    >
      <ResourceCatalogue mode="onboarding" />
    </StepShell>
  )
}
