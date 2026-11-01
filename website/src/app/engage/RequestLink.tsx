'use client'

import Link from 'next/link'
import { useState } from 'react'
import { engagePost } from './client-api'

export default function RequestLink({ code }: { code: string }): React.ReactElement {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  return (
    <div className="mx-auto max-w-[480px] rounded-2xl border border-black/8 bg-white p-6 shadow-[0_1px_2px_rgba(26,28,31,0.04),0_6px_18px_rgba(26,28,31,0.05)]">
      <form
        className="flex flex-col gap-4"
        onSubmit={event => {
          event.preventDefault()
          setPending(true)
          setError('')
          setMessage('')
          void engagePost(code, 'request-link', { email })
            .then(() => setMessage('If this email is on the moderator list, a new sign-in link is on its way.'))
            .catch(() => setError('Could not request a link right now. Please try again.'))
            .finally(() => setPending(false))
        }}
      >
        <div>
          <h2 className="text-lg font-bold tracking-[-0.015em] text-[#1A1C1F]">Sign in to moderate</h2>
          <p className="mt-1 text-sm leading-relaxed text-[#6B7280]">
            Enter the email address invited by the engagement owner to receive a sign-in link.
          </p>
        </div>

        <label className="flex flex-col gap-1.5 text-sm font-medium text-[#0A0B10]">
          Email address
          <input
            type="email"
            autoComplete="email"
            placeholder="you@church.org"
            required
            maxLength={254}
            value={email}
            onChange={event => setEmail(event.target.value)}
            disabled={pending}
            className="min-h-11 w-full rounded-xl border border-black/10 bg-[#F3F4F7] px-3.5 py-2.5 text-[15px] text-[#0A0B10] placeholder:text-[#666B7E] focus:border-[#3B6BFF] focus:bg-white focus:outline-none disabled:opacity-60"
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Link
            href={`/q/${code}`}
            className="text-sm font-medium text-[#565B6E] no-underline transition-colors hover:text-[#0A0B10]"
          >
            ← Back to audience view
          </Link>
          <button
            type="submit"
            disabled={pending || !email.trim()}
            className="min-h-10 cursor-pointer rounded-full border-0 bg-[#3B6BFF] px-5 text-[15px] font-semibold text-white transition-all hover:enabled:brightness-105 disabled:cursor-default disabled:opacity-45"
          >
            {pending ? 'Requesting…' : 'Email me a link'}
          </button>
        </div>

        {message && (
          <p className="rounded-xl bg-[#1F7A55]/10 px-3.5 py-2.5 text-sm leading-normal text-[#1F7A55]" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="rounded-xl bg-[#C0392B]/10 px-3.5 py-2.5 text-sm leading-normal text-[#C0392B]" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  )
}
