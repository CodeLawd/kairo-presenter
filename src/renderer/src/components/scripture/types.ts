import type { ScriptureResult } from "@shared/ipc";
import { expandScriptureResult } from "@shared/scripture-query";

export type SendStatus = "idle" | "sending" | "sent" | "error";

export interface ResultCard {
  result: ScriptureResult;
  sendStatus: SendStatus;
  planItemId?: string;
}

/** One playlist/search item = one row; multi-verse items grid their verse cards. */
export interface ResultRow {
  id: string;
  reference: string;
  planItemId?: string;
  note?: string;
  cards: ResultCard[];
}

export const CARD_ZOOM_MIN = 50;
export const CARD_ZOOM_MAX = 250;
export const CARD_ZOOM_DEFAULT = 100;
/**
 * Minimum card width at 100% zoom — sized so a typical content area fits 4–5
 * cards per row. The grid stretches cards to fill each row; height is derived
 * as 16:9 for the theme preview.
 */
// Same minimum as a lyric card at 100%, so both tabs fit the same number per row.
export const CARD_BASE_WIDTH = 180;
export const CARD_BASE_HEIGHT = Math.round((CARD_BASE_WIDTH * 9) / 16);

export function createResultRow(
  result: ScriptureResult,
  options?: {
    id?: string;
    planItemId?: string;
    sendStatus?: SendStatus;
    note?: string;
  },
): ResultRow {
  const sendStatus = options?.sendStatus ?? "idle";
  const verseResults = expandScriptureResult(result);
  const cards: ResultCard[] = (verseResults.length > 0 ? verseResults : [result]).map(
    (verseResult) => ({
      result: verseResult,
      sendStatus,
      planItemId: options?.planItemId,
    }),
  );
  return {
    id: options?.id ?? options?.planItemId ?? result.reference,
    reference: result.reference,
    planItemId: options?.planItemId,
    note: options?.note,
    cards,
  };
}

export function flattenResultRows(rows: ResultRow[]): ResultCard[] {
  return rows.flatMap((row) => row.cards);
}

export function findFlatCardIndex(
  rows: ResultRow[],
  predicate: (card: ResultCard, row: ResultRow) => boolean,
): number {
  let flat = 0;
  for (const row of rows) {
    for (const card of row.cards) {
      if (predicate(card, row)) return flat;
      flat += 1;
    }
  }
  return -1;
}

export function locateFlatCard(
  rows: ResultRow[],
  flatIndex: number,
): { rowIndex: number; cardIndex: number } | null {
  let remaining = flatIndex;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const count = rows[rowIndex].cards.length;
    if (remaining < count) return { rowIndex, cardIndex: remaining };
    remaining -= count;
  }
  return null;
}

export function flatIndexAt(
  rows: ResultRow[],
  rowIndex: number,
  cardIndex: number,
): number {
  let flat = 0;
  for (let i = 0; i < rowIndex; i += 1) flat += rows[i].cards.length;
  return flat + cardIndex;
}
