import Link from 'next/link'

export default function ShareNotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col items-center px-5 py-24 text-center">
      <h1 className="font-display text-[24px] font-semibold tracking-[-0.02em] text-paper">
        This recap is no longer available
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-mute">
        The link may have been replaced, or the church may have stopped sharing it. Ask whoever
        sent it to you for a new link.
      </p>
      <Link href="/" className="mt-6 text-[13px] text-accent hover:underline">
        About Kairo
      </Link>
    </main>
  )
}
