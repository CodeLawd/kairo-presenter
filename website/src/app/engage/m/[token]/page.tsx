import InviteExchange from '../../InviteExchange'
export default async function Page({ params }: { params: Promise<{ token: string }> }): Promise<React.ReactElement> {
  const { token } = await params
  return <InviteExchange invitation={token} />
}
