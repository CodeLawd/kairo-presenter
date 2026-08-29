import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  formatCardReference,
  formatOverlayVerseText,
} from "@shared/overlay-content";
import { renderOverlayHTML } from "@shared/overlay-template";
import { ScaledOverlayPreview } from "@/components/overlay/ScaledOverlayPreview";
import type { OverlayTheme, ScriptureResult } from "@shared/ipc";
import type { SendStatus } from "./types";

export interface VerseThemePreviewProps {
  result: ScriptureResult;
  theme: OverlayTheme;
  showTranslation: boolean;
  showVerseNumbers: boolean;
  maxVerses: number;
  width: number;
  height: number;
  /** Currently selected card in the loaded passage / playlist. */
  isActive?: boolean;
  /** Focused from sidebar — visual ring only, not on output. */
  isFocused: boolean;
  /** Live on ProPresenter / last sent cue. */
  isLive: boolean;
  sendStatus: SendStatus;
  onSelect: () => void;
  cardRef: (element: HTMLButtonElement | null) => void;
  /**
   * Card chrome (translation + Live) sits under the 16:9 frame so the slide
   * itself matches NDI. Hide it on the operator live-output monitor.
   */
  chrome?: boolean;
}

export function VerseThemePreview({
  result,
  theme,
  showVerseNumbers,
  maxVerses,
  width,
  height,
  isActive = false,
  isFocused,
  isLive,
  sendStatus,
  onSelect,
  cardRef,
  chrome = true,
}: VerseThemePreviewProps): React.ReactElement {
  const reference = formatCardReference(result.reference);
  const text = formatOverlayVerseText(result.verses, {
    showVerseNumbers,
    maxVerses,
  });

  const html = useMemo(() => {
    if (!text) return null;
    return renderOverlayHTML(theme, reference, text);
  }, [theme, reference, text]);

  const showLiveBadge = isLive || sendStatus === "sent";
  const status =
    sendStatus === "sending"
      ? "Sending"
      : sendStatus === "error"
        ? "Failed"
        : showLiveBadge
          ? "Live"
          : null;

  return (
    <button
      ref={cardRef}
      type="button"
      className={cn(
        "group relative flex shrink-0 flex-col overflow-hidden rounded-xl border text-left shadow-sm transition-all focus-visible:outline-none",
        isActive
          ? "border-teal-400 ring-2 ring-teal-400/70"
          : "border-surface-border/70 hover:border-slate-500 focus-visible:ring-1 focus-visible:ring-surface-border",
      )}
      style={{ width }}
      onClick={onSelect}
      aria-pressed={isActive || isLive || isFocused}
      aria-current={isActive ? "true" : undefined}
      aria-label={`Send ${result.reference} live`}
    >
      <div
        className="relative w-full overflow-hidden"
        style={{ height }}
        aria-hidden={!html}
      >
        {html ? (
          <ScaledOverlayPreview
            html={html}
            autoFit={theme.layout.autoFitText}
            fill
          />
        ) : (
          <div className="flex h-full items-center justify-center px-3">
            <p className="text-center font-sans text-[11px] italic text-slate-500">
              Verse text unavailable
            </p>
          </div>
        )}
      </div>

      {chrome && (
        <span className="flex min-h-[18px] items-center justify-between gap-2 px-1.5 py-1">
          <span className="font-sans text-[9px] font-bold uppercase tracking-wider text-slate-500">
            {result.translation}
          </span>
          {status && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
                sendStatus === "error"
                  ? "bg-red-600/90 text-white"
                  : sendStatus === "sending"
                    ? "bg-slate-800 text-slate-100"
                    : "bg-teal-500/95 text-white",
              )}
            >
              {status}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
