import { useState, useRef, useCallback } from 'react'
import { Search, Send, BookOpen, Loader, X, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ScriptureResult, ScriptureSuggestion, ScriptureTranslation } from '@shared/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

type SendStatus = 'idle' | 'sending' | 'sent' | 'error'

interface ResultCard {
  result: ScriptureResult
  sendStatus: SendStatus
}

// ─── Verse display ────────────────────────────────────────────────────────────

function VerseBlock({
  verse,
  showNumbers,
}: {
  verse: ScriptureResult['verses'][number]
  showNumbers: boolean
}): React.ReactElement {
  return (
    <p className="scripture-text text-[15px] text-slate-200 leading-relaxed font-serif">
      {showNumbers && (
        <sup className="text-teal-400 font-semibold mr-1.5 text-[10px] font-sans vertical-align-super" aria-hidden="true">{verse.verse}</sup>
      )}
      {verse.text}
    </p>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Scripture(): React.ReactElement {
  const [query, setQuery]     = useState('')
  const [cards, setCards]     = useState<ResultCard[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async (): Promise<void> => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    try {
      const results = await window.api.scripture.search(q)
      setCards(results.map((r) => ({ result: r, sendStatus: 'idle' })))
      if (results.length === 0) {
        setError('No results. Try a reference like “John 3:16” or “Romans 8:28”.')
      }
    } catch (err) {
      setError((err as Error).message || 'Search failed')
      setCards([])
    } finally {
      setLoading(false)
    }
  }, [query])

  const handleKeyDown = useCallback((e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleSearch()
  }, [handleSearch])

  const handleSend = useCallback(async (idx: number): Promise<void> => {
    const card = cards[idx]
    if (!card || card.sendStatus === 'sending') return

    setCards((prev) => prev.map((c, i) =>
      i === idx ? { ...c, sendStatus: 'sending' } : c
    ))

    try {
      const suggestion: ScriptureSuggestion = {
        id:          `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        reference:   card.result.reference,
        verses:      card.result.verses,
        translation: card.result.translation as ScriptureTranslation,
        confidence:  1.0,
        source:      'manual',
        triggerText: card.result.reference,
      }
      await window.api.scripture.register(suggestion)
      await window.api.scripture.approve(suggestion.id)
      setCards((prev) => prev.map((c, i) =>
        i === idx ? { ...c, sendStatus: 'sent' } : c
      ))
      // Reset sent badge after 3s
      setTimeout(() => {
        setCards((prev) => prev.map((c, i) =>
          i === idx ? { ...c, sendStatus: 'idle' } : c
        ))
      }, 3000)
    } catch (err) {
      setCards((prev) => prev.map((c, i) =>
        i === idx ? { ...c, sendStatus: 'error' } : c
      ))
    }
  }, [cards])

  const handleClearResults = useCallback((): void => {
    setCards([])
    setError(null)
    inputRef.current?.focus()
  }, [])

  return (
    <div className="p-8 w-full space-y-6">
      <div>
        <h1 className="page-header text-3xl">Scripture</h1>
        <p className="page-subtitle">Search database and project verses to ProPresenter</p>
      </div>

      {/* ── Search bar (Spotlight styled) ────────────────────────────────────── */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden="true" />
          <input
            ref={inputRef}
            className="input pl-10 pr-10 py-2.5 bg-surface-secondary/40 border-surface-border/50 text-base"
            placeholder='Try “John 3:16” or “Romans 8:28–30”'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
            aria-label="Search scripture reference"
            name="scripture-query"
          />
          {query && (
            <button
              type="button"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:text-slate-200"
              onClick={() => { setQuery(''); inputRef.current?.focus() }}
              aria-label="Clear search input"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        <button
          className="btn-primary flex items-center gap-2 px-5 py-2.5 justify-center shrink-0"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? (
            <Loader size={14} className="animate-spin" aria-hidden="true" />
          ) : (
            <Search size={14} aria-hidden="true" />
          )}
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* ── Error / hint ────────────────────────────────────────────────────── */}
      {error && (
        <div
          className="flex items-start gap-2.5 px-4 py-3.5 rounded-xl bg-yellow-500/5 border border-yellow-500/15 text-yellow-400 text-sm shadow-glow-yellow/5 animate-slide-in"
          role="alert"
          aria-live="polite"
        >
          <AlertCircle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      <div className="space-y-4">
        {cards.length === 0 && !loading && !error && (
          <div className="double-bezel-outer">
            <div className="double-bezel-inner flex flex-col items-center py-14 text-center">
              <div className="w-12 h-12 rounded-full bg-surface-secondary/60 flex items-center justify-center mb-4">
                <BookOpen size={20} className="text-slate-500" aria-hidden="true" />
              </div>
              <p className="text-slate-300 text-sm font-semibold">Enter a reference or keyword above</p>
              <p className="text-slate-500 text-xs mt-1.5 font-sans">
                e.g. “Romans 8:28” or “John 3:16–18”
              </p>
            </div>
          </div>
        )}

        {cards.length > 0 && (
          <div className="flex items-center justify-between mb-1 px-1">
            <p className="text-xs text-slate-500 font-sans font-semibold">
              {cards.length} result{cards.length !== 1 ? 's' : ''} found
            </p>
            <button
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors font-medium focus-visible:outline-none focus-visible:text-slate-200"
              onClick={handleClearResults}
            >
              Clear Results
            </button>
          </div>
        )}

        {cards.map((card, idx) => (
          <div key={idx} className="double-bezel-outer group animate-fade-in">
            <div className="double-bezel-inner flex items-start justify-between gap-6 p-5">
              <div className="flex-1 min-w-0 space-y-3.5">
                <div className="flex items-baseline gap-2">
                  <p className="text-sm font-bold text-teal-400 tracking-tight font-sans">
                    {card.result.reference}
                  </p>
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold font-sans">
                    {card.result.translation}
                  </span>
                </div>
                {card.result.verses.length === 0 ? (
                  <p className="text-sm text-slate-500 italic font-sans">
                    Verse text not available — Bible database may not be configured.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {card.result.verses.map((v, vi) => (
                      <VerseBlock
                        key={vi}
                        verse={v}
                        showNumbers={card.result.verses.length > 1}
                      />
                    ))}
                  </div>
                )}
              </div>

              <button
                className={cn(
                  'flex items-center gap-1.5 shrink-0 px-4 py-2 rounded-lg text-xs font-semibold border transition-all duration-200 ease-out-expo',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:opacity-100',
                  card.sendStatus === 'idle' &&
                    'opacity-0 group-hover:opacity-100 btn-secondary',
                  card.sendStatus === 'sending' &&
                    'opacity-100 bg-teal-600/10 border-teal-500/20 text-teal-300 cursor-wait shadow-glow-teal/10',
                  card.sendStatus === 'sent' &&
                    'opacity-100 bg-teal-500/10 border-teal-500/30 text-teal-300 shadow-glow-teal/15',
                  card.sendStatus === 'error' &&
                    'opacity-100 bg-red-500/10 border-red-500/30 text-red-300 shadow-glow-red/15'
                )}
                onClick={() => handleSend(idx)}
                disabled={card.sendStatus === 'sending' || card.sendStatus === 'sent'}
                aria-label={`Send ${card.result.reference} (${card.result.translation}) to ProPresenter`}
              >
                {card.sendStatus === 'sending' && <Loader size={12} className="animate-spin" aria-hidden="true" />}
                {card.sendStatus === 'sent' && <Send size={12} aria-hidden="true" />}
                {card.sendStatus === 'error' && <AlertCircle size={12} aria-hidden="true" />}
                {card.sendStatus === 'idle' && <Send size={12} aria-hidden="true" />}
                {card.sendStatus === 'idle' && 'Send'}
                {card.sendStatus === 'sending' && 'Sending…'}
                {card.sendStatus === 'sent' && 'Sent!'}
                {card.sendStatus === 'error' && 'Failed'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
