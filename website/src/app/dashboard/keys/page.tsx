'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { useRevalidateOnFocus } from '@/hooks/use-refresh'
import { useDashboard } from '@/components/dashboard/dashboard-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'

type Secrets = {
  deepgramApiKey: string
  anthropicApiKey: string
  deepseekApiKey: string
  bibleApiKey: string
  braveApiKey: string
  googleTranslateApiKey: string
  updatedAt: string | null
}

type SecretKey = keyof Omit<Secrets, 'updatedAt'>

const GROUPS: { title: string; hint: string; fields: { key: SecretKey; label: string; hint: string }[] }[] = [
  {
    title: 'Live service',
    hint: 'Needed for transcription and scripture lookup on the booth.',
    fields: [
      { key: 'deepgramApiKey', label: 'Deepgram', hint: 'Speech-to-text for the live transcript' },
      { key: 'bibleApiKey', label: 'Bible API', hint: 'Verse lookup during the sermon' },
    ],
  },
  {
    title: 'Optional',
    hint: 'Only if you use these providers.',
    fields: [
      { key: 'anthropicApiKey', label: 'Anthropic', hint: 'Optional recap model' },
      { key: 'deepseekApiKey', label: 'DeepSeek', hint: 'Optional recap model' },
      { key: 'braveApiKey', label: 'Brave Search', hint: 'Optional web lookup' },
      { key: 'googleTranslateApiKey', label: 'Google Translate', hint: 'Optional translation' },
    ],
  },
]

const EMPTY: Secrets = {
  deepgramApiKey: '',
  anthropicApiKey: '',
  deepseekApiKey: '',
  bibleApiKey: '',
  braveApiKey: '',
  googleTranslateApiKey: '',
  updatedAt: null,
}

/**
 * Floor between vault reads. The refetch is event-driven — mount and tab focus —
 * so this only swallows bursts (focus firing alongside visibilitychange).
 */
const MIN_REFRESH_INTERVAL_MS = 10_000

function SecretField({
  field,
  value,
  onChange,
}: {
  field: { key: SecretKey; label: string; hint: string }
  value: string
  onChange: (value: string) => void
}): React.ReactElement {
  const [visible, setVisible] = useState(false)
  const saved = value.trim().length > 0

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={field.key}>{field.label}</Label>
          <p className="text-xs text-muted-foreground">{field.hint}</p>
        </div>
        {saved ? <Badge variant="secondary">Saved</Badge> : null}
      </div>
      <div className="relative">
        <Input
          id={field.key}
          type={visible ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="••••••••••••"
          className="pr-9 font-mono"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
          aria-label={visible ? `Hide ${field.label}` : `Show ${field.label}`}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </div>
    </div>
  )
}

export default function KeysPage(): React.ReactElement {
  const { session, request } = useDashboard()
  const orgId = session.orgId
  const [secrets, setSecrets] = useState<Secrets>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  /** True once a field is edited — stops a refresh from overwriting what is being typed. */
  const dirty = useRef(false)
  const busyRef = useRef(false)
  const cancelled = useRef(false)
  const [hasEdits, setHasEdits] = useState(false)

  const load = useCallback(
    async (initial: boolean): Promise<void> => {
      if (!orgId) {
        setLoading(false)
        return
      }
      // Never clobber unsaved edits, and never race an in-flight save.
      if (!initial && (dirty.current || busyRef.current)) return
      try {
        const result = await request<Secrets>(`/v1/orgs/${orgId}/secrets`)
        if (cancelled.current || (!initial && (dirty.current || busyRef.current))) return
        setSecrets(result)
        setError(null)
      } catch (failure) {
        if (!cancelled.current && initial) {
          setError(failure instanceof ApiError ? failure.message : 'Could not load keys.')
        }
      } finally {
        if (!cancelled.current && initial) setLoading(false)
      }
    },
    [orgId, request],
  )

  useEffect(() => {
    cancelled.current = false
    void load(true)
    return () => {
      cancelled.current = true
    }
  }, [load])

  // Returning to the tab is when a key saved on the desktop app should appear.
  // No timer: an open tab left alone makes no requests.
  useRevalidateOnFocus(() => void load(false), MIN_REFRESH_INTERVAL_MS)

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!orgId) return
    setBusy(true)
    busyRef.current = true
    setError(null)
    setSaved(false)
    try {
      const result = await request<Secrets>(`/v1/orgs/${orgId}/secrets`, {
        method: 'PUT',
        body: {
          deepgramApiKey: secrets.deepgramApiKey,
          anthropicApiKey: secrets.anthropicApiKey,
          deepseekApiKey: secrets.deepseekApiKey,
          bibleApiKey: secrets.bibleApiKey,
          braveApiKey: secrets.braveApiKey,
          googleTranslateApiKey: secrets.googleTranslateApiKey,
        },
      })
      setSecrets(result)
      dirty.current = false
      setHasEdits(false)
      setSaved(true)
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Could not save keys.')
    } finally {
      setBusy(false)
      busyRef.current = false
    }
  }

  const updated = secrets.updatedAt
    ? `Last saved ${new Date(secrets.updatedAt).toLocaleString()}`
    : 'Not saved yet'

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div>
        <h2 className="font-display text-[28px] font-semibold tracking-tight">API keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Encrypted for your church. Booth machines sync these instead of typing keys locally.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Vault</CardTitle>
          <CardDescription>{updated}.</CardDescription>
        </CardHeader>
        <form onSubmit={(event) => void save(event)}>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-5">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ))}
              </div>
            ) : !orgId ? (
              <p className="text-sm text-muted-foreground">Link a church first.</p>
            ) : (
              <div className="flex flex-col gap-6">
                {GROUPS.map((group, index) => (
                  <div key={group.title} className="flex flex-col gap-4">
                    {index > 0 ? <Separator /> : null}
                    <div>
                      <p className="text-sm font-medium">{group.title}</p>
                      <p className="text-xs text-muted-foreground">{group.hint}</p>
                    </div>
                    {group.fields.map((field) => (
                      <SecretField
                        key={field.key}
                        field={field}
                        value={secrets[field.key]}
                        onChange={(value) => {
                          dirty.current = true
                          setHasEdits(true)
                          setSaved(false)
                          setSecrets((current) => ({ ...current, [field.key]: value }))
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
            {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
          </CardContent>
          <CardFooter className="justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {saved ? 'Keys saved.' : hasEdits ? 'Unsaved changes' : 'Keys stay on the church, not this browser.'}
            </p>
            <Button type="submit" disabled={busy || !orgId || loading || !hasEdits}>
              {busy ? 'Saving…' : 'Save keys'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
