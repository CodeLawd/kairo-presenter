import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, Clock, Loader, Search, X } from '@/icons';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BookCompletion } from "@shared/scripture-query";
import type {
  ScriptureResult,
  ScriptureTranslation,
  ScriptureTranslationOption,
} from "@shared/ipc";

export interface ScriptureSearchBarProps {
  query: string;
  loading: boolean;
  /** Recent reference lookups, newest first — the ▾ list. */
  recentLookups: string[];
  onPickRecent: (reference: string) => void;
  bookCompletions: BookCompletion[];
  searchSuggestions: ScriptureResult[];
  /** Whether the live verse matches are current (closed after a search). */
  suggestionsOpen: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onClearQuery: () => void;
  /** Fill in a book name ("jn 3" → "John 3") and keep typing. */
  onBookComplete: (value: string) => void;
  /** Keys the suggestion list does not use — Enter submits the query. */
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  /** Load just this verse. */
  onPreviewSuggestion: (result: ScriptureResult) => void;
  /** Load the verse's whole chapter, with the verse picked. */
  onOpenChapter: (result: ScriptureResult) => void;
}

/** "John 3:16" or "John 3:16-18" — something smaller than its chapter. */
const isWithinChapter = (result: ScriptureResult): boolean => result.reference.includes(":");

type Item =
  | { kind: "book"; completion: BookCompletion }
  | { kind: "verse"; result: ScriptureResult }
  | { kind: "recent"; reference: string };

const BAR_FIELD =
  "relative flex h-8 min-w-0 items-center rounded-md border border-input bg-surface-secondary transition-colors focus-within:border-slate-400";

/**
 * The reference lookup, like ProPresenter's Scripture Lookup: "jos 1 5 9" or
 * "John 3:16", with ▾ for recent lookups.
 *
 * Under it, one list: book completions, then live verse matches (or, after ▾,
 * recent lookups). Enter
 * searches what was typed; ↑/↓ pick a row and Enter opens it (Shift+Enter opens
 * a verse's whole chapter); Tab fills in the book; Esc or clicking away closes
 * the list.
 */
