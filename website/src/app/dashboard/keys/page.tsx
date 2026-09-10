'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { api, ApiError } from '@/lib/api'

type Secrets = {
  deepgramApiKey: string
  anthropicApiKey: string
  deepseekApiKey: string
  bibleApiKey: string
  braveApiKey: string
  googleTranslateApiKey: string
  updatedAt: string | null
}

const FIELDS: { key: keyof Omit<Secrets, 'updatedAt'>; label: string; hint: string }[] = [
  { key: 'deepgramApiKey', label: 'Deepgram', hint: 'Speech-to-text for the live transcript' },
  { key: 'anthropicApiKey', label: 'Anthropic', hint: 'Optional model provider' },
  { key: 'deepseekApiKey', label: 'DeepSeek', hint: 'Optional model provider' },
  { key: 'bibleApiKey', label: 'Bible API', hint: 'Scripture lookup' },
  { key: 'braveApiKey', label: 'Brave Search', hint: 'Optional web lookup' },
  { key: 'googleTranslateApiKey', label: 'Google Translate', hint: 'Optional translation' },
]

const EMPTY: Secrets = {
  deepgramApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',
  bibleApiKey: '',
  braveApiKey: '',
  googleTranslateApiKey: '',
  updatedAt: null,
}

export default function KeysPage(): React.ReactElement {
  const { session, accessToken } = useDashboard()
  const orgId = session.orgId
  const [secrets, setSecrets] = useState<Secrets>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!orgId) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await api<Secrets>(`/v1/orgs/${orgId}/secrets`, { accessToken })
        if (!cancelled) setSecrets(result)
      } catch (failure) {
        if (!cancelled) {
          setError(failure instanceof ApiError ? failure.message : 'Could not load keys.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, accessToken])

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!orgId) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const result = await api<Secrets>(`/v1/orgs/${orgId}/secrets`, {
        method: 'PUT',
        accessToken,
        body: {
          deepgramApiKey: secrets.deepgramApiKey,
          anthropicApiKey: secrets.anthropicApiKey,
          deepseekApiKey: secrets.deepseekApiKey,
          bibleApiKey: secrets.bibleApiKey,
          braveApiKey: secrets.braveApiKey,
          googleTranslateApiKey: secrets.googleTranslateApiKey,
        },
      })
      setSecrets(result)
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save keys.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Vault
          </h2>
        </div>
        <div className="px-5 py-5">
          <p className="mb-5 text-[13.5px] leading-relaxed text-mute">
            Saved encrypted for your church. Booth machines sync these instead of typing keys
            locally.
            {secrets.updatedAt
              ? ` Last updated ${new Date(secrets.updatedAt).toLocaleString()}.`
              : ''}
          </p>

          {loading ? (
            <p className="text-[13px] text-mute">Loading…</p>
          ) : !orgId ? (
            <p className="text-[13px] text-mute">Link a church first.</p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)}>
              {FIELDS.map((field) => (
                <label key={field.key} className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
                    {field.label}
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    className="rounded-lg border border-white/[0.08] bg-ink px-3 py-2.5 text-[14px] text-paper outline-none transition-colors placeholder:text-faint focus:border-accent/50"
                    value={secrets[field.key]}
                    onChange={(e) =>
                      setSecrets((current) => ({ ...current, [field.key]: e.target.value }))
                    }
                    placeholder={field.hint}
                  />
                </label>
              ))}
              {error ? <p className="text-[13px] text-[#fb7185]">{error}</p> : null}
              {saved ? <p className="text-[13px] text-accent">Keys saved.</p> : null}
              <button
                type="submit"
                disabled={busy}
                className="mt-1 inline-flex w-fit rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-[#231703] transition-colors hover:bg-[#FBBF24] disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save keys'}
              </button>
            </form>
          )}
        </div>
      </section>
    </div>
  )
}
