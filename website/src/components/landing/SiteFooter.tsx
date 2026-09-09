import Link from 'next/link'
import { Wordmark } from '@/components/brand/Wordmark'
import { cx, wrap } from './primitives'

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#faq', label: 'FAQ' },
  { href: '#get', label: 'Get early access' },
]

export function SiteFooter(): React.ReactElement {
  return (
    <footer className="border-t border-line-soft pb-[42px] pt-[34px]">
      <div className={wrap}>
        <div className="flex flex-wrap items-center gap-5">
          <Wordmark href="#top" />
          <nav className="flex flex-wrap gap-5 sm:ml-auto" aria-label="Footer">
            {LINKS.map((item) => (
              <a
                key={item.href}
                className="text-[13px] text-mute transition-colors hover:text-paper"
                href={item.href}
              >
                {item.label}
              </a>
            ))}
            <Link
              className="text-[13px] text-mute transition-colors hover:text-paper"
              href="/login"
            >
              Sign in
            </Link>
          </nav>
        </div>
        <p className={cx('mt-[22px] max-w-[70ch] font-mono text-[10.5px] leading-[1.6] text-faint')}>
          Kairo is an independent tool for church production teams. ProPresenter is a trademark of
          Renewed Vision; NDI is a trademark of Vizrt. Scripture from API.Bible is used under the
          terms of each publisher&rsquo;s licence. © {new Date().getFullYear()} Kairo.
        </p>
      </div>
    </footer>
  )
}
