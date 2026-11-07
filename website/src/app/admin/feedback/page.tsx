'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Bar, BarChart, Cell, XAxis } from 'recharts'
import {
  CheckCheckIcon,
  CheckIcon,
  EllipsisIcon,
  EyeIcon,
  HeartIcon,
  InboxIcon,
  LayersIcon,
  LightbulbIcon,
  MailIcon,
  MessageSquareDashedIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SearchIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from 'lucide-react'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Pager } from '@/components/admin/list-controls'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  FEEDBACK_KIND_LABEL,
  OS_NAMES,
  formatDateTime,
  type AdminFeedback,
  type AdminFeedbackList,
  type FeedbackKind,
  type FeedbackStatus,
} from '@/lib/admin'

type Tab = FeedbackStatus | 'all'

/** Each tab is a stage of a note's life: in the inbox, looked at, dealt with. */
const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'new', label: 'Inbox', icon: InboxIcon },
  { id: 'read', label: 'Read', icon: EyeIcon },
  { id: 'done', label: 'Done', icon: CheckCheckIcon },
  { id: 'all', label: 'All', icon: LayersIcon },
]

const KINDS: { id: FeedbackKind; icon: LucideIcon; tone: string; bar: string }[] = [
  { id: 'idea', icon: LightbulbIcon, tone: 'text-sky-600 dark:text-sky-400', bar: '[&_[data-slot=progress-indicator]]:bg-sky-500' },
  { id: 'problem', icon: TriangleAlertIcon, tone: 'text-rose-600 dark:text-rose-400', bar: '[&_[data-slot=progress-indicator]]:bg-rose-500' },
  { id: 'praise', icon: HeartIcon, tone: 'text-emerald-600 dark:text-emerald-400', bar: '[&_[data-slot=progress-indicator]]:bg-emerald-500' },
  { id: 'other', icon: MessageSquareIcon, tone: 'text-muted-foreground', bar: '' },
]
const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<FeedbackKind, (typeof KINDS)[number]>

const MOVES: Record<FeedbackStatus, { to: FeedbackStatus; label: string; icon: LucideIcon }[]> = {
  new: [{ to: 'read', label: 'Mark read', icon: EyeIcon }, { to: 'done', label: 'Mark done', icon: CheckIcon }],
  read: [{ to: 'done', label: 'Mark done', icon: CheckIcon }, { to: 'new', label: 'Back to inbox', icon: InboxIcon }],
  done: [{ to: 'new', label: 'Reopen', icon: RotateCcwIcon }],
}

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 7 ? `${days}d ago` : `${Math.round(days / 7)}w ago`
}

/**
 * Notes people sent from the app's Feedback button — ideas, problems, praise —
 * as an inbox: triage from Inbox to Read to Done, filter by kind, reply by email.
 */
