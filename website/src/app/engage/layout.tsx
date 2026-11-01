import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Engage | Kairo', robots: { index: false, follow: false }, referrer: 'no-referrer' }
export default function Layout({ children }: { children: React.ReactNode }): React.ReactElement { return <>{children}</> }
