import type { Metadata } from 'next'
import { Barlow, Inter, JetBrains_Mono, Manrope, Geist } from 'next/font/google'
import './globals.css'
import { cn } from "@/lib/utils";
import { DASHBOARD_THEME_BOOT_SCRIPT } from '@/lib/dashboard-theme-script'

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const barlow = Barlow({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-barlow',
  display: 'swap',
})

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains',
  display: 'swap',
})

// The sermon recap document (preview + PDF) is set in Inter. Loaded here so
// the pdfcn web preview resolves the same face the PDF renderer embeds.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
})

const title = 'Kairo — Presentation software for your church'
const description =
  'Plan the service, run lyrics, Scripture, slides and media on your own screens, and find verses that come up during the sermon. ProPresenter is optional.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'website' },
  twitter: { card: 'summary_large_image', title, description },
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    // `data-scroll-behavior` is required from Next 16 on: the framework no
    // longer forces instant scroll on navigation, and globals.css sets
    // `scroll-behavior: smooth` on html.
    // suppressHydrationWarning: the boot script sets data-dash-theme on <html>
    // before React hydrates, which is intended.
    <html
      suppressHydrationWarning
      lang="en"
      data-scroll-behavior="smooth"
      className={cn(barlow.variable, manrope.variable, jetbrainsMono.variable, inter.variable, "font-sans", geist.variable)}
    >
      <head>
        <meta name="theme-color" content="#11120D" />
        {/* Dashboard light mode, set before first paint (no dark flash). */}
        <script dangerouslySetInnerHTML={{ __html: DASHBOARD_THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
