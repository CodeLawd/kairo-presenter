import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SubpageShell, subpageContainer as container } from '@/components/landing/SubpageShell'
import { StartDownload } from './StartDownload'

export const metadata: Metadata = {
  title: 'Thanks for downloading Kairo',
  robots: { index: false },
}

type Platform = 'mac-arm64' | 'mac-x64' | 'windows-x64' | 'linux-x64'

const platforms: Record<Platform, { name: string; steps: React.ReactNode[] }> = {
  'mac-arm64': { name: 'Apple silicon Mac', steps: macSteps() },
  'mac-x64': { name: 'Intel Mac', steps: macSteps() },
  'windows-x64': {
    name: 'Windows',
    steps: [
      <>Open <b className="font-semibold text-[#141518]">Kairo Setup</b> from your Downloads folder.</>,
      <>If Windows shows <b className="font-semibold text-[#141518]">“Windows protected your PC”</b>, choose <b className="font-semibold text-[#141518]">More info → Run anyway</b>.</>,
      <>Follow the installer, then open Kairo from the Start menu.</>,
    ],
  },
  'linux-x64': {
    name: 'Linux',
    steps: [
      <>Make the AppImage runnable: right-click → <b className="font-semibold text-[#141518]">Properties → Allow executing</b>, or run <code className="rounded bg-[#141518]/[.06] px-1.5 py-0.5 text-[.9em] text-[#141518]">chmod +x Kairo-*.AppImage</code>.</>,
      <>Double-click the AppImage to open Kairo.</>,
    ],
  },
}

function macSteps(): React.ReactNode[] {
  return [
    <>Open the <b className="font-semibold text-[#141518]">.dmg</b> from your Downloads folder and drag Kairo into <b className="font-semibold text-[#141518]">Applications</b>.</>,
    <>Open Kairo from Applications.</>,
  ]
}

export default async function DownloadThanks({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string; source?: string }>
}): Promise<React.ReactElement> {
  const { platform, source: rawSource } = await searchParams
  const source = rawSource && /^[a-z0-9-]{1,32}$/.test(rawSource) ? rawSource : 'direct'
  if (!platform || !(platform in platforms)) redirect('/#get')
  const { name, steps } = platforms[platform as Platform]
  const href = `/api/download/${platform}?source=${source}&retry=1`

  return (
    <SubpageShell>
      <StartDownload platform={platform} source={source} />

      <section className="mc-subpage-hero pt-[clamp(124px,15vh,172px)] pb-[clamp(64px,8vh,104px)] text-white">
        <div className={container}>
          <div className="max-w-2xl">
            <Image
              src="/brand/kairo-icon.png"
              alt=""
              width={56}
              height={56}
              className="size-14 rounded-2xl ring-1 ring-white/20 shadow-[0_14px_34px_-10px_rgba(4,12,42,0.5)]"
            />
            <p className="mt-6 text-[14px] font-medium text-white/80">
              Kairo for {name}
            </p>
            <h1 className="mt-3 text-[clamp(36px,5vw,60px)] leading-[1.06] font-medium tracking-[-.036em] text-white">
              Thanks for downloading Kairo.
            </h1>
            <p className="mt-5 max-w-[50ch] text-[16px] leading-[1.6] text-white/85">
              Your download should start in a moment. Didn&apos;t start?{' '}
              <a className="font-medium text-white underline underline-offset-4 hover:opacity-80" href={href}>
                Download it again
              </a>
              .
            </p>
          </div>
        </div>
      </section>

      <section className="bg-white pt-4 pb-[clamp(80px,10vw,132px)]">
        <div className={container}>
          <div className="max-w-2xl">
            <h2 className="text-[20px] font-medium tracking-[-.02em] text-[#141518]">
              Get set up in a minute
            </h2>

            <ol className="mt-6 divide-y divide-[#EAECEF] overflow-hidden rounded-2xl border border-[#EAECEF] bg-[#F8F9FB]">
              {[...steps, <>Sign in with your Kairo account. Your church setup comes with you.</>].map((step, i) => (
                <li key={i} className="flex items-start gap-4 bg-white px-5 py-5 text-[15px] leading-[1.6] text-[#5C616E]">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#1655F8]/10 text-[13px] font-semibold tabular-nums text-[#1655F8]">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>

            <div className="mt-9 flex flex-wrap items-center gap-4">
              <Link
                className="landing-press inline-flex h-11 items-center rounded-[10px] bg-[#141518] px-5 text-[14px] font-medium text-white hover:bg-[#262930]"
                href="/"
              >
                Back to home
              </Link>
              <Link
                className="inline-flex h-11 items-center px-2 text-[14px] font-medium text-[#1655F8] underline-offset-4 hover:underline"
                href="/#get"
              >
                Need a different version?
              </Link>
            </div>
          </div>
        </div>
      </section>
    </SubpageShell>
  )
}
