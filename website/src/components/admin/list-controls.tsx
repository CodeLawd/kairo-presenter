'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** The value, once it has stopped changing for `ms` — so search fires after typing, not per key. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
}): React.ReactElement {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(total, page * pageSize)
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {first}–{last} of {total.toLocaleString()}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}

/** "Last 7 / 30 / 90 days / 1 year" — the window every stats page reads. */
export function RangePicker({
  value,
  onChange,
  ranges = [7, 30, 90, 365],
}: {
  value: number
  onChange: (days: number) => void
  ranges?: readonly number[]
}): React.ReactElement {
  return (
    <div className="flex gap-1 self-start rounded-lg bg-muted p-1" role="radiogroup" aria-label="Range">
      {ranges.map((range) => (
        <button
          key={range}
          type="button"
          role="radio"
          aria-checked={value === range}
          onClick={() => onChange(range)}
          className={cn(
            'rounded-md px-3 py-1 text-sm transition-colors',
            value === range ? 'bg-background font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {range === 365 ? '1 year' : `${range} days`}
        </button>
      ))}
    </div>
  )
}
