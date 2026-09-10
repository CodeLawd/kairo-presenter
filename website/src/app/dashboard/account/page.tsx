'use client'

import { useEffect, useState } from 'react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { api, ApiError } from '@/lib/api'

export default function AccountPage(): React.ReactElement {
  const { session, accessToken, refresh, signOut } = useDashboard()
  const orgId = session.orgId
  const [name, setName] = useState(
    session.orgs.find((org) => org.id === orgId)?.name ?? '',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setName(session.orgs.find((org) => org.id === orgId)?.name ?? '')
  }, [session.orgs, orgId])

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!orgId) {
      setError('No church is linked to this account yet.')
      return
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await api(`/v1/orgs/${orgId}`, {
        method: 'PATCH',
        accessToken,
        body: { name: name.trim() },
      })
      await refresh()
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Profile
          </h2>
        </div>
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Name</p>
            <p className="mt-1 text-[14px] text-paper">{session.user.name}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Email</p>
            <p className="mt-1 text-[14px] text-paper">{session.user.email}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Status</p>
            <p className="mt-1 text-[14px] text-paper">
              {session.user.emailVerified ? 'Verified' : 'Unverified'}
            </p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Church
          </h2>
        </div>
        <form className="flex flex-col gap-4 px-5 py-5" onSubmit={(e) => void save(e)}>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Church name
            </span>
            <input
              className="rounded-lg border border-white/[0.08] bg-ink px-3 py-2.5 text-[14px] text-paper outline-none transition-colors placeholder:text-faint focus:border-accent/50"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Grace Chapel"
              required
            />
          </label>
          {error ? <p className="text-[13px] text-[#fb7185]">{error}</p> : null}
          {saved ? <p className="text-[13px] text-accent">Saved.</p> : null}
          <button
            type="submit"
            disabled={busy || !orgId}
            className="inline-flex w-fit rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-[#231703] transition-colors hover:bg-[#FBBF24] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save church'}
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel">
        <div className="border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
            Session
          </h2>
        </div>
        <div className="px-5 py-5">
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-lg bg-white/[0.04] px-4 py-2.5 text-[13px] font-medium text-paper transition-colors hover:bg-white/[0.07]"
          >
            Log out
          </button>
        </div>
      </section>
    </div>
  )
}
