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
import { sectionFill } from "@/components/lyrics/section-colors";

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
   * Card chrome (border + Sending tag) around the 16:9 slide, which itself
   * matches NDI. Hide it on the operator live-output monitor.
   */
  chrome?: boolean;
  /** Pause a live video background without rebuilding the slide. */
  paused?: boolean;
  /** Play a video background — the live monitor only; cards show a still. */
  motion?: boolean;
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
  /**
   * A Songs-style label bar under the slide: the reference on the left, the
   * card's number on the right. Off for the live monitor and Operator cards.
   */
  footer?: { number: number } | null;
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
  motion = false,
  seekTo = null,
  onTime,
  lazy = false,
  isPicked = false,
  selectId,
  footer = null,
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

  // Only transient states get a label; "on screen" is said by the frame.
  // Only the in-flight state gets a label. A push that reached no screen is
  // still live in Kairo; why the screen missed it belongs to Screens, not to
  // a red badge on every card.
  const status = sendStatus === "sending" ? "Sending" : null;

  return (
    <button
      ref={(element) => {
        buttonRef.current = element;
        cardRef(element);
      }}
      type="button"
      className={cn(
        "group relative flex shrink-0 flex-col overflow-hidden text-left transition-[border-color,transform] duration-300 focus-visible:outline-none active:scale-[0.98]",
        chrome
          ? cn(
              // Blue is only for what is on screen; white marks the current
              // (or picked) card, so "being read" never looks like "live".
              "rounded-md border-2",
              isLive
                ? "border-live"
                : isPicked || isActive
                  ? "border-white"
                  : footer
                    // Same quiet frame as a lyric card.
                    ? "border-surface-border hover:border-stone focus-visible:border-slate-400"
                    : "border-transparent hover:border-slate-500 focus-visible:border-slate-400",
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
            motion={motion}
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

      {chrome && footer && (
        // The lyric cards' bar, in the verse blue, carrying the reference.
        <div
          className="flex h-[22px] w-full shrink-0 items-center gap-2 self-stretch px-2 text-[12px]"
          style={sectionFill("verse")}
        >
          <span className="min-w-0 flex-1 truncate font-medium">{formatCardReference(result.reference)}</span>
          <span className="shrink-0 tabular-nums opacity-80">{footer.number}</span>
        </div>
      )}

      {chrome && status && (
        <span className="absolute right-1.5 top-1.5 bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-100">
          {status}
        </span>
      )}
    </button>
  );
}
