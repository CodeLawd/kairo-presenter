import { asObject } from './normalize'

const RENDERED_KINDS = new Set(['screen', 'device', 'ndi'])

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
