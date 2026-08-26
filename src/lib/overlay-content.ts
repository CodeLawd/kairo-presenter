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

/**
 * Fills a `{Reference}` / `{Text}` token template. One renderer for every
 * destination that substitutes tokens itself (the PP messages layer does its own
 * substitution server-side; this covers the stage message and the Settings
 * preview of the same template).
 */
export function renderOverlayTemplate(
  template: string,
  tokens: { reference: string; text: string },
): string {
  return template
    .replaceAll("{Reference}", tokens.reference)
    .replaceAll("{Text}", tokens.text)
    .trim();
}
