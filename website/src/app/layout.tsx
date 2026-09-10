import type { Metadata } from 'next'
import { Barlow, JetBrains_Mono, Manrope, Geist } from 'next/font/google'
import './globals.css'
import { cn } from "@/lib/utils";

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

const title = 'Kairo — Your pastor says the verse. It’s already on screen.'
const description =
  'Kairo listens to your service, finds the passage, and hands it to you ready to send — including verses that are quoted without a reference. Approve the match, send it to ProPresenter or NDI. A desktop app for church tech teams.'

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
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={cn(barlow.variable, manrope.variable, jetbrainsMono.variable, "font-sans", geist.variable)}
    >
      <head>
        <meta name="theme-color" content="#000000" />
      </head>
      <body>{children}</body>
    </html>
  )
}
