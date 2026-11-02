import { asObject } from './normalize'
import { OVERLAY_OUTPUT_KINDS } from './overlay-outputs'

// The canonical list, never a copy: this runs on every launch (see db/index.ts),
// so a kind missing here is deleted from the operator's saved screens for good.
// `syphon` was absent from a hand-written copy and every Mac Syphon screen
// vanished on the next restart.
const RENDERED_KINDS = new Set<string>(OVERLAY_OUTPUT_KINDS)

/** Sanitize raw settings before normalization, including settings restored by older builds. */
export function retireProPresenterSettings(raw: unknown): Record<string, unknown> & {
  overlay: Record<string, unknown> & { outputs: Record<string, unknown>[] }
} {
  const settings = { ...asObject(raw) }
  const legacy = asObject(settings.overlay)
  const outputs = Array.isArray(legacy.outputs) ? legacy.outputs.map(asObject) : null
  delete settings.propresenter
  delete settings.retirementNotice
  delete settings.propresenterResources
  const overlay = { ...legacy }
  delete overlay.mode
  delete overlay.ppVideoInputUuid
  // Missing legacy arrays are materialized here so an old message-only setup
  // cannot become an enabled output when normalization fills current defaults.
  const kept = outputs === null
    ? (legacy.mode === 'ndi' || legacy.mode === 'auto'
      ? [{ id: 'main', kind: 'ndi', enabled: true, theme: legacy.theme }]
      : [])
    : outputs.filter(o => RENDERED_KINDS.has(String(o.kind))).map(o => {
      const clean = { ...o }
      delete clean.lookId
      delete clean.ppVideoInputUuid
      return clean
    })
  return {
    ...settings,
    overlay: { ...overlay, outputs: kept },
  }
}
