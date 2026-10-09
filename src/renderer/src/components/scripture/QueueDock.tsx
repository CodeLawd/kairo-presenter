import type { SermonPlan } from '@shared/ipc';
import { useLibrary } from "@/stores/useLibraries";
import { DEFAULT_LIBRARY_ID, DEFAULT_LIBRARY_NAME } from "@shared/libraries";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader,
  Plus,
  Send,
} from '@/icons';
import { ZoomControl } from "@/components/shared/ZoomControl";
import {
  CARD_ZOOM_DEFAULT,
  CARD_ZOOM_MAX,
  CARD_ZOOM_MIN,
  type ResultCard,
} from "./types";

export interface QueueDockProps {
  cards: ResultCard[];
  activeCardIndex: number;
  cardZoom: number;
  navigating: "previous" | "next" | null;
  addedAllToPlan: string | null;
  plans: SermonPlan[];
  creatingPlaylist: boolean;
  onCreatePlaylist: () => void;
  cardsSource: "search" | "plan" | null;
  queueLabel?: string;
  onCardZoomChange: (zoom: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSendSelected: () => void;
  onAddAll: (planId: string) => void;
  /** Keeps the selected verse in a library, with its text, for later. */
  onSaveToLibrary: (libraryId: string) => void;
  onClear: () => void;
  /** Whether the selected card is shown on its own or with its chapter. */
  scope: "verse" | "chapter" | null;
  onShowVerse: () => void;
  onShowChapter: () => void;
  openingChapter?: boolean;
}

export function QueueDock({
  cards,
  activeCardIndex,
  cardZoom,
  navigating,
  addedAllToPlan,
  plans,
  creatingPlaylist,
  onCreatePlaylist,
  cardsSource,
  queueLabel,
  onCardZoomChange,
  onPrevious,
  onNext,
  onSendSelected,
  onAddAll,
  onSaveToLibrary,
  onClear,
  scope,
  onShowVerse,
  onShowChapter,
  openingChapter = false,
}: QueueDockProps): React.ReactElement {
  const libraries = useLibrary("scripture").libraries;
  const activeRef =
    queueLabel ?? cards[activeCardIndex]?.result.reference ?? "—";

  return (
    <div className="transcript-glass shrink-0 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="min-w-0 shrink truncate text-[11px] text-zinc-400">
          <span className="font-semibold tabular-nums text-zinc-200">
            {cards.length}
          </span>
          <span className="mx-1.5 text-zinc-600">·</span>
          <span className="text-zinc-300">{activeRef}</span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <ZoomControl
            label="Verse card size"
            value={cardZoom}
            min={CARD_ZOOM_MIN}
            max={CARD_ZOOM_MAX}
            defaultValue={CARD_ZOOM_DEFAULT}
            onChange={onCardZoomChange}
          />

          {scope && (
            <div
              role="radiogroup"
              aria-label="Show the verse or its whole chapter"
              className="flex items-center rounded-md bg-surface p-0.5"
            >
              {(["verse", "chapter"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={scope === option}
                  disabled={openingChapter}
                  onClick={() => {
                    if (scope === option) return;
                    if (option === "verse") onShowVerse();
                    else onShowChapter();
                  }}
                  title={option === "verse" ? "Only the selected verse" : "The whole chapter around it"}
                  className={
                    scope === option
                      ? "flex items-center gap-1 rounded bg-surface-elevated px-2.5 py-1 text-[11px] font-semibold text-white"
                      : "flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-200 disabled:cursor-wait"
                  }
                >
                  {option === "chapter" && openingChapter && <Loader size={11} className="animate-spin" />}
                  {option === "verse" ? "Verse" : "Chapter"}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center overflow-hidden rounded-md bg-surface">
            <button
              type="button"
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-surface-tertiary hover:text-white disabled:cursor-wait disabled:opacity-50"
              onClick={onPrevious}
              disabled={navigating !== null}
              aria-label="Previous verse"
            >
              {navigating === "previous" ? (
                <Loader size={11} className="animate-spin" />
              ) : (
                <ChevronLeft size={12} />
              )}
              Prev
            </button>
            <button
              type="button"
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-surface-tertiary hover:text-white disabled:cursor-wait disabled:opacity-50"
              onClick={onNext}
              disabled={navigating !== null}
              aria-label="Next verse"
            >
              Next
              {navigating === "next" ? (
                <Loader size={11} className="animate-spin" />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
          </div>

          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md bg-teal-500 px-2.5 py-1.5 text-[11px] font-semibold text-on-accent hover:bg-teal-600 disabled:opacity-40"
            onClick={onSendSelected}
            disabled={
              !cards[activeCardIndex] ||
              cards[activeCardIndex].sendStatus === "sending"
            }
            aria-label={`Go live with ${cards[activeCardIndex]?.result.reference ?? "verse"}`}
          >
            <Send size={11} aria-hidden="true" />
            Go live
          </button>

          {cardsSource === "search" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={creatingPlaylist}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-surface-tertiary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50"
                >
                  Save <ChevronDown size={11} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {addedAllToPlan && (
                  <DropdownMenuLabel className="truncate text-xs text-teal-400">
                    Saved to {addedAllToPlan}
                  </DropdownMenuLabel>
                )}
                <div className="max-h-64 overflow-y-auto">
                  {plans.map((plan) => (
                    <DropdownMenuItem
                      key={plan.id}
                      onSelect={() => onAddAll(plan.id)}
                    >
                      <span className="truncate">{plan.title}</span>
                    </DropdownMenuItem>
                  ))}
                </div>
                {plans.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={onCreatePlaylist}>
                  <Plus size={12} /> New playlist…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* A playlist orders one service; a library keeps the passage
                    for any service. Both are offered from the one Save menu. */}
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-zinc-600">
                  Library
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onSaveToLibrary(DEFAULT_LIBRARY_ID)}>
                  <span className="truncate">{DEFAULT_LIBRARY_NAME.scripture}</span>
                </DropdownMenuItem>
                {libraries.map((library) => (
                  <DropdownMenuItem
                    key={library.id}
                    onSelect={() => onSaveToLibrary(library.id)}
                  >
                    <span className="truncate">{library.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <button
            type="button"
            className="rounded-md px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-surface-tertiary hover:text-zinc-200"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
