import type { AppSettings, OverlayOutput, ProPresenterConnectionState } from './ipc'
import { outputRequiresPropresenter, primaryNdiOutputId } from './overlay-outputs'

/**
 * Whether ProPresenter is what takes this output's frame: the primary `ndi`
 * output (the only one that cuts PP to a video input) when it is bound to a
 * PP input — on the output itself or through the resource binding
 * (`propresenterResources.ndiVideoInputId`) the orchestrator prefers. Extra
 * NDI feeds go to livestream / recording receivers, never to PP.
 */
export function ndiRoutedThroughPropresenter(
  output: Pick<OverlayOutput, 'id' | 'kind' | 'ppVideoInputUuid'>,
  outputs: readonly OverlayOutput[],
  ndiVideoInputId = '',
): boolean {
  if (output.kind !== 'ndi' || output.id !== primaryNdiOutputId(outputs)) return false
  return output.ppVideoInputUuid.trim() !== '' || ndiVideoInputId.trim() !== ''
}

/**
 * The ProPresenter integration is switched on (Settings → ProPresenter →
 * Use ProPresenter). Everything ProPresenter-facing — the launch handshake,
 * the header status, PP outputs, PP health — is gated on this. Off means off:
 * no prompts, no "not connected" anywhere.
 */
export function propresenterEnabled(settings: { propresenter?: { enabled?: boolean } | null }): boolean {
  return settings.propresenter?.enabled === true
}

/**
 * Whether this setup needs ProPresenter at all — derived from the outputs, not
 * stored, so it can never drift from what a push actually does. True when an
 * enabled output talks to PP, or the NDI output is bound to a PP video input.
 * Pass the resource binding's `ndiVideoInputId` when it is to hand.
 */
export function setupUsesPropresenter(
  overlay: Pick<AppSettings['overlay'], 'outputs'>,
  ndiVideoInputId = '',
): boolean {
  return overlay.outputs.some(
    (output) =>
      output.enabled &&
      (outputRequiresPropresenter(output.kind) || ndiRoutedThroughPropresenter(output, overlay.outputs, ndiVideoInputId)),
  )
}

/** Result of the silent handshake that runs as soon as settings are loaded. */
export type PpLaunchOutcome = 'pending' | 'connected' | 'unavailable'

/** Map the first connect attempt onto a launch outcome. */
export function ppLaunchOutcomeFromStatus(
  state: ProPresenterConnectionState,
): Exclude<PpLaunchOutcome, 'pending'> {
  return state === 'connected' ? 'connected' : 'unavailable'
}

