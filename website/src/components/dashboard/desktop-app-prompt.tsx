'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import { KairoMark } from '@/components/brand/KairoMark'

const DISMISS_KEY = 'kairo_desktop_prompt_dismissed'

export function DesktopAppPrompt(): React.ReactElement | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === '1') return
    } catch {
      // ignore
    }
    setOpen(true)
  }, [])

  if (!open) return null

  const dismiss = (): void => {
    setOpen(false)
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[min(100vw-2rem,20rem)] rounded-xl border border-white/[0.08] bg-panel p-3.5 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)]">
      <div className="flex items-start gap-3">
        <KairoMark size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-paper">Download the Desktop App</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-mute">
            Detect and display verses live in ProPresenter.
          </p>
          <Link
            href="/dashboard/download"
            className="mt-2 inline-block text-[12px] font-medium text-accent hover:underline"
          >
            Get Kairo →
          </Link>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md p-1 text-faint transition-colors hover:bg-white/[0.05] hover:text-paper"
          aria-label="Dismiss"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
