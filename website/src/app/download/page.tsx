import { redirect } from 'next/navigation'

export default async function DownloadPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>
}): Promise<never> {
  const { platform } = await searchParams
  if (platform && /^[a-z0-9-]+$/.test(platform)) {
    redirect(`/download/thanks?platform=${encodeURIComponent(platform)}`)
  }
  redirect('/#get')
}
