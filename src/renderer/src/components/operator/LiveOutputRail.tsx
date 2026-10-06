import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BoothToolbox } from "./BoothToolbox";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import { useAppStore } from "@/stores/useAppStore";
import { LiveLayerStrip } from "./LiveLayerStrip";
import { normalizeMediaPlayback } from "@shared/media-playback";
import type {
  MediaLibrary,
  ScriptureResult,
} from "@shared/ipc";
import { LiveOutputPreview } from "./LiveOutputPreview";

interface LiveOutputRailProps {
  /** Width of the entire right rail, including its inner padding. */
  width: number;
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
  search,
  onResizeStart,
  onResizeKeyDown,
  className = "",
}: LiveOutputRailProps): React.ReactElement {
  const settings = useBootstrapStore((state) => state.settings);
  const overlay = settings.overlay;
  const payload = useAppStore((state) => state.liveOutputPreview);
  const selectedOutputId = useAppStore((state) => state.operatorPreviewOutputId);
  const onSelectOutput = useAppStore((state) => state.setOperatorPreviewOutputId);
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrary | null>(null);

  useEffect(() => {
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
  }, []);

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
  const liveMedia = liveMediaFromLibrary;
  const result = useMemo<ScriptureResult | null>(() => {
    if (payload?.kind !== "scripture") return null;
    const parsed = payload.reference.match(/^(.+?)\s+(\d+):(\d+)/);
    return {
      reference: payload.reference,
      translation: payload.translation ?? settings.scripture.defaultTranslation,
      verses: payload.verses?.length ? payload.verses : [{
        book: parsed?.[1] ?? "",
        chapter: Number(parsed?.[2] ?? 0),
        verse: Number(parsed?.[3] ?? 0),
        text: payload.text,
      }],
    };
  }, [payload, settings.scripture.defaultTranslation]);
  // Stored settings do not guarantee array order, so sort by the configured
  // precedence — the picker should read the same as the Outputs screen.
  const outputs = useMemo(
    () =>
      overlay.outputs
        .filter((output) => output.enabled)
        .sort((a, b) => a.order - b.order),
    [overlay.outputs],
  );
  // The clear-layer column (36px + its hairline) sits beside the frame.
  const previewWidth = Math.max(160, width - 38);
  const previewHeight = Math.round((previewWidth * 9) / 16);

  return (
    // pl-1.5: a gutter of the workspace background, so the rail reads as its
    // own panel next to the middle column instead of running into it.
    <div className="relative flex min-h-0 shrink-0 pl-1.5">
      {onResizeStart && (
        <button
          type="button"
          aria-label="Resize live output preview panel"
          title="Drag to resize live output preview"
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize bg-transparent outline-none hover:bg-tint-teal focus-visible:bg-tint-teal"
          onPointerDown={onResizeStart}
          onKeyDown={onResizeKeyDown}
        />
      )}

      <aside
        // The rail's own background shows only in the gutter between the live
        // output and the toolbox — two separate panels, not one long column.
        className={`flex min-h-0 w-full flex-col overflow-hidden bg-surface ${className}`}
        style={{ width }}
      >
        <div className="min-h-0 shrink-0 bg-[#0e0e0e]">
          <div className="flex items-baseline justify-between gap-2 px-3 py-1.5">
            <p className="text-[11px] font-medium text-zinc-400">Live</p>
          </div>
          <div className="flex">
          <div className="min-w-0 flex-1">
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
          />
          </div>
          <LiveLayerStrip hasText={Boolean(payload)} hasBackground={Boolean(liveMedia)} />
          </div>
        </div>

        <div className="mt-1.5 flex min-h-0 flex-1 flex-col">
          <BoothToolbox search={search} />
        </div>
      </aside>
    </div>
  );
}
