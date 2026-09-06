import {
  ChevronLeft,
  ChevronRight,
  Layers,
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
  selectedPlanId: string | null;
  addedAllToPlan: string | null;
  plansCount: number;
  cardsSource: "search" | "plan" | null;
  queueLabel?: string;
  onCardZoomChange: (zoom: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onSendSelected: () => void;
  onAddAll: () => void;
  onClear: () => void;
}

export function QueueDock({
  cards,
  activeCardIndex,
  cardZoom,
  navigating,
  selectedPlanId,
  addedAllToPlan,
  plansCount,
  cardsSource,
  queueLabel,
  onCardZoomChange,
  onPrevious,
  onNext,
  onSendSelected,
  onAddAll,
  onClear,
}: QueueDockProps): React.ReactElement {
  const isPlan = cardsSource === "plan";
  return (
    <div className="shrink-0 border-t border-surface-border bg-surface-secondary px-5 py-2.5 lg:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-300">
            <Layers size={14} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-200">
              {isPlan
                ? `${cards.length} verse${cards.length !== 1 ? "s" : ""} in playlist`
                : `${cards.length} loaded`}
            </p>
            <p className="truncate text-[10px] text-slate-500">
              {queueLabel ??
                cards[activeCardIndex]?.result.reference ??
                (isPlan ? "Playlist" : "Temporary verse queue")}
            </p>
          </div>
        </div>

        <div
          className="mx-1 hidden h-6 w-px bg-surface-border sm:block"
          aria-hidden="true"
        />

        <div className="flex min-w-[12rem] flex-1 items-center gap-2 sm:max-w-xs">
          <ZoomOut
            size={13}
            className="shrink-0 text-slate-500"
            aria-hidden="true"
          />
          <Slider
            className="w-full"
            min={CARD_ZOOM_MIN}
            max={CARD_ZOOM_MAX}
            step={5}
            value={[cardZoom]}
            onValueChange={(value) =>
              onCardZoomChange(value[0] ?? CARD_ZOOM_DEFAULT)
            }
            aria-label="Card size"
          />
          <ZoomIn
            size={13}
            className="shrink-0 text-slate-500"
            aria-hidden="true"
          />
          <span className="w-9 shrink-0 text-right text-[10px] font-semibold tabular-nums text-slate-400">
            {cardZoom}%
          </span>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="flex items-center overflow-hidden rounded-lg border border-surface-border bg-surface-secondary">
            <button
              type="button"
              className="flex items-center gap-1 border-r border-surface-border px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-surface-tertiary hover:text-white disabled:cursor-wait disabled:opacity-50"
              onClick={onPrevious}
              disabled={navigating !== null}
              aria-label={isPlan ? "Add previous verse to playlist" : "Preload previous verse"}
            >
              {navigating === "previous" ? (
                <Loader size={12} className="animate-spin" />
              ) : (
                <ChevronLeft size={13} />
              )}
              Previous
            </button>
            <button
              type="button"
              className="flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-surface-tertiary hover:text-white disabled:cursor-wait disabled:opacity-50"
              onClick={onNext}
              disabled={navigating !== null}
              aria-label={isPlan ? "Add next verse to playlist" : "Preload next verse"}
            >
              Next
              {navigating === "next" ? (
                <Loader size={12} className="animate-spin" />
              ) : (
                <ChevronRight size={13} />
              )}
            </button>
          </div>
          <button
            type="button"
            className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs"
            onClick={onSendSelected}
            disabled={
              !cards[activeCardIndex] ||
              cards[activeCardIndex].sendStatus === "sending"
            }
            aria-label={`Go live with ${cards[activeCardIndex]?.result.reference ?? "verse"}`}
          >
            <Send size={12} aria-hidden="true" />
            Go live
          </button>
          {cardsSource === "search" && (
            <button
              type="button"
              className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs"
              onClick={onAddAll}
              disabled={!selectedPlanId || Boolean(addedAllToPlan)}
              aria-label="Add all loaded verses to playlist"
            >
              <Plus size={12} aria-hidden="true" />
              {addedAllToPlan
                ? `Added to ${addedAllToPlan}`
                : plansCount > 0
                  ? "Add all"
                  : "No playlist"}
            </button>
          )}
          <button
            type="button"
            className="px-2 py-2 text-xs font-medium text-slate-500 hover:text-slate-200"
            onClick={onClear}
          >
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}
