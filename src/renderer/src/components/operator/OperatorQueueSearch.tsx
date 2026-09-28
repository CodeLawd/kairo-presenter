import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader, Search, X } from '@/icons'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  getBookCompletion,
  getBookCompletions,
  resolveSubmittedScriptureQuery,
  shouldLiveSuggestScriptureQuery,
} from '@shared/scripture-query'
import type { ScriptureResult, ScriptureTranslation } from '@shared/ipc'

export interface OperatorQueueSearchProps {
  translation: ScriptureTranslation
  inputRef?: React.Ref<HTMLInputElement>
  disabled?: boolean
  /** Stages search hits as-is — ranges stay one queue row (e.g. John 1:2–5). */
  onEnqueue: (results: ScriptureResult[]) => void
}

/**
 * Compact scripture search for the Operator queue — same autocomplete,
 * Tab book-complete, and Enter behavior as the Scripture tab, but stages
 * into the queue instead of opening the verse grid.
 */
export function OperatorQueueSearch({
  translation,
  inputRef,
  disabled = false,
  onEnqueue,
}: OperatorQueueSearchProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ScriptureResult[]>([])
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(0)
  const [suggesting, setSuggesting] = useState(false)
  const suggestionRequestRef = useRef(0)
  const bookCompletion = useMemo(() => getBookCompletion(query), [query])
  const bookCompletions = useMemo(() => getBookCompletions(query), [query])

  useEffect(() => {
    const requestId = ++suggestionRequestRef.current
    if (!shouldLiveSuggestScriptureQuery(query)) {
      setSuggestions([])
      setSuggestionsOpen(false)
      setSuggesting(false)
      return
    }

    setSuggesting(true)
    const timer = window.setTimeout(() => {
      void window.api.scripture
        .search(query.trim(), translation)
        .then((results) => {
          if (suggestionRequestRef.current !== requestId) return
          setSuggestions(results.slice(0, 5))
          setActiveSuggestion(0)
          setSuggestionsOpen(true)
          setError(null)
        })
        .catch(() => {
          if (suggestionRequestRef.current !== requestId) return
          setSuggestions([])
          setSuggestionsOpen(true)
        })
        .finally(() => {
          if (suggestionRequestRef.current === requestId) setSuggesting(false)
        })
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query, translation])

  const stageResults = useCallback(
    (results: ScriptureResult[]): void => {
      if (results.length === 0) return
      // Keep ranges intact (John 1:2–5 → one queue row with all verses).
      onEnqueue(results)
      setQuery('')
      setSuggestions([])
      setSuggestionsOpen(false)
      setError(null)
    },
    [onEnqueue]
  )

  const commitSuggestion = useCallback(
    (result: ScriptureResult): void => {
      stageResults([result])
    },
    [stageResults]
  )

  const runSearch = useCallback(
    async (submittedQuery?: string): Promise<void> => {
      const q = (submittedQuery ?? query).trim()
      if (!q || disabled) return
      setLoading(true)
      setError(null)
      try {
        const results = await window.api.scripture.search(q, translation)
        if (results.length === 0) {
          setError('No match — try “John 3:16” or a short phrase.')
          setSuggestionsOpen(false)
          return
        }
        stageResults(results)
      } catch (err) {
        setError((err as Error).message || 'Search failed')
      } finally {
        setLoading(false)
      }
    },
    [disabled, query, stageResults, translation]
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Tab' && bookCompletion) {
        event.preventDefault()
        setQuery(bookCompletion.value)
        return
      }
      if (event.key === 'Escape' && suggestionsOpen) {
        event.preventDefault()
        setSuggestionsOpen(false)
        return
      }
      if (suggestionsOpen && suggestions.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setActiveSuggestion((current) => (current + 1) % suggestions.length)
          return
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setActiveSuggestion(
            (current) => (current - 1 + suggestions.length) % suggestions.length
          )
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          commitSuggestion(suggestions[activeSuggestion])
          return
        }
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const submitted = resolveSubmittedScriptureQuery(query)
        setQuery(submitted)
        void runSearch(submitted)
      }
    },
    [
      activeSuggestion,
      bookCompletion,
      commitSuggestion,
      query,
      runSearch,
      suggestions,
      suggestionsOpen,
    ]
  )

  return (
    <div className="relative space-y-1.5">
      <div className="relative">
        <Search
          size={13}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
          aria-hidden="true"
        />
        <Input
          ref={inputRef as React.Ref<HTMLInputElement>}
          type="text"
          placeholder='John 3:16 · or “love is patient”'
          className="h-8 pl-8 pr-8 text-[11px]"
          value={query}
          disabled={disabled || loading}
          onChange={(event) => {
            const value = event.target.value
            setQuery(value)
            setError(null)
            if (shouldLiveSuggestScriptureQuery(value)) setSuggestionsOpen(true)
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setSuggestionsOpen(true)
          }}
          autoComplete="off"
          spellCheck={false}
          aria-label="Add a scripture reference to the queue"
          aria-autocomplete="list"
          aria-controls="operator-queue-suggestions"
          aria-expanded={suggestionsOpen}
          aria-activedescendant={
            suggestionsOpen ? `operator-queue-suggestion-${activeSuggestion}` : undefined
          }
          role="combobox"
          name="operator-queue-query"
        />
        {query && !loading && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
            onClick={() => {
              setQuery('')
              setSuggestions([])
              setSuggestionsOpen(false)
              setError(null)
            }}
            aria-label="Clear queue search"
          >
            <X size={12} aria-hidden="true" />
          </Button>
        )}
        {loading && (
          <Loader
            size={12}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-teal-400"
            aria-hidden="true"
          />
        )}
      </div>

      {bookCompletion && !suggestionsOpen && (
        <div className="flex items-center justify-between rounded-md border border-surface-border bg-surface-elevated px-2.5 py-1.5 text-[10px] shadow-lg">
          <span className="text-slate-400">
            Complete{' '}
            <span className="font-semibold text-slate-200">{bookCompletion.book}</span>
          </span>
          <kbd className="rounded border border-surface-border bg-surface-tertiary px-1.5 py-0.5 font-mono text-[9px] text-teal-300">
            Tab
          </kbd>
        </div>
      )}

      {bookCompletions.length > 1 && !suggestionsOpen && (
        <div className="absolute left-0 right-0 top-[calc(100%+0.15rem)] z-40 overflow-hidden rounded-lg border border-surface-border bg-surface-elevated shadow-2xl">
          <div className="border-b border-surface-border/70 px-2.5 py-1.5 text-[10px] font-medium text-zinc-500">
            Choose a Bible book
          </div>
          {bookCompletions.map((completion) => (
            <button
              key={completion.book}
              type="button"
              className="flex w-full items-center justify-between border-b border-surface-border/40 px-2.5 py-2 text-left text-[10px] last:border-b-0 hover:bg-surface-tertiary"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const submitted = resolveSubmittedScriptureQuery(completion.value)
                setQuery(submitted)
                void runSearch(submitted)
              }}
            >
              <span className="font-semibold text-teal-300">{completion.book}</span>
              <span className="text-slate-500">{completion.value}</span>
            </button>
          ))}
        </div>
      )}

      {suggestionsOpen && shouldLiveSuggestScriptureQuery(query) && (
        <div
          id="operator-queue-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+0.15rem)] z-40 max-h-56 overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated shadow-2xl"
        >
          <div className="sticky top-0 flex items-center justify-between bg-surface-elevated px-2.5 py-1.5 text-[10px] font-medium text-zinc-500">
            <span>Scripture matches</span>
            <span>{suggesting ? 'Searching…' : 'Enter to queue'}</span>
          </div>
          {suggesting && suggestions.length === 0 && (
            <p className="px-2.5 py-3 text-[10px] text-slate-500">
              Searching your Bible translation…
            </p>
          )}
          {!suggesting && suggestions.length === 0 && (
            <p className="px-2.5 py-3 text-[10px] text-slate-500">
              No verse matched that phrase. Try another wording, or a reference like Psalm 23:1.
            </p>
          )}
          {suggestions.map((result, index) => (
            <button
              key={`${result.reference}-${result.translation}-${index}`}
              id={`operator-queue-suggestion-${index}`}
              type="button"
              role="option"
              aria-selected={index === activeSuggestion}
              className={cn(
                'flex w-full items-start gap-2 border-b border-surface-border/40 px-2.5 py-2 text-left last:border-b-0',
                index === activeSuggestion
                  ? 'row-selected'
                  : 'hover:bg-surface-tertiary'
              )}
              onMouseEnter={() => setActiveSuggestion(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitSuggestion(result)}
            >
              <span className="w-24 shrink-0 text-[10px] font-semibold text-teal-300">
                {result.reference}
                <span className="mt-0.5 block font-normal text-slate-600">
                  {result.translation}
                </span>
              </span>
              <span className="line-clamp-2 text-[10px] leading-snug text-slate-400">
                {result.verses.map((verse) => verse.text).join(' ')}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="px-0.5 text-[10px] leading-snug text-rose-400/90">{error}</p>
      )}
    </div>
  )
}
