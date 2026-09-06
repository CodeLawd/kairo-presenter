import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eraser, Trash2 } from '@/icons';
import { BoothToolbox } from "./BoothToolbox";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import { useAppStore } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";
import { clearLiveAll, clearLiveText } from "@/lib/clear-live-output";
import { normalizeMediaPlayback } from "@shared/media-playback";
import type {
  AppSettings,
  MediaLibrary,
  MediaPlayback,
  ScriptureResult,
} from "@shared/ipc";
import type { LiveOutputPayload } from "@shared/live-output";
import { LiveOutputPreview } from "./LiveOutputPreview";
import { useServiceStatuses } from "./useServiceStatuses";

interface LiveOutputRailProps {
  /** Width of the entire right rail, including its inner padding. */
  width: number;
  /** Optional override for screens that already own the current settings. */
  overlay?: AppSettings["overlay"];
  /** Optional media state for screens that already own the media subscription. */
  liveMedia?: { item: MediaLibrary["items"][number]; playback: MediaPlayback; paused?: boolean } | null;
  /** Optional local result/content; otherwise the shared last-live payload is used. */
  result?: ScriptureResult | null;
  content?: LiveOutputPayload | null;
  /** Operator-only resize affordance. Other screens use the same rail at a fixed width. */
  onResizeStart?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onResizeKeyDown?: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  /**
   * Status cards rendered below the preview. Omit it and the rail subscribes
   * for them itself, so every screen shows the same three cards.
   */
  serviceStatuses?: Array<{
    label: string;
    status: "ok" | "degraded" | "error" | "unknown";
    error?: string;
  }>;
  /** Operator scripture search + queue — becomes the first toolbox tab. */
  search?: ReactNode;
  className?: string;
}

/**
 * The shared right-hand rail used by Operator, Scripture, and Lyrics.
 * Preview, clear actions, and the toolbox stay the same on every screen.
 */
export function LiveOutputRail({
  width,
  overlay: overlayProp,
  liveMedia: liveMediaProp,
  search,
  result = null,
  content: contentProp,
  onResizeStart,
  onResizeKeyDown,
  serviceStatuses: serviceStatusesProp,
  className = "",
}: LiveOutputRailProps): React.ReactElement {
  const bootstrapOverlay = useBootstrapStore((state) => state.settings.overlay);
  const overlay = overlayProp ?? bootstrapOverlay;
  const storePayload = useAppStore((state) => state.liveOutputPreview);
  const payload = contentProp === undefined ? storePayload : contentProp;
  const selectedOutputId = useAppStore((state) => state.operatorPreviewOutputId);
  const onSelectOutput = useAppStore((state) => state.setOperatorPreviewOutputId);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrary | null>(null);
  const ownServiceStatuses = useServiceStatuses();
  const serviceStatuses = serviceStatusesProp ?? ownServiceStatuses;

  useEffect(() => {
    if (liveMediaProp !== undefined) return;
    let cancelled = false;
    window.api.media
      .getLibrary()
      .then((library) => {
        if (!cancelled) setMediaLibrary(library);
      })
      .catch(() => undefined);
    const unsubscribe = window.api.media.onLibraryChange((library) => setMediaLibrary(library));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [liveMediaProp]);

  const liveMediaFromLibrary = useMemo(() => {
    if (!mediaLibrary?.liveItemId) return null;
    const item = mediaLibrary.items.find((candidate) => candidate.id === mediaLibrary.liveItemId);
    if (!item) return null;
    return {
      item,
      playback: normalizeMediaPlayback(mediaLibrary.playback[item.id]),
      paused: mediaLibrary.livePaused,
    };
  }, [mediaLibrary]);
  const liveMedia = liveMediaProp === undefined ? liveMediaFromLibrary : liveMediaProp;
  // Stored settings do not guarantee array order, so sort by the configured
  // precedence — the picker should read the same as the Outputs screen.
  const outputs = useMemo(
    () =>
      overlay.outputs
        .filter((output) => output.enabled)
        .sort((a, b) => a.order - b.order),
    [overlay.outputs],
  );
  const previewWidth = Math.max(160, width - 1);
  const previewHeight = Math.round((previewWidth * 9) / 16);

  return (
    <div className="relative flex min-h-0 shrink-0">
      {onResizeStart && (
        <button
          type="button"
          aria-label="Resize live output preview panel"
          title="Drag to resize live output preview"
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize bg-transparent outline-none hover:bg-teal-500/15 focus-visible:bg-teal-500/20"
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
        />
      )}

      <aside
        className={`flex min-h-0 w-full flex-col overflow-hidden border-l border-surface-border bg-surface-secondary ${className}`}
        style={{ width }}
      >
        <div className="min-h-0 shrink-0 border-b border-white/10 bg-black">
          <div className="flex items-baseline justify-between gap-2 px-3 py-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Live output
            </p>
            <p className="text-[10px] text-zinc-600">ProPresenter</p>
          </div>
          <LiveOutputPreview
            outputs={outputs}
            selectedOutputId={selectedOutputId}
            onSelectOutput={onSelectOutput}
            result={result}
            content={payload}
            contentKind={payload?.kind ?? "scripture"}
            liveMedia={liveMedia}
            overlay={overlay}
            width={previewWidth}
            height={previewHeight}
            toolbar={
              <LiveClearActions
                hasText={Boolean(payload)}
                hasBackground={Boolean(liveMedia)}
              />
            }
          />
          {serviceStatuses && serviceStatuses.length > 0 && (
            <div className="grid grid-cols-3 gap-px border-t border-white/10 bg-black/40">
              {serviceStatuses.map((service) => (
                <div
                  key={service.label}
                  title={service.error}
                  className="flex items-center justify-center gap-1.5 bg-black/30 px-2 py-1.5"
                >
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      service.status === "ok"
                        ? "bg-emerald-500"
                        : service.status === "degraded"
                          ? "bg-amber-500"
                          : service.status === "error"
                            ? "bg-rose-500"
                            : "bg-zinc-600",
                    )}
                  />
                  <span className="text-[9px] font-semibold text-zinc-500">
                    {service.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <BoothToolbox search={search} />
      </aside>
    </div>
  );
}

function LiveClearActions({
  hasText,
  hasBackground,
}: {
  hasText: boolean
  hasBackground: boolean
}): React.ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <button
        type="button"
        disabled={!hasText}
        onClick={() => void clearLiveText()}
        title="Leave the background. Remove verse or lyric text."
        className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Eraser size={11} aria-hidden="true" />
        Clear text
      </button>
      <button
        type="button"
        disabled={!hasText && !hasBackground}
        onClick={() => void clearLiveAll()}
        title="Remove text and the dock background"
        className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Trash2 size={11} aria-hidden="true" />
        Clear all
      </button>
    </div>
  )
}