export function ScriptureSearchBar({
  query,
  loading,
  recentLookups,
  onPickRecent,
  bookCompletions,
  searchSuggestions,
  suggestionsOpen,
  inputRef,
  onQueryChange,
  onClearQuery,
  onBookComplete,
  onKeyDown,
  onFocus,
  onPreviewSuggestion,
  onOpenChapter,
}: ScriptureSearchBarProps): React.ReactElement {
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** The ▾ was pressed: show recent lookups. */
  const [recentsOpen, setRecentsOpen] = useState(false);
  /** -1 = nothing picked, so Enter searches what was typed. */
  const [active, setActive] = useState(-1);

  const items: Item[] = recentsOpen
    ? recentLookups.map((reference) => ({ kind: "recent" as const, reference }))
    : [
        ...bookCompletions.slice(0, 4).map((completion) => ({ kind: "book" as const, completion })),
        ...(suggestionsOpen
          ? searchSuggestions.map((result) => ({ kind: "verse" as const, result }))
          : []),
      ];
  const open = (focused || recentsOpen) && !dismissed && items.length > 0;

  // New text, new list: reopen it and drop the pick.
  useEffect(() => {
    setDismissed(false);
    setRecentsOpen(false);
    setActive(-1);
  }, [query]);
  useEffect(() => setActive(-1), [searchSuggestions]);

  const choose = (item: Item, wholeChapter = false): void => {
    setRecentsOpen(false);
    if (item.kind === "recent") onPickRecent(item.reference);
    else if (item.kind === "book") onBookComplete(item.completion.value);
    else if (wholeChapter && isWithinChapter(item.result)) onOpenChapter(item.result);
    else onPreviewSuggestion(item.result);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        // Cycle through "nothing picked" (-1) and every row.
        const step = event.key === "ArrowDown" ? 1 : -1;
        const slots = items.length + 1;
        setActive((current) => ((current + 1 + step + slots) % slots) - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        setRecentsOpen(false);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        const picked = items[active];
        const book = picked?.kind === "book" ? picked : items.find((item) => item.kind === "book");
        if (book) {
          event.preventDefault();
          choose(book);
          return;
        }
      }
      if (event.key === "Enter" && items[active]) {
        event.preventDefault();
        choose(items[active], event.shiftKey);
        return;
      }
    }
    onKeyDown(event);
  };

  return (
    <div className={BAR_FIELD}>
      {loading ? (
        <Loader size={13} className="ml-2.5 shrink-0 animate-spin text-slate-400" aria-hidden="true" />
      ) : (
        <BookOpen size={13} className="ml-2.5 shrink-0 text-slate-500" aria-hidden="true" />
      )}
      <input
        ref={inputRef as React.Ref<HTMLInputElement>}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
        placeholder="Reference — John 3:16"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => {
          setFocused(false);
          setRecentsOpen(false);
        }}
        autoComplete="off"
        spellCheck={false}
        aria-label="Scripture reference"
        aria-autocomplete="list"
        aria-controls="scripture-search-suggestions"
        aria-expanded={open}
        aria-activedescendant={open && active >= 0 ? `scripture-suggestion-${active}` : undefined}
        role="combobox"
        name="scripture-query"
      />
      {query && (
        <Button type="button" variant="ghost" size="icon-xs" className="shrink-0" onClick={onClearQuery} aria-label="Clear reference">
          <X aria-hidden="true" />
        </Button>
      )}
      <button
        type="button"
        className="mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-slate-500 hover:bg-surface-tertiary hover:text-white disabled:opacity-40"
        disabled={recentLookups.length === 0}
        aria-label="Recent lookups"
        title={recentLookups.length === 0 ? "No recent lookups yet" : "Recent lookups"}
        // Keep focus in the field so the list stays open.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setDismissed(false);
          setRecentsOpen((current) => !current);
        }}
      >
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      {open && (
        <div
          id="scripture-search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-80 overflow-y-auto rounded-lg bg-surface-elevated p-1"
          // Keep focus in the field so a click lands before blur closes the list.
          onMouseDown={(event) => event.preventDefault()}
        >
          {items.map((item, index) => (
            <div
              key={
                item.kind === "book"
                  ? `book-${item.completion.book}`
                  : item.kind === "recent"
                    ? `recent-${item.reference}`
                    : `verse-${item.result.reference}-${item.result.translation}`
              }
              id={`scripture-suggestion-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn(
                "flex items-center rounded-md text-xs",
                index === active ? "bg-surface-tertiary" : "hover:bg-surface-tertiary",
              )}
              onMouseEnter={() => setActive(index)}
            >
              <button
                type="button"
                tabIndex={-1}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5 text-left"
                onClick={() => choose(item)}
              >
                {item.kind === "recent" ? (
                  <>
                    <Clock size={12} className="shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-200">{item.reference}</span>
                  </>
                ) : item.kind === "book" ? (
                  <>
                    <BookOpen size={12} className="shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-200">
                      {item.completion.value.trim()}
                    </span>
                    {index === 0 && (
                      <kbd className="shrink-0 rounded px-1 font-mono text-[10px] text-slate-500">
                        Tab
                      </kbd>
                    )}
                  </>
                ) : (
                  <>
                    <span className="w-20 shrink-0 truncate font-semibold text-teal-300">
                      {item.result.reference}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-slate-400">
                      {item.result.verses.map((verse) => verse.text).join(" ")}
                    </span>
                  </>
                )}
              </button>
              {/* Two explicit choices, always shown: the found verse on its own, or
                  the chapter it sits in. Clicking the row itself adds the verse. */}
              {item.kind === "verse" && isWithinChapter(item.result) && (
                <div className="mr-1 flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    tabIndex={-1}
                    className="rounded border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-slate-300 hover:border-teal-500 hover:text-white"
                    onClick={() => choose(item)}
                    title={`Add ${item.result.reference} only (Enter)`}
                  >
                    Verse
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="rounded border border-transparent px-1.5 py-0.5 text-[11px] font-medium text-slate-300 hover:border-teal-500 hover:text-white"
                    onClick={() => choose(item, true)}
                    title={`Add all of ${item.result.reference.split(":")[0]} (Shift+Enter)`}
                  >
                    Chapter
                  </button>
                </div>
              )}
            </div>
          ))}
          {items.some((item) => item.kind === "verse" && isWithinChapter(item.result)) && (
            <p className="mt-1 px-2 pb-0.5 pt-1.5 text-[10px] text-slate-500">
              <kbd className="font-mono text-slate-400">↵</kbd> adds the verse ·{" "}
              <kbd className="font-mono text-slate-400">⇧↵</kbd> adds the whole chapter
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Full-text search, kept apart from the reference lookup — ProPresenter's Search field. */
export function ScripturePhraseSearch({
  value,
  loading,
  onChange,
  onSubmit,
}: {
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}): React.ReactElement {
  return (
    <form
      className={BAR_FIELD}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSubmit(value.trim());
      }}
    >
      <Search size={13} className="ml-2.5 shrink-0 text-slate-500" aria-hidden="true" />
      <input
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-[13px] text-slate-100 outline-none placeholder:text-slate-500"
        placeholder="Search text — love is patient"
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search scripture text"
        name="scripture-phrase"
      />
      {value && (
        <Button type="button" variant="ghost" size="icon-xs" className="mr-1 shrink-0" onClick={() => onChange("")} aria-label="Clear search text">
          <X aria-hidden="true" />
        </Button>
      )}
    </form>
  );
}

/** The Bible every lookup and search reads from, by its full name. */
export function ScriptureTranslationSelect({
  translation,
  translations,
  disabled,
  onChange,
}: {
  translation: ScriptureTranslation;
  translations: ScriptureTranslationOption[];
  disabled: boolean;
  onChange: (value: ScriptureTranslation) => void;
}): React.ReactElement {
  // Only translations Kairo can actually load; the rest are noise here.
  const available = translations.filter((option) => option.available);
  const current = translations.find((option) => option.id === translation);
  return (
    <Select value={translation} disabled={disabled} onValueChange={(value) => onChange(value as ScriptureTranslation)}>
      <SelectTrigger
        className="h-8 w-full min-w-0 justify-between gap-2 rounded-md border border-input bg-surface-secondary px-2.5 text-[13px] text-slate-200 dark:bg-surface-secondary dark:hover:bg-surface-tertiary"
        aria-label="Scripture translation"
      >
        <SelectValue>
          <span className="truncate">{current?.name ?? (translation || "NKJV")}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="end"
        sideOffset={4}
        className="max-h-[min(26rem,var(--radix-select-content-available-height))] min-w-0"
      >
        <SelectGroup>
          {available.map((option) => (
            <SelectItem key={option.id} value={option.id} className="text-xs">
              <span className="inline-block w-11 font-semibold text-slate-200">{option.id}</span>
              <span className="text-slate-400">{option.name}</span>
            </SelectItem>
          ))}
          {available.length === 0 && (
            <SelectItem value={translation || "NKJV"} className="text-xs">
              {translation || "NKJV"} · Loading translations…
            </SelectItem>
          )}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
