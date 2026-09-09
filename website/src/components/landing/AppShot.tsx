import Image from 'next/image'

/**
 * A real capture of the running app. Screenshots are taken with the macOS
 * window shortcut, so they arrive with their own chrome and shadow — the frame
 * here stays thin on purpose. The panel background keeps the layout from
 * collapsing if an image is still missing.
 */
export function AppShot({
  src,
  alt,
  caption,
  eager,
  glow,
}: {
  src: string
  alt: string
  caption?: string
  eager?: boolean
  glow?: boolean
}): React.ReactElement {
  return (
    <figure className="relative m-0">
      {glow ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-[6%] -top-6 bottom-8 rounded-[40px] bg-[radial-gradient(60%_50%_at_50%_40%,rgba(245,158,11,0.20),transparent_72%)] blur-2xl"
        />
      ) : null}
      <div className="relative min-h-[220px] overflow-hidden rounded-xl border border-line bg-panel shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]">
        <Image
          src={src}
          alt={alt}
          width={2200}
          height={1365}
          className="block h-auto w-full"
          priority={eager}
          sizes="(max-width: 860px) 100vw, 1320px"
        />
      </div>
      {caption ? (
        <figcaption className="mt-4 font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
