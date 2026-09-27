import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  formatCardReference,
  formatOverlayReference,
  formatOverlayVerseText,
} from "@shared/overlay-content";
import { renderOverlayHTML } from "@shared/overlay-template";
import { ScaledOverlayPreview } from "@/components/overlay/ScaledOverlayPreview";
import type { OverlayVideoTime } from "@shared/overlay-fit";
import type { OverlayTheme, ScriptureResult } from "@shared/ipc";
import type { SendStatus } from "./types";

export interface VerseThemePreviewProps {
  result: ScriptureResult;
  theme: OverlayTheme;
  showTranslation: boolean;
  showVerseNumbers: boolean;
  maxVerses: number;
  responsive?: boolean;
  width: number;
  height: number;
  /** Currently selected card in the loaded passage / playlist. */
  isActive?: boolean;
  /** Focused from sidebar — visual ring only, not on output. */
  isFocused: boolean;
  /** Live on ProPresenter / last sent cue. */
  isLive: boolean;
  sendStatus: SendStatus;
  onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** Picked for a bulk action (⌘-click / rubber band) — not live. */
  isPicked?: boolean;
  /** Identity for rubber-band selection (`data-select-id`). */
  selectId?: string;
  cardRef: (element: HTMLButtonElement | null) => void;
  /**
   * Card chrome (translation + Live) sits under the 16:9 frame so the slide
   * itself matches NDI. Hide it on the operator live-output monitor.
   */
  chrome?: boolean;
  /** Pause a live video background without rebuilding the slide. */
  paused?: boolean;
  seekTo?: { token: number; seconds: number } | null;
  onTime?: (time: OverlayVideoTime) => void;
  /**
   * Build the 1920×1080 slide only once the card nears the viewport.
   *
   * Each slide costs a full-HD DOM subtree, and with auto-fit enabled a
   * binary-search font fit that forces synchronous layout ~8 times over. A
   * 54-item playlist is 360 cards, so mounting them all up front costs ~1s of
   * blocked main thread to draw the dozen that are actually on screen.
   *
   * Opt-in: never enable it for the live output, which must be ready before it
   * is looked at.
   */
  lazy?: boolean;
}

/**
 * Latches true once the element first comes within `rootMargin` of the viewport.
 * Cards stay mounted after that — scrolling back should never re-pay the fit.
 */
function useNearViewport(
  enabled: boolean,
  ref: React.RefObject<Element | null>,
): boolean {
  const [seen, setSeen] = useState(!enabled);

  useEffect(() => {
    if (!enabled || seen) return;
    const element = ref.current;
    if (!element) return;
    // No IntersectionObserver (jsdom, very old runtimes): render everything
    // rather than render nothing.
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setSeen(true);
      },
      // Start a screen early so a scroll lands on a drawn card, not a placeholder.
      { rootMargin: "600px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [enabled, seen, ref]);

  return seen;
}

export function VerseThemePreview({
  result,
  theme,
  showTranslation,
  showVerseNumbers,
  maxVerses,
  width,
  height,
  responsive = false,
  isActive = false,
  isFocused,
  isLive,
  sendStatus,
  onSelect,
  cardRef,
  chrome = true,
  paused = false,
  seekTo = null,
  onTime,
  lazy = false,
  isPicked = false,
  selectId,
}: VerseThemePreviewProps): React.ReactElement {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const drawSlide = useNearViewport(lazy, buttonRef);

  const reference = showTranslation
    ? formatOverlayReference(result.reference, result.translation, true)
    : formatCardReference(result.reference);
  const text = formatOverlayVerseText(result.verses, {
    showVerseNumbers,
    maxVerses,
  });

  const html = useMemo(() => {
    // Skipped entirely while off-screen: building the markup is the cheap half,
    // but mounting it is what costs, and neither is needed yet.
    if (!text || !drawSlide) return null;
    return renderOverlayHTML(theme, reference, text);
  }, [theme, reference, text, drawSlide]);

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
      ref={(element) => {
        buttonRef.current = element;
        cardRef(element);
      }}
      type="button"
      className={cn(
        "group relative flex shrink-0 flex-col overflow-hidden text-left transition-all focus-visible:outline-none",
        chrome
          ? cn(
              "rounded-xl border shadow-sm",
              isPicked
                ? "border-white ring-2 ring-white/30"
                : isActive
                  ? "border-teal-400 ring-2 ring-teal-400/70"
                  : "border-surface-border/70 hover:border-slate-500 focus-visible:ring-1 focus-visible:ring-surface-border",
            )
          : "rounded-none border-0 shadow-none",
      )}
      style={{ width: responsive ? "100%" : width }}
      data-select-id={selectId}
      onClick={onSelect}
      aria-pressed={isActive || isLive || isFocused}
      aria-current={isActive ? "true" : undefined}
      aria-label={`Send ${result.reference} live`}
    >
      <div
        className="relative w-full overflow-hidden"
        style={responsive ? { aspectRatio: `${width} / ${height}` } : { height }}
        aria-hidden={!html || undefined}
      >
        {html ? (
          <ScaledOverlayPreview
            html={html}
            autoFit={theme.layout.autoFitText}
            fill
            paused={paused}
            seekTo={seekTo}
            onTime={onTime}
          />
        ) : drawSlide ? (
          <div className="flex h-full items-center justify-center px-3">
            <p className="text-center font-sans text-[11px] italic text-slate-500">
              Verse text unavailable
            </p>
          </div>
        ) : (
          <div className="h-full w-full bg-surface-secondary" />
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
