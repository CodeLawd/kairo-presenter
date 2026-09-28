import { useEffect, useState } from "react";
import { BookOpen, Loader, Search, X } from '@/icons';
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
  translation: ScriptureTranslation;
  translations: ScriptureTranslationOption[];
  loading: boolean;
  bookCompletions: BookCompletion[];
  searchSuggestions: ScriptureResult[];
  /** Whether the live verse matches are current (closed after a search). */
  suggestionsOpen: boolean;
  inputRef: React.Ref<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onTranslationChange: (value: ScriptureTranslation) => void;
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
  | { kind: "verse"; result: ScriptureResult };

/**
 * One field, like ProPresenter's lookup: search · clear · translation.
 *
 * Under it, one list: book completions, then live verse matches. Enter
 * searches what was typed; ↑/↓ pick a row and Enter opens it (Shift+Enter opens
 * a verse's whole chapter); Tab fills in the book; Esc or clicking away closes
 * the list.
 */
export function ScriptureSearchBar({
  query,
  translation,
  translations,
  loading,
  bookCompletions,
  searchSuggestions,
  suggestionsOpen,
  inputRef,
  onQueryChange,
  onTranslationChange,
  onClearQuery,
  onBookComplete,
  onKeyDown,
  onFocus,
  onPreviewSuggestion,
  onOpenChapter,
}: ScriptureSearchBarProps): React.ReactElement {
  // Only translations Kairo can actually load; the rest are noise here.
  const available = translations.filter((option) => option.available);

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  /** -1 = nothing picked, so Enter searches what was typed. */
  const [active, setActive] = useState(-1);

  const items: Item[] = [
    ...bookCompletions.slice(0, 4).map((completion) => ({ kind: "book" as const, completion })),
    ...(suggestionsOpen
      ? searchSuggestions.map((result) => ({ kind: "verse" as const, result }))
      : []),
  ];
  const open = focused && !dismissed && items.length > 0;

  // New text, new list: reopen it and drop the pick.
  useEffect(() => {
    setDismissed(false);
    setActive(-1);
  }, [query]);
  useEffect(() => setActive(-1), [searchSuggestions]);

  const choose = (item: Item, wholeChapter = false): void => {
    if (item.kind === "book") onBookComplete(item.completion.value);
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
    <div className="no-drag relative flex h-7 min-w-0 items-center rounded-md border border-surface-border bg-surface-secondary transition-colors focus-within:border-teal-500">
      {loading ? (
        <Loader size={13} className="ml-2.5 shrink-0 animate-spin text-slate-400" aria-hidden="true" />
      ) : (
        <Search size={13} className="ml-2.5 shrink-0 text-slate-500" aria-hidden="true" />
      )}
      <input
        ref={inputRef as React.Ref<HTMLInputElement>}
        className="h-full min-w-0 flex-1 bg-transparent px-2 text-xs text-slate-100 outline-none placeholder:text-slate-500"
        placeholder='Scripture lookup · “jos 1 5 9” or a phrase'
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => setFocused(false)}
        autoComplete="off"
        spellCheck={false}
        aria-label="Search scripture reference"
        aria-autocomplete="list"
        aria-controls="scripture-search-suggestions"
        aria-expanded={open}
        aria-activedescendant={open && active >= 0 ? `scripture-suggestion-${active}` : undefined}
        role="combobox"
        name="scripture-query"
      />
      {query && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="mr-1 shrink-0"
          onClick={onClearQuery}
          aria-label="Clear search input"
        >
          <X aria-hidden="true" />
        </Button>
      )}
      <span className="h-4 w-px shrink-0 bg-surface-border" aria-hidden="true" />
      <Select
        value={translation}
        disabled={loading}
        onValueChange={(value) =>
          onTranslationChange(value as ScriptureTranslation)
        }
      >
        <SelectTrigger
          size="sm"
          className="h-full shrink-0 gap-1 rounded-l-none rounded-r-md border-0 bg-transparent pl-2 pr-1.5 text-xs font-semibold text-slate-300 hover:text-white dark:bg-transparent dark:hover:bg-surface-tertiary"
          aria-label="Scripture translation"
          title={translations.find((option) => option.id === translation)?.name}
        >
          <SelectValue>{translation || "NKJV"}</SelectValue>
        </SelectTrigger>
        {/* Popper, not item-aligned: aligning the checked item over a trigger
            that lives in the header pushed the list off the top of the window. */}
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

      {open && (
        <div
          id="scripture-search-suggestions"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-40 max-h-80 overflow-y-auto rounded-lg border border-surface-border bg-surface-elevated p-1"
          // Keep focus in the field so a click lands before blur closes the list.
          onMouseDown={(event) => event.preventDefault()}
        >
          {items.map((item, index) => (
            <div
              key={item.kind === "book" ? `book-${item.completion.book}` : `verse-${item.result.reference}-${item.result.translation}`}
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
                {item.kind === "book" ? (
                  <>
                    <BookOpen size={12} className="shrink-0 text-slate-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-200">
                      {item.completion.value.trim()}
                    </span>
                    {index === 0 && (
                      <kbd className="shrink-0 rounded border border-surface-border px-1 font-mono text-[10px] text-slate-500">
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
                    className="rounded border border-surface-border px-1.5 py-0.5 text-[11px] font-medium text-slate-300 hover:border-teal-500 hover:text-white"
                    onClick={() => choose(item)}
                    title={`Add ${item.result.reference} only (Enter)`}
                  >
                    Verse
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="rounded border border-surface-border px-1.5 py-0.5 text-[11px] font-medium text-slate-300 hover:border-teal-500 hover:text-white"
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
            <p className="mt-1 border-t border-surface-border px-2 pb-0.5 pt-1.5 text-[10px] text-slate-500">
              <kbd className="font-mono text-slate-400">↵</kbd> adds the verse ·{" "}
              <kbd className="font-mono text-slate-400">⇧↵</kbd> adds the whole chapter
            </p>
          )}
        </div>
      )}
    </div>
  );
}
