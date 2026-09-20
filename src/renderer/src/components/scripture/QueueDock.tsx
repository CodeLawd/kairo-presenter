import type { SermonPlan } from '@shared/ipc';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader,
  Plus,
  Send,
  ZoomIn,
  ZoomOut,
} from '@/icons';
import { Slider } from "@/components/ui/slider";
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
  onClear: () => void;
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
  onClear,
}: QueueDockProps): React.ReactElement {
  const activeRef =
    queueLabel ?? cards[activeCardIndex]?.result.reference ?? "—";

  return (
    <div className="transcript-glass shrink-0 border-t border-white/10 px-4 py-2">
      <div className="flex flex-wrap items-center gap-2.5">
        <p className="min-w-0 shrink truncate text-[11px] text-zinc-400">
          <span className="font-semibold tabular-nums text-zinc-200">
            {cards.length}
          </span>
          <span className="mx-1.5 text-zinc-600">·</span>
          <span className="text-zinc-300">{activeRef}</span>
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <div
            className="flex items-center gap-2 rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5"
            title="Verse card size"
          >
            <ZoomOut size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
            <Slider
              className="w-32"
              trackClassName="relative h-2 w-full grow overflow-hidden rounded-full bg-zinc-700"
              rangeClassName="absolute h-full bg-blue-500 select-none"
              thumbClassName="relative block h-5 w-7 shrink-0 rounded-full border border-black/20 bg-white shadow-lg transition-shadow select-none after:absolute after:-inset-2 hover:ring-2 hover:ring-blue-400/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/60 disabled:pointer-events-none disabled:opacity-50"
              min={CARD_ZOOM_MIN}
              max={CARD_ZOOM_MAX}
              step={5}
              value={[cardZoom]}
              onValueChange={(value) =>
                onCardZoomChange(value[0] ?? CARD_ZOOM_DEFAULT)
              }
              aria-label="Verse card size"
            />
            <ZoomIn size={14} className="shrink-0 text-zinc-400" aria-hidden="true" />
            <span className="min-w-9 text-right text-[11px] font-semibold tabular-nums text-zinc-300">
              {cardZoom}%
            </span>
          </div>

          <div className="flex items-center overflow-hidden rounded-md border border-white/10 bg-black/20">
            <button
              type="button"
              className="flex items-center gap-1 border-r border-white/10 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-50"
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
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/5 hover:text-white disabled:cursor-wait disabled:opacity-50"
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
            className="flex items-center gap-1.5 rounded-md bg-teal-500 px-2.5 py-1.5 text-[11px] font-semibold text-[#111827] hover:bg-teal-400 disabled:opacity-40"
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
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] text-zinc-400 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50"
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <button
            type="button"
            className="px-2 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-200"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
