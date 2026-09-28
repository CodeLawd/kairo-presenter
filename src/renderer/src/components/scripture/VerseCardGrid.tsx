import { cn } from "@/lib/utils";
import { VerseThemePreview } from "./VerseThemePreview";
import { MarqueeSelect } from "@/components/shared/MarqueeSelect";
import { selectGesture, type SelectGesture } from "@/hooks/useMultiSelect";
import type { OverlayTheme } from "@shared/ipc";
import type { ResultRow } from "./types";
import { locateFlatCard } from "./types";

export interface VerseCardGridProps {
  rows: ResultRow[];
  activeCardIndex: number;
  /** Live cue — verse sent / on output (shows Live badge). */
  cueHighlight: boolean;
  /** Focused from sidebar jump — section highlight only, no Live badge. */
  focusHighlight: boolean;
  /** Minimum card width — cards stretch to fill the row (16:9 kept). */
  cardMinWidth: number;
  /** Card height basis — pairs with width to preserve 16:9 when stretched. */
  cardHeight: number;
  theme: OverlayTheme;
  showTranslation: boolean;
  showVerseNumbers: boolean;
  maxVerses: number;
  gridRef: React.Ref<HTMLDivElement>;
  cardRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  onSelectCard: (index: number) => void;
  /** Cards picked for a bulk action — ⌘/Shift-click or rubber band. */
  pickedCards: ReadonlySet<number>;
  onPickCard: (index: number, gesture: SelectGesture) => void;
  onMarqueeBegin: (additive: boolean) => void;
  onMarqueeChange: (indexes: number[]) => void;
}

export function VerseCardGrid({
  rows,
  activeCardIndex,
  cueHighlight,
  focusHighlight,
  cardMinWidth,
  cardHeight,
  theme,
  showTranslation,
  showVerseNumbers,
  maxVerses,
  gridRef,
  cardRefs,
  rowRefs,
  onSelectCard,
  pickedCards,
  onPickCard,
  onMarqueeBegin,
  onMarqueeChange,
}: VerseCardGridProps): React.ReactElement {
  let flatIndex = 0;
  const activeLocation = locateFlatCard(rows, activeCardIndex);

  return (
    <MarqueeSelect
      onBegin={onMarqueeBegin}
      onChange={(ids) => onMarqueeChange(ids.map(Number))}
    >
    <div
      ref={gridRef as React.Ref<HTMLDivElement>}
      className="flex w-full flex-col gap-5"
    >
      {rows.map((row) => {
        const rowStart = flatIndex;
        const rowCards = row.cards.map((card, localIdx) => {
          const idx = rowStart + localIdx;
          flatIndex += 1;
          return (
            <VerseThemePreview
              key={`${row.id}-${card.result.reference}-${localIdx}`}
              result={card.result}
              theme={theme}
              showTranslation={showTranslation}
              showVerseNumbers={showVerseNumbers}
              maxVerses={maxVerses}
              responsive
              width={cardMinWidth}
              height={cardHeight}
              isActive={idx === activeCardIndex}
              isFocused={focusHighlight && idx === activeCardIndex && !cueHighlight}
              isLive={cueHighlight && idx === activeCardIndex}
              sendStatus={card.sendStatus}
              // A playlist is hundreds of cards; only draw the ones on screen.
              lazy
              isPicked={pickedCards.has(idx)}
              selectId={String(idx)}
              onSelect={(event) => {
                // A plain click still sends the verse; ⌘/Shift only select.
                const gesture = selectGesture(event);
                if (gesture) onPickCard(idx, gesture);
                else onSelectCard(idx);
              }}
              cardRef={(element) => {
                cardRefs.current[idx] = element;
              }}
            />
          );
        });

        const rowKey = row.planItemId ?? row.id;
        const rowIsLive =
          cueHighlight &&
          activeLocation !== null &&
          (rows[activeLocation.rowIndex]?.planItemId ??
            rows[activeLocation.rowIndex]?.id) === rowKey;

        return (
          <section
            key={row.id}
            ref={(element) => {
              if (element) rowRefs.current.set(rowKey, element);
              else rowRefs.current.delete(rowKey);
            }}
            data-plan-item={row.planItemId ?? undefined}
            className="min-w-0 space-y-2 scroll-mt-3"
          >
            {/* A lone passage needs no heading — its slide already shows the reference. */}
            {(rows.length > 1 || row.note) && (
              <div className="flex flex-wrap items-baseline gap-2 px-0.5">
                <p className={cn("truncate text-xs font-semibold", rowIsLive ? "text-teal-300" : "text-slate-300")}>
                  {row.reference}
                </p>
                {row.note && (
                  <span className="text-[10px] text-yellow-500/90">{row.note}</span>
                )}
              </div>
            )}
            <div
              className="grid w-full gap-3"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${cardMinWidth}px), 1fr))`,
              }}
            >
              {rowCards}
            </div>
          </section>
        );
      })}
    </div>
    </MarqueeSelect>
  );
}
