import { VerseThemePreview } from "./VerseThemePreview";
import type { OverlayTheme } from "@shared/ipc";
import type { ResultRow } from "./types";
import { locateFlatCard } from "./types";
import { cn } from "@/lib/utils";

export interface VerseCardGridProps {
  rows: ResultRow[];
  activeCardIndex: number;
  /** Live cue — verse sent / on output (shows Live badge). */
  cueHighlight: boolean;
  /** Focused from sidebar jump — section highlight only, no Live badge. */
  focusHighlight: boolean;
  /** Fixed card width — same for every verse card regardless of count. */
  cardMinWidth: number;
  /** Fixed card height — 16:9 frame matching live overlay proportions. */
  cardHeight: number;
  theme: OverlayTheme;
  showTranslation: boolean;
  showVerseNumbers: boolean;
  maxVerses: number;
  gridRef: React.Ref<HTMLDivElement>;
  cardRefs: React.MutableRefObject<Array<HTMLButtonElement | null>>;
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  onSelectCard: (index: number) => void;
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
}: VerseCardGridProps): React.ReactElement {
  let flatIndex = 0;
  const activeLocation = locateFlatCard(rows, activeCardIndex);
  const focusedRowKey =
    focusHighlight && activeLocation
      ? (rows[activeLocation.rowIndex]?.planItemId ??
        rows[activeLocation.rowIndex]?.id ??
        null)
      : null;

  return (
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
              width={cardMinWidth}
              height={cardHeight}
              isFocused={focusHighlight && idx === activeCardIndex && !cueHighlight}
              isLive={cueHighlight && idx === activeCardIndex}
              sendStatus={card.sendStatus}
              onSelect={() => onSelectCard(idx)}
              cardRef={(element) => {
                cardRefs.current[idx] = element;
              }}
            />
          );
        });

        const rowKey = row.planItemId ?? row.id;
        const rowFocused = focusedRowKey === rowKey;

        return (
          <section
            key={row.id}
            ref={(element) => {
              if (element) rowRefs.current.set(rowKey, element);
              else rowRefs.current.delete(rowKey);
            }}
            data-plan-item={row.planItemId ?? undefined}
            className={cn(
              "min-w-0 space-y-2 scroll-mt-3 rounded-xl transition-all",
              rowFocused &&
                "bg-teal-500/[0.06] ring-1 ring-teal-400/40 shadow-[inset_0_0_0_1px_rgba(45,212,191,0.12)] p-2 -mx-1",
            )}
          >
            <div className="flex flex-wrap items-baseline gap-2 px-0.5">
              <p
                className={cn(
                  "truncate text-xs font-semibold",
                  rowFocused ? "text-teal-300" : "text-slate-300",
                )}
              >
                {row.reference}
              </p>
              <span className="shrink-0 text-[10px] text-slate-600">
                {row.cards.length} verse{row.cards.length !== 1 ? "s" : ""}
              </span>
              {row.note && (
                <span className="text-[10px] text-yellow-500/90">{row.note}</span>
              )}
            </div>
            <div
              className="grid gap-3 justify-start"
              style={{
                gridTemplateColumns: `repeat(auto-fill, ${cardMinWidth}px)`,
              }}
            >
              {rowCards}
            </div>
          </section>
        );
      })}
    </div>
  );
}
