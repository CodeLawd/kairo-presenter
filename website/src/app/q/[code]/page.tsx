import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { AUDIENCE_CODE } from '../../../../../src/lib/audience-protocol'
import AudiencePhone from './AudiencePhone'

export const metadata: Metadata = {
  title: 'Audience Q&A',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#F4F5F7',
}
export default async function Page({ params }: { params: Promise<{ code: string }> }): Promise<React.ReactElement> {
  const { code } = await params
  const normalized = code.toUpperCase()
  if (!AUDIENCE_CODE.test(normalized)) notFound()
  return <AudiencePhone code={normalized} />
}
