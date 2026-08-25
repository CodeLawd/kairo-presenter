import type { ScriptureResult } from "./ipc";

/** Reference line as shown on the live overlay (optional translation suffix). */
export function formatOverlayReference(
  reference: string,
  translation: string,
  showTranslation: boolean,
): string {
  return showTranslation ? `${reference} (${translation})` : reference;
}

/** Card header reference; translation is already displayed in its own badge. */
export function formatCardReference(reference: string): string {
  return reference;
}

/**
 * Verse body text as shown on the live overlay — verse numbers when enabled
 * for multi-verse payloads, optional maxVerses truncation.
 */
export function formatOverlayVerseText(
  verses: ScriptureResult["verses"],
  options: { showVerseNumbers: boolean; maxVerses?: number },
): string | null {
  if (verses.length === 0) return null;

  let selected = verses;
  let truncated = false;
  const maxVerses = options.maxVerses ?? 0;
  if (maxVerses > 0 && selected.length > maxVerses) {
    selected = selected.slice(0, maxVerses);
    truncated = true;
  }

  const showNumbers = options.showVerseNumbers && selected.length > 1;
  const lines = selected.map((v) =>
    showNumbers ? `${v.verse} ${v.text}` : v.text,
  );
  if (truncated && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  }
  return lines.join("\n");
}
