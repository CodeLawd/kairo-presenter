import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Eraser, Trash2 } from '@/icons';
import { BoothToolbox } from "./BoothToolbox";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import { useAppStore } from "@/stores/useAppStore";
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
  /** Operator scripture search + queue — becomes the first toolbox tab. */
  search?: ReactNode;
  className?: string;
}

/**
 * The shared right-hand rail used by Operator, Scripture, and Lyrics.
 * Preview on top, inspector toolbox below — same bones as ProPresenter's
 * live/monitor + detail pane.
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
  className = "",
}: LiveOutputRailProps): React.ReactElement {
  const bootstrapOverlay = useBootstrapStore((state) => state.settings.overlay);
  const overlay = overlayProp ?? bootstrapOverlay;
  const storePayload = useAppStore((state) => state.liveOutputPreview);
  const payload = contentProp === undefined ? storePayload : contentProp;
  const selectedOutputId = useAppStore((state) => state.operatorPreviewOutputId);
  const onSelectOutput = useAppStore((state) => state.setOperatorPreviewOutputId);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrary | null>(null);

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
        className={`flex min-h-0 w-full flex-col overflow-hidden bg-surface-secondary ${className}`}
        style={{ width }}
      >
        <div className="min-h-0 shrink-0 bg-[#0e0e0e]">
          <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
            <p className="text-[11px] font-medium text-zinc-400">Live</p>
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
        className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Eraser size={11} aria-hidden="true" />
        Clear text
      </button>
      <button
        type="button"
        disabled={!hasText && !hasBackground}
        onClick={() => void clearLiveAll()}
        title="Remove text and the dock background"
        className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Trash2 size={11} aria-hidden="true" />
        Clear all
      </button>
    </div>
  )
}
