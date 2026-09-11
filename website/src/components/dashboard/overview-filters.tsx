'use client'

import { useState } from 'react'
import { CheckIcon, ChevronDownIcon, ListFilterIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import {
  boundsForRange,
  localIsoDay,
  STATS_RANGE_OPTIONS,
  statsRangeLabel,
  type SermonStatsRange,
} from '@/lib/sermons'
import { cn } from '@/lib/utils'

export type OverviewFilterValue = {
  range: SermonStatsRange
  from?: string
  to?: string
  speaker: string
}

type DateChoice = Exclude<SermonStatsRange, 'custom'> | 'day' | 'custom'

function choiceOf(value: OverviewFilterValue): DateChoice {
  if (value.range !== 'custom') return value.range
  if (value.from && value.to && value.from === value.to) return 'day'
  return 'custom'
}

export function OverviewFilters({
  value,
  speakerNames,
  onChange,
}: {
  value: OverviewFilterValue
  speakerNames: string[]
  onChange: (next: OverviewFilterValue) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const choice = choiceOf(value)
  const today = localIsoDay()
  const speakerLabel = value.speaker || 'All speakers'
  const summary = [statsRangeLabel(value.range, value.from, value.to), speakerNames.length > 1 ? speakerLabel : null]
    .filter(Boolean)
    .join(' · ')

  function setRange(range: Exclude<SermonStatsRange, 'custom'>): void {
    const bounds = boundsForRange(range)
    onChange({ ...value, range, from: bounds.from, to: bounds.to })
    setOpen(false)
  }

  function setDay(day: string): void {
    const next = day || today
    onChange({ ...value, range: 'custom', from: next, to: next })
  }

  function setCustom(next: { from?: string; to?: string }): void {
    const from = next.from ?? value.from ?? boundsForRange('7d').from ?? today
    const to = next.to ?? value.to ?? today
    onChange({ ...value, range: 'custom', from: from <= to ? from : to, to: from <= to ? to : from })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" aria-label="Filter overview" />
        }
      >
        <ListFilterIcon data-icon="inline-start" />
        <span className="max-w-[18rem] truncate">{summary}</span>
        <ChevronDownIcon data-icon="inline-end" />
      </PopoverTrigger>
      <PopoverContent align="end" className="flex flex-col gap-3">
        <div>
          <p className="px-1 text-xs font-medium text-muted-foreground">Date</p>
          <div className="mt-1 flex flex-col">
            {STATS_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={cn(
                  'flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                  choice === option.key && 'bg-accent/60',
                )}
                onClick={() => setRange(option.key)}
              >
                <span className="flex-1">{option.label}</span>
                {choice === option.key ? <CheckIcon className="size-3.5" /> : null}
              </button>
            ))}
            <button
              type="button"
              className={cn(
                'flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                choice === 'day' && 'bg-accent/60',
              )}
              onClick={() => setDay(value.from && value.from === value.to ? value.from : today)}
            >
              <span className="flex-1">Specific day</span>
              {choice === 'day' ? <CheckIcon className="size-3.5" /> : null}
            </button>
            {choice === 'day' ? (
              <div className="px-1.5 pb-1.5 pt-1">
                <Label htmlFor="overview-day" className="sr-only">
                  Day
                </Label>
                <Input
                  id="overview-day"
                  type="date"
                  max={today}
                  value={value.from ?? today}
                  onChange={(event) => setDay(event.target.value)}
                />
              </div>
            ) : null}
            <button
              type="button"
              className={cn(
                'flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                choice === 'custom' && 'bg-accent/60',
              )}
              onClick={() => {
                const bounds = boundsForRange('7d')
                setCustom({ from: value.from ?? bounds.from, to: value.to ?? bounds.to })
              }}
            >
              <span className="flex-1">Custom range</span>
              {choice === 'custom' ? <CheckIcon className="size-3.5" /> : null}
            </button>
            {choice === 'custom' ? (
              <div className="grid grid-cols-2 gap-2 px-1.5 pb-1.5 pt-1">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="overview-from" className="text-xs text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="overview-from"
                    type="date"
                    max={value.to ?? today}
                    value={value.from ?? ''}
                    onChange={(event) => setCustom({ from: event.target.value, to: value.to })}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="overview-to" className="text-xs text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="overview-to"
                    type="date"
                    max={today}
                    min={value.from}
                    value={value.to ?? ''}
                    onChange={(event) => setCustom({ from: value.from, to: event.target.value })}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {speakerNames.length > 1 ? (
          <>
            <Separator />
            <div className="flex flex-col gap-1.5 px-1">
              <Label htmlFor="overview-speaker" className="text-xs font-medium text-muted-foreground">
                Speaker
              </Label>
              <select
                id="overview-speaker"
                aria-label="Speaker"
                value={value.speaker}
                onChange={(event) => onChange({ ...value, speaker: event.target.value })}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              >
                <option value="">All speakers</option>
                {speakerNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
