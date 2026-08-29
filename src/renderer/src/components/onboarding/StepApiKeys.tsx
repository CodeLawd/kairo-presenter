import { useState } from 'react'
import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import StepShell from './StepShell'

/**
 * Both keys are optional and independently skippable — the app searches
 * downloaded Bibles and runs manual mode without either. Keys are written
 * straight to the same settings the Settings modal edits; nothing is stored
 * anywhere else.
 */
export default function StepApiKeys(): React.ReactElement {
  const stt = useBootstrapStore((s) => s.settings.stt)
  const patchSettings = useBootstrapStore((s) => s.patchSettings)
  const [bibleKey, setBibleKey] = useState(stt.bibleApiKey)
  const [deepgramKey, setDeepgramKey] = useState(stt.apiKey)

  const save = async (patch: Partial<typeof stt>): Promise<void> => {
    const next = { ...stt, ...patch }
    patchSettings('stt', next)
    await window.api.settings.set('stt', next)
  }

  return (
    <StepShell
      title="API keys"
      blurb="Both are optional — paste what you have, add the rest later in Settings."
    >
      <div>
        <label className="label" htmlFor="ob-bible-key">
          API.Bible <span className="text-slate-600">— online translations</span>
        </label>
        <input
          id="ob-bible-key"
          className="input font-mono"
          value={bibleKey}
          onChange={(e) => setBibleKey(e.target.value)}
          onBlur={() => void save({ bibleApiKey: bibleKey.trim() })}
          placeholder="Paste key"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div>
        <label className="label" htmlFor="ob-deepgram-key">
          Deepgram <span className="text-slate-600">— live transcription</span>
        </label>
        <input
          id="ob-deepgram-key"
          className="input font-mono"
          value={deepgramKey}
          onChange={(e) => setDeepgramKey(e.target.value)}
          onBlur={() =>
            void save({
              apiKey: deepgramKey.trim(),
              provider: deepgramKey.trim() ? 'deepgram' : stt.provider,
            })
          }
          placeholder="Paste key"
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <p className="text-[12px] leading-relaxed text-slate-600">
        Without these, ProAutomate still runs: offline translations and manual scripture search work
        with no keys at all.
      </p>
    </StepShell>
  )
}
