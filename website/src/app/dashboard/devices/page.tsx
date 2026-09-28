'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useVisibleInterval } from '@/hooks/use-refresh'
import { ApiError } from '@/lib/api'
import type { OrgDevice } from '@contracts/contracts'

function prettyName(name: string): string {
  return name.replace(/\.local$/i, '').replace(/-/g, ' ')
}

function formatRelative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(delta)) return ''
  if (delta < 45_000) return 'just now'
  if (delta < 60 * 60_000) {
    const minutes = Math.max(1, Math.round(delta / 60_000))
    return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  }
  if (delta < 24 * 60 * 60_000) {
    const hours = Math.max(1, Math.round(delta / 3_600_000))
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  const days = Math.max(1, Math.round(delta / 86_400_000))
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const today = new Date()
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const startOfThat = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const dayDelta = Math.round((startOfToday.getTime() - startOfThat.getTime()) / 86_400_000)
  if (dayDelta === 0) return `Today at ${time}`
  if (dayDelta === 1) return `Yesterday at ${time}`
  const day = date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  return `${day} at ${time}`
}

function archLabel(device: OrgDevice): string | null {
  if (!device.arch) return null
  if (device.os === 'macOS' && device.arch === 'arm64') return 'Apple Silicon'
  if (device.os === 'macOS' && (device.arch === 'x64' || device.arch === 'ia32')) return 'Intel'
  return device.arch
}

function signedInLine(iso: string): string {
  const when = formatWhen(iso)
  if (!when) return 'Signed in'
  if (when.startsWith('Today')) return `Signed in today${when.slice('Today'.length)}`
  if (when.startsWith('Yesterday')) return `Signed in yesterday${when.slice('Yesterday'.length)}`
  return `Signed in ${when}`
}

function networkLabel(ip: string | null): string | null {
  if (!ip) return null
  const trimmed = ip.trim().toLowerCase()
  if (
    trimmed === '::1' ||
    trimmed === '127.0.0.1' ||
    trimmed === '0:0:0:0:0:0:0:1' ||
    trimmed.endsWith('127.0.0.1')
  ) {
    return null
  }
  return ip
}

function specChips(device: OrgDevice): string[] {
  const os = [device.os, device.osVersion].filter(Boolean).join(' ')
  return [os || null, archLabel(device), device.appVersion ? `Kairo ${device.appVersion}` : null].filter(
    (chip): chip is string => Boolean(chip),
  )
}

function DevicePortrait({
  id,
  os,
  lit,
}: {
  id: string
  os: string | null
  lit: boolean
}): React.ReactElement {
  const screen = `screen-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const glow = `glow-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const isLaptop = os !== 'Windows' && os !== 'Linux'

  return (
    <div className="relative isolate grid size-[72px] shrink-0 place-items-center">
      <div
        className="pointer-events-none absolute inset-1 rounded-full blur-lg"
        style={{
          background: lit
            ? 'radial-gradient(closest-side, rgba(245,158,11,0.28), transparent 74%)'
            : 'transparent',
        }}
        aria-hidden
      />
      <svg
        viewBox="0 0 200 128"
        className="relative h-[44px] w-auto"
        aria-hidden
      >
        <defs>
          <linearGradient id={screen} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lit ? '#3a2a12' : '#161412'} />
            <stop offset="100%" stopColor={lit ? '#1a140c' : '#0c0b0a'} />
          </linearGradient>
          <radialGradient id={glow} cx="50%" cy="42%" r="58%">
            <stop offset="0%" stopColor="rgba(245,158,11,0.55)" />
            <stop offset="100%" stopColor="rgba(245,158,11,0)" />
          </radialGradient>
        </defs>
        {isLaptop ? (
          <>
            <rect x="34" y="10" width="132" height="86" rx="10" fill="#1c1a18" stroke="rgba(247,246,242,0.16)" />
            <rect x="40" y="16" width="120" height="72" rx="4" fill={`url(#${screen})`} />
            {lit ? <rect x="40" y="16" width="120" height="72" rx="4" fill={`url(#${glow})`} /> : null}
            <circle cx="100" cy="13.4" r="1.15" fill="rgba(247,246,242,0.28)" />
            <path
              d="M24 100h152c5.5 0 8 3.2 8 6.5V110H16v-3.5c0-3.3 2.5-6.5 8-6.5z"
              fill="#2a2724"
              stroke="rgba(247,246,242,0.08)"
            />
            <rect x="88" y="102.5" width="24" height="2.4" rx="1.2" fill="rgba(247,246,242,0.16)" />
            <ellipse cx="100" cy="118" rx="46" ry="3.4" fill="#000" opacity="0.38" />
          </>
        ) : (
          <>
            <rect x="38" y="8" width="124" height="88" rx="10" fill="#1c1a18" stroke="rgba(247,246,242,0.16)" />
            <rect x="44" y="14" width="112" height="74" rx="4" fill={`url(#${screen})`} />
            {lit ? <rect x="44" y="14" width="112" height="74" rx="4" fill={`url(#${glow})`} /> : null}
            <rect x="96" y="96" width="8" height="14" rx="1.5" fill="#2a2724" />
            <rect x="78" y="110" width="44" height="4" rx="2" fill="#2a2724" />
            <ellipse cx="100" cy="120" rx="40" ry="3" fill="#000" opacity="0.38" />
          </>
        )}
      </svg>
    </div>
  )
}

