'use client'

import Link from 'next/link'
import { IconApple, IconWindows } from '@/components/landing/icons'
import { Button } from '@/components/ui/button'
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
            <Button
              render={<Link href="/#get" />}
              nativeButton={false}
              variant="outline"
              className="h-auto justify-center py-3"
            >
              <IconApple /> macOS
            </Button>
            <Button
              render={<Link href="/#get" />}
              nativeButton={false}
              variant="outline"
              className="h-auto justify-center py-3"
            >
              <IconWindows /> Windows
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
