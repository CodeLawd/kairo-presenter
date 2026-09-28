'use client'

import { IconApple, IconWindows } from '@/components/landing/icons'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function DownloadPage(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Desktop app</CardTitle>
          <CardDescription>
            Install on the computer that runs ProPresenter, then sign in with the same account you
            use here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {[
              { label: 'Apple silicon Mac', detail: 'M series', href: '/api/download/mac-arm64', icon: <IconApple /> },
              { label: 'Intel Mac', detail: 'Intel chip', href: '/api/download/mac-x64', icon: <IconApple /> },
              { label: 'Windows', detail: 'Windows 10 or later', href: '/api/download/windows-x64', icon: <IconWindows /> },
              { label: 'Linux', detail: 'AppImage · x64', href: '/api/download/linux-x64', icon: null },
            ].map(({ label, detail, href, icon }) => (
              <a key={href} className="flex min-h-16 items-center gap-3 rounded-lg bg-muted/60 px-4 py-3 transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" href={href}>
                {icon}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="block text-xs text-muted-foreground">{detail}</span>
                </span>
                <span aria-hidden="true">↓</span>
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
