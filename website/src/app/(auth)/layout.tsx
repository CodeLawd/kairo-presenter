import type { Metadata } from 'next'

/**
 * A pass-through layout. It exists only to hang shared metadata on the auth
 * routes — the two-column frame itself is the AuthSplit component, because a
 * layout receives no page props and so cannot vary the brand panel per route.
 *
 * The group parentheses keep it out of the URL: /login, /verify-email,
 * /reset-password is the exact path the API's transactional emails use.
 * emails link to.
 */
export const metadata: Metadata = {
  title: { template: '%s · Kairo', default: 'Kairo' },
  robots: { index: false, follow: false },
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  return <>{children}</>
}
