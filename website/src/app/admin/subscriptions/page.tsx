import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** Placeholder until billing launches; plans, revenue and churn will live here. */
export default function AdminSubscriptionsPage(): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-6xl">
      <Card>
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
          <CardDescription>Plans, revenue and renewals appear here once billing is live.</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
