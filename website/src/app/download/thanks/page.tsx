import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
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
      <>Open <b>Kairo Setup</b> from your Downloads folder.</>,
      <>If Windows shows <b>“Windows protected your PC”</b>, choose <b>More info → Run anyway</b>.</>,
      <>Follow the installer, then open Kairo from the Start menu.</>,
    ],
  },
  'linux-x64': {
    name: 'Linux',
    steps: [
      <>Make the AppImage runnable: right-click → <b>Properties → Allow executing</b>, or run <code className="rounded bg-[#11120D]/[.06] px-1.5 py-0.5 text-[.9em]">chmod +x Kairo-*.AppImage</code>.</>,
      <>Double-click the AppImage to open Kairo.</>,
    ],
  },
}

function macSteps(): React.ReactNode[] {
  return [
    <>Open the <b>.dmg</b> from your Downloads folder and drag Kairo into <b>Applications</b>.</>,
    <>Open Kairo. If macOS says <b>“Kairo” Not Opened</b>, click <b>Done</b>, then open <b>System Settings → Privacy &amp; Security</b>, scroll to the bottom and click <b>Open Anyway</b> next to Kairo. You only do this once.</>,
    <>
      Prefer Terminal? Run{' '}
      <code className="rounded bg-[#11120D]/[.06] px-1.5 py-0.5 text-[.9em]">xattr -cr /Applications/Kairo.app</code>{' '}
      and open Kairo again.
    </>,
  ]
}

export default async function DownloadThanks({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string; source?: string }>
}): Promise<React.ReactElement> {
  const { platform, source: rawSource } = await searchParams
  // Where the button was, for the admin download stats.
  const source = rawSource && /^[a-z0-9-]{1,32}$/.test(rawSource) ? rawSource : 'direct'
  if (!platform || !(platform in platforms)) redirect('/#get')
  const { name, steps } = platforms[platform as Platform]
  // The automatic start was already counted; a manual retry is not a second download.
  const href = `/api/download/${platform}?source=${source}&retry=1`

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#EAE7DF] px-5 py-16 text-[#11120D]">
      <StartDownload platform={platform} source={source} />
      <div className="w-full max-w-xl">
        <img src="/brand/kairo-icon.png" alt="" width={56} height={56} className="size-14" />
        <p className="mt-8 text-xs font-semibold tracking-[.18em] text-[#646157]">KAIRO FOR {name.toUpperCase()}</p>
        <h1 className="mt-4 text-[clamp(2.25rem,5vw,4rem)] leading-[1.06] tracking-[-.05em]">
          Thanks for downloading Kairo.
        </h1>
        <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-[#504F44]">
          Your download should start in a moment. Didn’t start?{' '}
          <a className="font-semibold text-[#11120D] underline underline-offset-4" href={href}>
            Download it again
          </a>
          .
        </p>

        <ol className="mt-10 flex flex-col gap-3">
          {[...steps, <>Sign in with your Kairo account. Your church setup comes with you.</>].map((step, i) => (
            <li key={i} className="flex gap-4 rounded-2xl bg-white px-5 py-4 text-[15px] leading-relaxed text-[#38372F]">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#F6F3EB] text-sm font-semibold text-[#11120D]">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link className="rounded-full bg-[#11120D] px-5 py-3 text-sm font-semibold text-white hover:bg-[#2B2B23]" href="/">
            Back to home
          </Link>
          <Link className="rounded-full px-5 py-3 text-sm font-semibold text-[#11120D] underline underline-offset-4" href="/#get">
            Need a different version?
          </Link>
        </div>
      </div>
    </main>
  )
}
