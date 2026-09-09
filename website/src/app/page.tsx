import Link from 'next/link'

/** Placeholder — replaced by the migrated landing page. */
export default function HomePage(): React.ReactElement {
  return (
    <main className="mx-auto grid min-h-dvh max-w-2xl place-items-center px-6">
      <div>
        <h1 className="font-display text-4xl font-extrabold tracking-[-0.03em]">Kairo</h1>
        <p className="mt-3 text-mute">Scripture and lyrics automation for ProPresenter.</p>
        <div className="mt-6 flex gap-4 text-sm">
          <Link className="text-accent" href="/signup">Create an account</Link>
          <Link className="text-dim" href="/login">Sign in</Link>
        </div>
      </div>
    </main>
  )
}
