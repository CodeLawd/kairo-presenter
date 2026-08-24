import { Loader, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  bookCompletion: BookCompletion | null;
  searchSuggestions: ScriptureResult[];
  suggestionsOpen: boolean;
  activeSuggestion: number;
  inputRef: React.Ref<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  onTranslationChange: (value: ScriptureTranslation) => void;
  onSearch: () => void;
  onClearQuery: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onActiveSuggestionChange: (index: number) => void;
  onPreviewSuggestion: (result: ScriptureResult) => void;
}

export function ScriptureSearchBar({
  query,
  translation,
  translations,
  loading,
  bookCompletion,
  searchSuggestions,
  suggestionsOpen,
  activeSuggestion,
  inputRef,
  onQueryChange,
  onTranslationChange,
  onSearch,
  onClearQuery,
  onKeyDown,
  onFocus,
  onActiveSuggestionChange,
  onPreviewSuggestion,
}: ScriptureSearchBarProps): React.ReactElement {
  return (
    <div className="flex gap-3">
      <Select
        value={translation}
        onValueChange={(value) =>
          onTranslationChange(value as ScriptureTranslation)
        }
      >
        <SelectTrigger
          className="h-10 w-56 shrink-0"
          aria-label="Scripture translation"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {translations.map((option) => (
              <SelectItem
                key={option.id}
                value={option.id}
                disabled={!option.available}
                className={cn(
                  !option.available && "text-slate-500 opacity-45",
                )}
              >
                <span className={cn(!option.available && "text-slate-500")}>
                  {option.id} · {option.name}
                  {option.available ? "" : " — unavailable"}
                </span>
              </SelectItem>
            ))}
            {translations.length === 0 && (
              <SelectItem value="NKJV">
                NKJV · New King James Version
              </SelectItem>
            )}
          </SelectGroup>
        </SelectContent>
      </Select>
      <div className="relative flex-1">
        <Search
          size={15}
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"
          aria-hidden="true"
        />
        <Input
          ref={inputRef as React.Ref<HTMLInputElement>}
          className="h-10 pl-10 pr-10 text-base"
          placeholder='Reference or remembered words · try “jos 1 5 9”'
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          autoComplete="off"
          spellCheck={false}
          aria-label="Search scripture reference"
          aria-autocomplete="list"
          aria-controls="scripture-search-suggestions"
          aria-expanded={suggestionsOpen}
          aria-activedescendant={
            suggestionsOpen
              ? `scripture-suggestion-${activeSuggestion}`
              : undefined
          }
          role="combobox"
          name="scripture-query"
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={onClearQuery}
            aria-label="Clear search input"
          >
            <X aria-hidden="true" />
          </Button>
        )}
        {bookCompletion && !suggestionsOpen && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-30 flex items-center justify-between rounded-lg border border-surface-border bg-surface-elevated px-3.5 py-2 text-xs shadow-xl">
            <span className="text-slate-400">
              Complete{" "}
              <span className="font-semibold text-slate-200">
                {bookCompletion.book}
              </span>
            </span>
            <kbd className="rounded border border-surface-border bg-surface-tertiary px-1.5 py-0.5 font-mono text-[10px] text-teal-300">
              Tab
            </kbd>
          </div>
        )}
        {suggestionsOpen && searchSuggestions.length > 0 && (
          <div
            id="scripture-search-suggestions"
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-40 overflow-hidden rounded-xl border border-surface-border bg-surface-elevated shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-surface-border/70 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <span>Likely scripture matches</span>
              <span>Enter to preview</span>
            </div>
            {searchSuggestions.map((result, index) => (
              <button
                key={`${result.reference}-${result.translation}`}
                id={`scripture-suggestion-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeSuggestion}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-surface-border/40 px-3.5 py-3 text-left last:border-b-0",
                  index === activeSuggestion
                    ? "bg-teal-500/10"
                    : "hover:bg-surface-tertiary/70",
                )}
                onMouseEnter={() => onActiveSuggestionChange(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPreviewSuggestion(result)}
              >
                <span className="w-28 shrink-0 text-xs font-semibold text-teal-300">
                  {result.reference}
                </span>
                <span className="line-clamp-2 text-xs leading-relaxed text-slate-400">
                  {result.verses.map((verse) => verse.text).join(" ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Button
        className="h-10 shrink-0 px-5"
        onClick={onSearch}
        disabled={loading || !query.trim()}
      >
        {loading ? (
          <Loader
            data-icon="inline-start"
            className="animate-spin"
            aria-hidden="true"
          />
        ) : (
          <Search data-icon="inline-start" aria-hidden="true" />
        )}
        {loading ? "Searching…" : "Search"}
      </Button>
    </div>
  );
}
