/**
 * A zoomed region of one of the screenshots. `zoom` is the background scale
 * (100 = fit width) and `x`/`y` pick the point of the image to centre on, so a
 * single capture can carry several sections without slicing files.
 *
 * This deliberately stays a CSS background rather than next/image: the crop is
 * expressed through `background-size` / `background-position`, which an <img>
 * has no equivalent for. The values are tuned to the 2200x1365 captures — see
 * public/shots/README.md before replacing one.
 */
export function Detail({
  src,
  alt,
  zoom,
  x,
  y,
  ratio = '16 / 10',
}: {
  src: string
  alt: string
  zoom: number
  x: number
  y: number
  ratio?: string
}): React.ReactElement {
  return (
    <div
      role="img"
      aria-label={alt}
      className="overflow-hidden rounded-xl border border-line bg-panel bg-no-repeat shadow-[0_40px_80px_-40px_rgba(0,0,0,0.9)]"
      style={{
        aspectRatio: ratio,
        backgroundImage: `url(${src})`,
        backgroundSize: `${zoom}%`,
        backgroundPosition: `${x}% ${y}%`,
      }}
    />
  )
}
