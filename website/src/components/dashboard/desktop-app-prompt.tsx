'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { XIcon } from 'lucide-react'
import { KairoMark } from '@/components/brand/KairoMark'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

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
    <Card className="fixed bottom-5 right-5 z-40 w-[min(100vw-2rem,20rem)] shadow-lg" size="sm">
      <CardContent className="flex items-start gap-3">
        <KairoMark size={28} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Download the Desktop App</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Detect and display verses live in ProPresenter.
          </p>
          <Link
            href="/dashboard/download"
            className="mt-2 inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            Get Kairo →
          </Link>
        </div>
        <Button type="button" variant="ghost" size="icon-xs" onClick={dismiss} aria-label="Dismiss">
          <XIcon />
        </Button>
      </CardContent>
    </Card>
  )
}
