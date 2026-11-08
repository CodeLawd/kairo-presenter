import { Bible } from "@/icons";
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
      className="flex w-full flex-col"
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
              footer={{ number: localIdx + 1 }}
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
            className={cn("min-w-0 scroll-mt-3", rows.length > 1 && "pb-7")}
          >
            {/* A lone passage needs no heading — its slide already shows the reference.
                Otherwise each passage opens with a header bar that pins to the
                top while its cards scroll, as macOS list sections do: you always
                know which passage you are in, and the next one's bar marks where
                it starts. */}
            {(rows.length > 1 || row.note) && (
              <div className="sticky top-0 z-10 -mx-5 mb-3 flex min-h-9 flex-wrap items-center gap-2 bg-[rgb(var(--surface-tertiary)/0.72)] px-5 py-2 backdrop-blur-md lg:-mx-6 lg:px-6">
                <Bible size={13} weight="fill" className={cn("shrink-0", rowIsLive ? "text-live" : "text-slate-500")} aria-hidden="true" />
                <p className={cn("min-w-0 truncate text-[13px] font-semibold", rowIsLive ? "text-live" : "text-slate-100")}>
                  {row.reference}
                </p>
                {row.note && (
                  <span className="text-[10px] text-yellow-500/90">{row.note}</span>
                )}
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-slate-500">
                  {row.cards.length} {row.cards.length === 1 ? "verse" : "verses"}
                </span>
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
