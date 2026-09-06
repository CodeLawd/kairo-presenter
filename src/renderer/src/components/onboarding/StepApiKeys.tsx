import { useBootstrapStore } from '@/bootstrap/useBootstrapStore'
import { SecretKeyField, useSecretDraft } from '@/components/ui/secret-key-field'
import StepShell from './StepShell'

/**
 * Both keys are optional. Once saved they are write-only in the UI and sync
 * to the church org vault when signed in.
 */
export default function StepApiKeys(): React.ReactElement {
  const stt = useBootstrapStore((s) => s.settings.stt)
  const configured = useBootstrapStore((s) => s.settings.secretsConfigured)
  const bible = useSecretDraft(configured.bible)
  const deepgram = useSecretDraft(configured.deepgram)

  const saveBible = async (): Promise<void> => {
    const value = bible.takeSaveValue()
    if (value === undefined) return
    await window.api.settings.set('stt', {
      ...stt,
      bibleApiKey: value,
    })
    bible.markSaved()
  }

  const saveDeepgram = async (): Promise<void> => {
    const value = deepgram.takeSaveValue()
    if (value === undefined) return
    await window.api.settings.set('stt', {
      ...stt,
      apiKey: value,
      provider: value ? 'deepgram' : stt.provider,
    })
    deepgram.markSaved()
  }

  return (
    <StepShell
      title="API keys"
      blurb="Both are optional — paste what you have, add the rest later in Settings. Saved keys sync across your devices and cannot be viewed again."
    >
      <div className="space-y-2">
        <label className="label" htmlFor="ob-bible-key">
          API.Bible <span className="text-slate-600">— online translations</span>
        </label>
        <SecretKeyField
          configured={configured.bible}
          draft={bible.draft}
          onDraftChange={bible.setDraft}
          replacing={bible.replacing}
          onReplace={bible.beginReplace}
          onCancelReplace={bible.cancelReplace}
          onRemove={() => {
            void window.api.settings.set('stt', {
              ...stt,
              bibleApiKey: '',
              clearKeys: ['bibleApiKey'],
            })
            bible.markSaved()
          }}
          placeholder="Paste key"
          aria-label="API.Bible key"
          name="ob-bible-key"
        />
        {(!configured.bible || bible.replacing) && (
          <button
            type="button"
            className="text-[11px] font-semibold text-teal-400 hover:text-teal-300"
            onClick={() => void saveBible()}
          >
            Save key
          </button>
        )}
      </div>

      <div className="space-y-2">
        <label className="label" htmlFor="ob-deepgram-key">
          Deepgram <span className="text-slate-600">— live transcription</span>
        </label>
        <SecretKeyField
          configured={configured.deepgram}
          draft={deepgram.draft}
          onDraftChange={deepgram.setDraft}
          replacing={deepgram.replacing}
          onReplace={deepgram.beginReplace}
          onCancelReplace={deepgram.cancelReplace}
          onRemove={() => {
            void window.api.settings.set('stt', {
              ...stt,
              apiKey: '',
              clearKeys: ['apiKey'],
            })
            deepgram.markSaved()
          }}
          placeholder="Paste key"
          aria-label="Deepgram API key"
          name="ob-deepgram-key"
        />
        {(!configured.deepgram || deepgram.replacing) && (
          <button
            type="button"
            className="text-[11px] font-semibold text-teal-400 hover:text-teal-300"
            onClick={() => void saveDeepgram()}
          >
            Save key
          </button>
        )}
      </div>

      <p className="text-[12px] leading-relaxed text-slate-600">
        Without these, Kairo still runs: offline translations and manual scripture search work
        with no keys at all.
      </p>
    </StepShell>
  )
}
