'use client'

import Link from 'next/link'
import { CheckIcon } from 'lucide-react'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    current: true,
    features: ['1 booth machine', 'Church account sync', 'API key vault'],
  },
  {
    name: 'Plus',
    price: 'Soon',
    current: false,
    features: ['More machines', 'Team seats', 'Priority support'],
  },
] as const

export default function BillingPage(): React.ReactElement {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        {PLANS.map((plan) => (
          <section
            key={plan.name}
            className="overflow-hidden rounded-xl border border-white/[0.07] bg-panel"
          >
            <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
              <h2 className="font-mono text-[10.5px] font-medium uppercase tracking-[0.16em] text-faint">
                {plan.name}
              </h2>
              {plan.current ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Current
                </span>
              ) : null}
            </div>
            <div className="px-5 py-5">
              <p className="font-display text-[32px] font-semibold tracking-[-0.03em] text-paper">
                {plan.price}
              </p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-[13.5px] text-mute">
                    <CheckIcon className="size-3.5 text-accent" />
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.current ? (
                <p className="mt-6 text-[12.5px] text-faint">You’re on Free while Kairo is in early access.</p>
              ) : (
                <button
                  type="button"
                  disabled
                  className="mt-6 inline-flex rounded-full bg-accent/40 px-4 py-2 text-[13px] font-semibold text-[#231703] opacity-70"
                >
                  Coming soon
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      <p className="text-[13px] text-mute">
        Questions about plans?{' '}
        <Link href="mailto:hello@kairo.app" className="text-accent hover:underline">
          Contact us
        </Link>
        .
      </p>
    </div>
  )
}