function DeviceCard({ device }: { device: OrgDevice }): React.ReactElement {
  const chips = specChips(device)
  const network = networkLabel(device.ip)
  const seen = formatRelative(device.lastSeenAt)
  const signedIn = signedInLine(device.lastLoginAt)
  const status = device.online ? 'Active' : seen ? `Seen ${seen}` : 'Idle'

  return (
    <Card size="sm" className="max-w-md">
      <CardContent className="flex items-center gap-3.5">
        <DevicePortrait id={device.id} os={device.os} lit={device.online} />

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="truncate font-display text-[15px] font-semibold tracking-tight">
              {prettyName(device.name)}
            </h3>
            <p className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={`size-1.5 rounded-full ${device.online ? 'bg-emerald-400' : 'bg-muted-foreground/40'}`}
                aria-hidden
              />
              {status}
            </p>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{device.signedInAs}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {signedIn}
            {network ? ` · ${network}` : ''}
          </p>
          {chips.length > 0 ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{chips.join(' · ')}</p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export default function DevicesPage(): React.ReactElement {
  const { session, request } = useDashboard()
  const orgId = session.orgId
  const [devices, setDevices] = useState<OrgDevice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false)
      return
    }
    try {
      const list = await request<OrgDevice[]>(`/v1/orgs/${orgId}/devices`)
      setDevices(list)
      setError(null)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not load devices.')
    } finally {
      setLoading(false)
    }
  }, [orgId, request])

  useEffect(() => {
    void load()
  }, [load])

  useVisibleInterval(() => void load(), 15_000, Boolean(orgId) && !error)

  return (
    <div className="flex w-full max-w-md flex-col gap-5">
      <header>
        <h2 className="font-display text-[22px] font-semibold tracking-tight">Kairo computers</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Macs and PCs signed into this church from the Kairo app.
        </p>
      </header>

      {loading ? (
        <Skeleton className="h-[88px] w-full max-w-md rounded-xl" />
      ) : error ? (
        <div className="py-2">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            type="button"
            variant="ghost"
            className="mt-3 px-0"
            onClick={() => {
              setLoading(true)
              void load()
            }}
          >
            Try again
          </Button>
        </div>
      ) : devices.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm leading-relaxed text-muted-foreground">
              No Kairo computers are signed in yet. Open Kairo on a computer with{' '}
              <span className="text-foreground">{session.user.email}</span> and it will appear here.
            </p>
            <Button
              render={<Link href="/dashboard/download" />}
              nativeButton={false}
              variant="outline"
              className="mt-4"
            >
              Download the desktop app
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {devices.map((device) => (
            <DeviceCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  )
}
