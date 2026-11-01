'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/brand/Logo'
import { engagePost } from './client-api'
import { parseModeratorInvite } from './view-model'
import RequestLink from './RequestLink'

export default function InviteExchange({ invitation }: { invitation: string }): React.ReactElement {
  const router = useRouter()
  const [error, setError] = useState('')
  const parsed = parseModeratorInvite(invitation)
  const exchange = useRef<Promise<unknown> | null>(null)
  const code = parsed?.code
  const token = parsed?.token
  useEffect(() => {
    if (!code || !token) return
    let alive = true
    // Remove the capability from browser history before any further navigation.
    window.history.replaceState(null, '', `/engage/${code}/moderate`)
    exchange.current ??= engagePost(code, 'exchange', { token })
    void exchange.current.then(() => { if (alive) router.replace(`/engage/${code}/moderate`) }).catch(() => {
      if (alive) setError('This invitation has expired or has already been used. Request a new link below.')
    })
    return () => { alive = false }
  }, [code, token, router])
  return (
    <main className="flex min-h-dvh flex-col bg-[#F3F4F7] font-sans text-[#0A0B10] antialiased" style={{ colorScheme: 'light' }}>
      <div className="mx-auto flex w-full max-w-[560px] flex-1 flex-col justify-center px-4 py-12">
        <div className="mb-6 flex justify-center">
          <Logo height={24} tone="adaptive" />
        </div>
        <section className="mb-6 text-center">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0A0B10]">
            {!parsed ? 'This invitation is invalid' : error ? 'Sign in to moderate' : 'Opening your engagement…'}
          </h1>
          <p className="mt-2 text-[15px] leading-normal text-[#565B6E]" role={error ? 'alert' : 'status'}>
            {!parsed ? 'Ask the engagement owner for a new invitation.' : error || 'Confirming your invitation. No Kairo account needed.'}
          </p>
        </section>
        {error && code && <RequestLink code={code} />}
      </div>
    </main>
  )
}
