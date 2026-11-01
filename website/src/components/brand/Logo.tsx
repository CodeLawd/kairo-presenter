import Image from "next/image";
import Link from "next/link";

/** Intrinsic size of /brand/logo-white.png, so next/image keeps its aspect. */
const WIDTH = 2326;
const HEIGHT = 557;

/**
 * The Kairo lockup from /public/brand, linking home. Shared by the site header,
 * the footer and the auth shell so there is one source for the logo.
 */
export function Logo({
  height = 22,
  href = "/",
  tone = "auto",
  className,
  priority,
}: {
  /** Rendered height in px; width follows the artwork's aspect ratio. */
  height?: number;
  /** `null` renders the logo without a link. */
  href?: string | null;
  /**
   * - `auto` (default): follows the marketing/dashboard theme (`brand-logo`).
   * - `adaptive`: drawn in Kairo ink on light surfaces and off-white in `.dark`.
   * - `light`: always off-white (for dark headers).
   * - `dark`: always Kairo ink (for light surfaces).
   */
  tone?: "auto" | "adaptive" | "light" | "dark";
  className?: string;
  priority?: boolean;
}): React.ReactElement {
  const toneClass =
    tone === "adaptive"
      ? "brightness-0 opacity-93 dark:brightness-100 dark:opacity-100"
      : tone === "dark"
        ? "brightness-0 opacity-93"
        : tone === "light"
          ? ""
          : "brand-logo";

  const image = (
    <Image
      src="/brand/logo-white.png"
      alt="Kairo"
      width={WIDTH}
      height={HEIGHT}
      priority={priority}
      className={`block w-auto ${toneClass}`}
      style={{ height }}
    />
  );

  if (href === null) return <span className={className}>{image}</span>;

  return (
    <Link
      href={href}
      aria-label="Kairo home"
      className={`block w-fit transition-opacity hover:opacity-80${className ? ` ${className}` : ""}`}
    >
      {image}
    </Link>
  );
}
