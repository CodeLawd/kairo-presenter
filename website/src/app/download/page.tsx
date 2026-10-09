import Link from 'next/link'

const names: Record<string, string> = {
  'mac-arm64': 'Apple silicon Mac',
  'mac-x64': 'Intel Mac',
  'windows-x64': 'Windows',
  'linux-x64': 'Linux',
}

export default async function DownloadUnavailable({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string }>
}): Promise<React.ReactElement> {
  const { platform } = await searchParams
  const name = names[platform ?? ''] ?? 'your computer'

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EAE7DF] px-5 py-16 text-[#11120D]">
      <div className="w-full max-w-xl">
        <p className="text-xs font-semibold tracking-[.18em] text-[#646157]">KAIRO DOWNLOADS</p>
        <h1 className="mt-5 text-[clamp(2.25rem,5vw,4rem)] leading-[1.06] tracking-[-.05em]">
          No installer for {name} is available right now.
        </h1>
        <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-[#504F44]">
          There isn’t a published file for this computer in the latest release. You can check the release page or choose another version.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="rounded-full bg-[#11120D] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2B2B23]" href="/#get">
            Choose another version
          </Link>
          <a className="rounded-full px-5 py-3 text-sm font-semibold text-[#11120D] underline underline-offset-4" href="https://github.com/CodeLawd/kairo-presenter/releases">
            See all releases ↗
          </a>
        </div>
      </div>
    </main>
  )
}
