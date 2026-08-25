import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  formatCardReference,
  formatOverlayVerseText,
} from "@shared/overlay-content";
import { renderOverlayHTML } from "@shared/overlay-template";
import type { OverlayTheme, ScriptureResult } from "@shared/ipc";
import type { SendStatus } from "./types";

const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1080;

export interface VerseThemePreviewProps {
  result: ScriptureResult;
  theme: OverlayTheme;
  showTranslation: boolean;
  showVerseNumbers: boolean;
  maxVerses: number;
  width: number;
  height: number;
  /** Focused from sidebar — visual ring only, not on output. */
  isFocused: boolean;
  /** Live on ProPresenter / last sent cue. */
  isLive: boolean;
  sendStatus: SendStatus;
  onSelect: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
}

export function VerseThemePreview({
  result,
  theme,
  showVerseNumbers,
  maxVerses,
  width,
  height,
  isFocused,
  isLive,
  sendStatus,
  onSelect,
  cardRef,
}: VerseThemePreviewProps): React.ReactElement {
  const reference = formatCardReference(result.reference);
  const text = formatOverlayVerseText(result.verses, {
    showVerseNumbers,
    maxVerses,
  });

  const html = useMemo(() => {
    if (!text) return null;
    return renderOverlayHTML(theme, reference, text, FRAME_WIDTH, FRAME_HEIGHT);
  }, [theme, reference, text]);

  const scale = width > 0 ? width / FRAME_WIDTH : 0;
  const showLiveBadge = isLive || sendStatus === "sent";

  return (
    <button
      ref={cardRef}
      type="button"
      className={cn(
        "group relative shrink-0 overflow-hidden rounded-xl border text-left shadow-sm transition-all focus-visible:outline-none",
        isLive
          ? "border-teal-400/80 ring-2 ring-teal-400/25 shadow-glow-teal/10"
          : isFocused
            ? "border-teal-400/50 ring-1 ring-teal-400/20"
            : "border-surface-border/70 hover:border-surface-border",
      )}
      style={{ width, height }}
      onClick={onSelect}
      aria-pressed={isLive || isFocused}
      aria-label={`Send ${result.reference} live`}
    >
      <div
        className="relative h-full w-full overflow-hidden bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#0d0d0d_0%_50%)] bg-[length:12px_12px]"
        aria-hidden={!html}
      >
        {html ? (
          <div
            className="pointer-events-none absolute left-0 top-0 origin-top-left"
            style={{
              width: FRAME_WIDTH,
              height: FRAME_HEIGHT,
              transform: `scale(${scale})`,
            }}
            // eslint-disable-next-line react/no-danger -- shared WYSIWYG overlay template (escaped)
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3">
            <p className="text-center font-sans text-[11px] italic text-slate-500">
              Verse text unavailable
            </p>
          </div>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-start gap-1 p-1.5">
        <span className="rounded bg-black/55 px-1.5 py-0.5 font-sans text-[9px] font-bold uppercase tracking-wider text-slate-200 backdrop-blur-sm">
          {result.translation}
        </span>
      </div>

      {(sendStatus === "sending" || sendStatus === "error" || showLiveBadge) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-center p-1.5">
          {sendStatus === "sending" && (
            <span className="rounded-full bg-slate-900/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-100 shadow-sm ring-1 ring-white/10 backdrop-blur-sm">
              Sending
            </span>
          )}
          {sendStatus === "error" && (
            <span className="rounded-full bg-red-600/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm backdrop-blur-sm">
              Failed
            </span>
          )}
          {showLiveBadge && sendStatus !== "sending" && sendStatus !== "error" && (
            <span className="rounded-full bg-teal-500/95 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-sm ring-1 ring-teal-300/30 backdrop-blur-sm">
              Live
            </span>
          )}
        </div>
      )}
    </button>
  );
}
