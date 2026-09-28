'use client'

import Link from 'next/link'
import { CheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    current: true,
    features: ['1 Kairo computer', 'Church account sync', 'API key vault'],
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
          <Card key={plan.name}>
            <CardHeader className="border-b">
              <CardTitle>{plan.name}</CardTitle>
              <CardAction>
                {plan.current ? <Badge variant="secondary">Current</Badge> : null}
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="font-display text-[32px] font-semibold tracking-tight">{plan.price}</p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckIcon className="size-3.5 text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              {plan.current ? (
                <p className="mt-6 text-xs text-muted-foreground">
                  You’re on Free while Kairo is in early access.
                </p>
              ) : (
                <Button type="button" className="mt-6" disabled>
                  Coming soon
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Questions about plans?{' '}
        <Link href="mailto:hello@kairo.app" className="text-primary underline-offset-4 hover:underline">
          Contact us
        </Link>
        .
      </p>
    </div>
  )
}
