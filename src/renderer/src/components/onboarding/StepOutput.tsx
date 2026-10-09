import { useState, type CSSProperties } from 'react'
import type { OverlayOutput } from '@shared/ipc'
import type { StageDisplayConfig } from '@shared/program'
import { makeProjectorOutput } from '@shared/overlay-defaults'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { DisplayPicker, useDisplays, type DisplayBound } from '@/components/screens/displays'
import { ChevronRight } from '@/icons'

type Binding = Pick<OverlayOutput, 'displayId' | 'displayLabel' | 'displaySize'>

/**
 * One audience screen and one stage screen — the common case. Everything else
 * (more screens, NDI, themes per screen) is in the Screens window, linked below.
 * Each pick saves immediately; the wizard waits on `onSavingChange`.
 */
export default function StepOutput({ onSavingChange, onOpenScreens }: {
  onSavingChange: (saving: boolean) => void
  onOpenScreens: () => void
}): React.ReactElement {
  const settings = useBootstrapStore((s) => s.settings)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const displays = useDisplays()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const outputs = settings.overlay.outputs
  const screen = outputs.find((output) => output.kind === 'screen') ?? makeProjectorOutput(0)
  const stages = settings.presentation.stageDisplays
  const stage: DisplayBound = stages[0] ?? { name: 'Stage display', displayId: null, displayLabel: '', displaySize: null }
  const enabledScreens = outputs.filter((output) => output.kind === 'screen' && output.enabled)
  const enabledStages = stages.filter((item) => item.enabled)

  const run = async (write: () => Promise<void>): Promise<void> => {
    setSaving(true)
    onSavingChange(true)
    setError('')
    try {
      await write()
    } catch {
      setError('The screen could not be saved. Please try again.')
    } finally {
      setSaving(false)
      onSavingChange(false)
    }
  }

  const saveAudience = (patch: Binding): Promise<void> => run(async () => {
    const next = { ...screen, ...patch, enabled: patch.displayId !== null }
    const overlay = {
      ...settings.overlay,
      outputs: outputs.some((output) => output.id === screen.id)
        ? outputs.map((output) => output.id === screen.id ? next : output)
        : [...outputs, next],
    }
    await window.api.settings.set('overlay', overlay)
    patchSettings('overlay', overlay)
  })

  const saveStage = (patch: Binding): Promise<void> => run(async () => {
    const enabled = patch.displayId !== null
    let stageDisplays: StageDisplayConfig[]
    if (stages[0]) stageDisplays = stages.map((item, i) => i === 0 ? { ...item, ...patch, enabled } : item)
    else if (enabled) stageDisplays = [{ id: `stage-${Date.now().toString(36)}`, name: 'Stage display', enabled, ...patch, showNext: true, showClock: true, showTimer: true }]
    else return
    const presentation = { ...settings.presentation, stageDisplays }
    await window.api.settings.set('presentation', presentation)
    patchSettings('presentation', presentation)
  })

  return (
    <div className="onboarding-setup">
      <h2 id="onboarding-slide-title" className="onboarding-setup-title ob-in">Configure Screens</h2>
      <fieldset disabled={saving} className="onboarding-group min-w-0">
        <div className="onboarding-row ob-in" style={{ '--i': 1 } as CSSProperties}>
          <div>
            <label htmlFor="ob-audience" className="text-[16px] font-semibold text-slate-200">Audience Screen</label>
            <p className="mt-1 text-[13px] text-slate-500">What the room sees</p>
          </div>
          <DisplayPicker id="ob-audience" target={{ ...screen, name: 'Audience screen' }} displays={displays} others={[...enabledScreens.filter((output) => output.id !== screen.id), ...enabledStages]} onChange={(patch) => void saveAudience(patch)} />
        </div>
        <div className="onboarding-row ob-in" style={{ '--i': 2 } as CSSProperties}>
          <div>
            <label htmlFor="ob-stage" className="text-[16px] font-semibold text-slate-200">Stage Screen</label>
            <p className="mt-1 text-[13px] text-slate-500">What the pastor and band see</p>
          </div>
          <DisplayPicker id="ob-stage" target={stage} displays={displays} others={[...enabledScreens, ...enabledStages.filter((item) => item.id !== stages[0]?.id)]} onChange={(patch) => void saveStage(patch)} />
        </div>
      </fieldset>
      {error && <p key={error} role="alert" className="onboarding-error mt-4 text-sm text-red-400">{error}</p>}
      <p className="ob-rise mt-6 text-center text-[13px] text-slate-400">
        {displays.length <= 1 ? 'No projector or TV connected yet? Skip this and connect one before your service.' : 'More screens and stage layouts can be set up in Screens.'}
      </p>
      <button type="button" className="ob-rise mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-teal-400 hover:text-teal-300" onClick={onOpenScreens} disabled={saving}>
        Open full Screen Configuration <ChevronRight size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
