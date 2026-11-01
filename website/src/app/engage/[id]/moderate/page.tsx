import { notFound } from 'next/navigation'
import { AUDIENCE_CODE } from '../../../../../../src/lib/audience-protocol'
import Moderation from '../../Moderation'

export default async function Page({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params
  const code = id.toUpperCase()
  if (!AUDIENCE_CODE.test(code)) notFound()
  return <Moderation code={code} />
}