export default function AdminFeedbackPage(): React.ReactElement {
  const { request } = useDashboard()
  const [tab, setTab] = useState<Tab>('new')
  const [kinds, setKinds] = useState<FeedbackKind[]>([])
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<AdminFeedbackList | null>(null)
  const [error, setError] = useState<string | null>(null)

  const kind = kinds[0]
  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) })
    if (tab !== 'all') params.set('status', tab)
    if (kind) params.set('kind', kind)
    if (q.trim()) params.set('q', q.trim())
    request<AdminFeedbackList>(`/v1/admin/feedback?${params}`)
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((failure: Error) => setError(failure.message))
  }, [request, tab, kind, q, page])

  useEffect(load, [load])

  async function move(item: AdminFeedback, to: FeedbackStatus): Promise<void> {
    // Leaves the current tab at once; the reload brings the counts along.
    setData((d) => d && { ...d, items: tab === 'all' ? d.items.map((i) => (i.id === item.id ? { ...i, status: to } : i)) : d.items.filter((i) => i.id !== item.id) })
    try {
      await request(`/v1/admin/feedback/${item.id}`, { method: 'PATCH', body: { status: to } })
    } catch (failure) {
      setError((failure as Error).message)
    }
    load()
  }

  const count = (t: Tab): number =>
    t === 'all' ? Object.values(data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0) : (data?.counts[t] ?? 0)
  const kindsTotal = KINDS.reduce((sum, k) => sum + (data?.kinds[k.id] ?? 0), 0)

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Feedback</h2>
          <p className="mt-1 text-sm text-muted-foreground">What churches are asking for, straight from the app.</p>
        </div>
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput placeholder="Search messages" value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
        </InputGroup>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs value={tab} onValueChange={(value) => { setTab(value as Tab); setPage(1) }}>
              <TabsList className="h-10 p-1">
                {TABS.map((t) => {
                  const Icon = t.icon
                  const n = count(t.id)
                  return (
                    <TabsTrigger key={t.id} value={t.id} className="gap-2 px-3">
                      <Icon />
                      {t.label}
                      {data && n > 0 && (
                        <Badge variant={t.id === 'new' ? 'default' : 'secondary'} className="h-5 min-w-5 px-1.5 tabular-nums">
                          {n}
                        </Badge>
                      )}
                    </TabsTrigger>
                  )
                })}
              </TabsList>
            </Tabs>

            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={1}
              value={kinds}
              onValueChange={(value) => { setKinds((value as FeedbackKind[]).slice(-1)); setPage(1) }}
              aria-label="Kind"
            >
              {KINDS.filter((k) => k.id !== 'other' || data?.kinds.other).map((k) => {
                const Icon = k.icon
                return (
                  <ToggleGroupItem key={k.id} value={k.id} className="gap-1.5 rounded-full px-3">
                    <Icon className={k.tone} />
                    {FEEDBACK_KIND_LABEL[k.id]}
                  </ToggleGroupItem>
                )
              })}
            </ToggleGroup>
          </div>

          {!data ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-36 w-full rounded-xl" />)
          ) : data.items.length === 0 ? (
            <Empty className="border border-dashed py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageSquareDashedIcon />
                </EmptyMedia>
                <EmptyTitle>{tab === 'new' ? 'Inbox zero' : 'Nothing here'}</EmptyTitle>
                <EmptyDescription>
                  {tab === 'new' ? 'Every note has been read. New feedback from the app lands here.' : 'No feedback matches this view.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            data.items.map((item) => <FeedbackCard key={item.id} item={item} onMove={move} />)
          )}

          {data && data.total > data.pageSize && (
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <WeekCard data={data} />

          <Card>
            <CardHeader>
              <CardTitle>By kind</CardTitle>
              <CardDescription>All feedback so far</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {KINDS.map((k) => {
                const Icon = k.icon
                const n = data?.kinds[k.id] ?? 0
                return (
                  <div key={k.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 text-sm">
                      <Icon className={`size-4 ${k.tone}`} />
                      <span>{FEEDBACK_KIND_LABEL[k.id]}</span>
                      <span className="ml-auto tabular-nums text-muted-foreground">{n}</span>
                    </div>
                    <Progress value={kindsTotal ? (n / kindsTotal) * 100 : 0} className={k.bar} />
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}

function FeedbackCard({ item, onMove }: { item: AdminFeedback; onMove: (item: AdminFeedback, to: FeedbackStatus) => void }): React.ReactElement {
  const who = item.user.name || item.user.email || 'Unknown user'
  const kind = KIND[item.kind]
  const KindIcon = kind.icon
  const [primary, ...rest] = MOVES[item.status]
  const PrimaryIcon = primary.icon
  const initials = who.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  return (
    <Card className={item.status === 'done' ? 'opacity-70' : undefined}>
      <CardHeader>
        <div className="flex min-w-0 items-center gap-3">
          <Avatar>
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <span className="truncate">{who}</span>
              {item.status === 'new' && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
            </CardTitle>
            <CardDescription className="truncate">
              {item.church ? (
                <Link href={`/admin/churches/${item.church.id}`} className="hover:text-foreground">{item.church.name}</Link>
              ) : 'No church'}
              <span title={formatDateTime(item.createdAt)}> · {ago(item.createdAt)}</span>
            </CardDescription>
          </div>
        </div>
        <CardAction>
          <Badge variant="outline" className="gap-1">
            <KindIcon className={kind.tone} />
            {FEEDBACK_KIND_LABEL[item.kind]}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{item.message}</p>
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          Kairo {item.appVersion || '?'} · {OS_NAMES[item.os] ?? item.os} {item.osVersion}
          {item.context ? ` · from ${item.context}` : ''}
        </span>
        {item.user.email && (
          <a
            href={`mailto:${item.user.email}?subject=${encodeURIComponent('Your Kairo feedback')}`}
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
            title={item.user.email}
          >
            <MailIcon />
            Reply
          </a>
        )}
        <Button variant="secondary" size="sm" onClick={() => onMove(item, primary.to)}>
          <PrimaryIcon />
          {primary.label}
        </Button>
        {rest.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More actions" />}>
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rest.map((m) => {
                const Icon = m.icon
                return (
                  <DropdownMenuItem key={m.to} onClick={() => onMove(item, m.to)}>
                    <Icon />
                    {m.label}
                  </DropdownMenuItem>
                )
              })}
              {item.user.email && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void navigator.clipboard?.writeText(item.user.email)}>
                    <MailIcon />
                    Copy email
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardFooter>
    </Card>
  )
}

const WEEK_CONFIG = { count: { label: 'Notes', color: 'var(--primary)' } } satisfies ChartConfig

/** Notes per day for the last 7 days; today in full colour, the rest muted. */
function WeekCard({ data }: { data: AdminFeedbackList | null }): React.ReactElement {
  const rows = (data?.byDay ?? []).map((d) => ({
    ...d,
    label: new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' }),
  }))
  const total = rows.reduce((sum, d) => sum + d.count, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>This week</CardTitle>
        <CardDescription>{data ? `${total} ${total === 1 ? 'note' : 'notes'} in the last 7 days` : 'Loading…'}</CardDescription>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-44 w-full rounded-lg" />
        ) : (
          <ChartContainer config={WEEK_CONFIG} className="h-44 w-full">
            <BarChart accessibilityLayer data={rows} margin={{ top: 4, left: 0, right: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
              <Bar dataKey="count" radius={6} minPointSize={4}>
                {rows.map((row, i) => (
                  <Cell key={row.date} fill="var(--color-count)" fillOpacity={i === rows.length - 1 ? 1 : 0.25} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
