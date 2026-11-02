import { useRef } from "react";
import { Video } from "@/icons";
import { cn } from "@/lib/utils";
import type { VideoBox, VideoSettings } from "@shared/program";

const MIN_BOX = 10;
const SNAP_PCT = 2;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Pulls a value to the nearest target when it is close enough. */
function snap(value: number, targets: number[], threshold = SNAP_PCT): number {
  let best = value;
  let distance = threshold;
  for (const target of targets) {
    const next = Math.abs(value - target);
    if (next < distance) {
      distance = next;
      best = target;
    }
  }
  return best;
}

interface Drag {
  mode: "move" | "resize" | "divider";
  startX: number;
  startY: number;
  rect: DOMRect;
  box: VideoBox;
  splitPct: number;
}

/**
 * The video's place on the screen, as a picture to move rather than a list of
 * numbers: drag the inset anywhere, pull its corner to resize, and drag the
 * divider for side by side. The three cards are quick presets.
 */
export function VideoLayoutCanvas({
  value,
  onChange,
  live,
}: {
  value: VideoSettings;
  onChange: (patch: Partial<VideoSettings>) => void;
  live: boolean;
}): React.ReactElement {
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);

  const begin = (event: React.PointerEvent, mode: Drag["mode"]): void => {
    if (event.button !== 0) return;
    const rect = stage.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    stage.current?.setPointerCapture(event.pointerId);
    drag.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect,
      box: { ...value.box },
      splitPct: value.splitPct,
    };
  };

  const move = (event: React.PointerEvent): void => {
    const active = drag.current;
    if (!active) return;
    const dx = ((event.clientX - active.startX) / active.rect.width) * 100;
    const dy = ((event.clientY - active.startY) / active.rect.height) * 100;

    if (active.mode === "divider") {
      const at = ((event.clientX - active.rect.left) / active.rect.width) * 100;
      const share = value.side === "left" ? at : 100 - at;
      onChange({ splitPct: Math.round(clamp(share, 20, 80)) });
      return;
    }

    if (active.mode === "resize") {
      const widthPct = clamp(
        active.box.widthPct + dx,
        MIN_BOX,
        100 - active.box.xPct,
      );
      const heightPct = clamp(
        active.box.heightPct + dy,
        MIN_BOX,
        100 - active.box.yPct,
      );
      onChange({
        box: {
          ...active.box,
          widthPct: Math.round(widthPct),
          heightPct: Math.round(heightPct),
        },
      });
      return;
    }

    const widthPct = active.box.widthPct;
    const heightPct = active.box.heightPct;
    const xPct = snap(clamp(active.box.xPct + dx, 0, 100 - widthPct), [
      2,
      (100 - widthPct) / 2,
      100 - widthPct - 2,
    ]);
    const yPct = snap(clamp(active.box.yPct + dy, 0, 100 - heightPct), [
      2,
      (100 - heightPct) / 2,
      100 - heightPct - 2,
    ]);
    onChange({
      box: { ...active.box, xPct: Math.round(xPct), yPct: Math.round(yPct) },
    });
  };

  const end = (event: React.PointerEvent): void => {
    drag.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId))
      stage.current.releasePointerCapture(event.pointerId);
  };

  const splitLeft =
    value.side === "left" ? value.splitPct : 100 - value.splitPct;
  const presets: Array<{ layout: VideoSettings["layout"]; label: string }> = [
    { layout: "full", label: "Full" },
    { layout: "pip", label: "In a corner" },
    { layout: "split", label: "Side by side" },
  ];

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-3 gap-2">
        {presets.map((preset) => {
          const selected = value.layout === preset.layout;
          return (
            <button
              key={preset.layout}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange({ layout: preset.layout })}
              className="group text-left focus-visible:outline-none"
            >
              <span
                className={cn(
                  "relative block aspect-video w-full overflow-hidden rounded-md bg-surface-tertiary ring-1 transition-shadow",
                  selected
                    ? "ring-2 ring-teal-500"
                    : "ring-surface-border group-hover:ring-zinc-500",
                )}
              >
                <span className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-800 opacity-70" />
                {preset.layout === "full" && (
                  <span className="absolute inset-0 bg-zinc-500" />
                )}
                {preset.layout === "pip" && (
                  <span className="absolute bottom-[12%] right-[10%] h-[38%] w-[44%] rounded-[2px] bg-zinc-300 shadow-sm ring-1 ring-black/30" />
                )}
                {preset.layout === "split" && (
                  <span className="absolute inset-y-0 right-0 w-1/2 bg-zinc-300" />
                )}
              </span>
              <span
                className={cn(
                  "mt-1 block truncate text-center text-[10px]",
                  selected ? "font-semibold text-white" : "text-zinc-400",
                )}
              >
                {preset.label}
              </span>
            </button>
          );
        })}
      </div>

      <div
        ref={stage}
        className="relative aspect-video w-full touch-none select-none overflow-hidden rounded-lg bg-surface-secondary ring-1 ring-surface-border"
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {/* What the room sees behind the video. */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#2b2b2b] to-[#3a3a3a]" />
        <span
          className={cn(
            "pointer-events-none absolute top-1.5 text-[9px] font-medium uppercase tracking-[0.08em] text-zinc-500",
            value.layout === "split" && value.side === "left"
              ? "right-2"
              : "left-2",
          )}
        >
          Presentation
        </span>

        {value.layout === "full" && (
          <VideoPiece className="absolute inset-0" live={live} rounded={0} />
        )}

        {value.layout === "pip" && (
          <div
            className="absolute cursor-move"
            style={{
              left: `${value.box.xPct}%`,
              top: `${value.box.yPct}%`,
              width: `${value.box.widthPct}%`,
              height: `${value.box.heightPct}%`,
            }}
            onPointerDown={(event) => begin(event, "move")}
          >
            <VideoPiece className="h-full w-full" live={live} rounded={6} />
            <span
              role="presentation"
              title="Drag to resize"
              className="absolute bottom-0.5 right-0.5 size-3 cursor-nwse-resize rounded-sm border border-white/70 bg-white shadow"
              onPointerDown={(event) => {
                event.stopPropagation();
                begin(event, "resize");
              }}
            />
          </div>
        )}

        {value.layout === "split" && (
          <>
            <div
              className="absolute inset-y-0"
              style={{
                width: `${value.splitPct}%`,
                left: value.side === "left" ? 0 : undefined,
                right: value.side === "right" ? 0 : undefined,
              }}
            >
              <VideoPiece className="h-full w-full" live={live} rounded={0} />
            </div>
            <div
              className="absolute inset-y-0 z-10 w-2 -translate-x-1/2 cursor-col-resize"
              style={{ left: `${splitLeft}%` }}
              onPointerDown={(event) => begin(event, "divider")}
            >
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/70" />
              <span className="absolute left-1/2 top-1/2 h-7 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" />
            </div>
          </>
        )}
      </div>

      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] leading-snug text-zinc-500">
          {value.layout === "full"
            ? "The video fills the frame; the words sit over it."
            : value.layout === "pip"
              ? "Drag the video anywhere; pull its corner to resize. It snaps to the edges and centre."
              : "Drag the divider to change the split."}
        </p>

        {value.layout === "split" && (
          <button
            type="button"
            className="shrink-0 rounded-md px-1.5 py-1 text-[10px] text-black hover:bg-surface-tertiary hover:text-white bg-slate-50"
            onClick={() =>
              onChange({ side: value.side === "left" ? "right" : "left" })
            }
          >
            Swap sides
          </button>
        )}
      </div>
    </div>
  );
}

/** The dark video rectangle drawn on the layout canvas. */
function VideoPiece({
  className,
  live,
  rounded,
}: {
  className?: string;
  live: boolean;
  rounded: number;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1 overflow-hidden bg-zinc-900 text-[9px] font-medium text-zinc-300 ring-1 ring-white/20",
        className,
      )}
      style={{ borderRadius: rounded }}
    >
      <Video size={11} aria-hidden="true" />
      {live ? "Live video" : "Video"}
    </div>
  );
}
