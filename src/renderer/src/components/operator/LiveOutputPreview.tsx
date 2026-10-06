import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpenCheck, ChevronDown, MonitorOff } from '@/icons';
import type { OverlayVideoTime } from "@shared/overlay-fit";
import { LiveVideoControls } from "./LiveVideoControls";
import { VerseThemePreview } from "@/components/scripture/VerseThemePreview";
import {
  formatOverlayReference,
  formatOverlayVerseText,
  renderOverlayTemplate,
} from "@shared/overlay-content";
import { renderOverlayHTML } from "@shared/overlay-template";
import { ScaledOverlayPreview } from "@/components/overlay/ScaledOverlayPreview";
import { usePresentation, useProgramState } from "@/hooks/useProgramState";
import { ProgramLayersPreview } from "./ConfidencePreview";
import { confidenceFor, programLayersFor } from "@shared/program";
import { themeForPush } from "@shared/media-playback";
import {
  isRenderedKind,
  outputRequiresPropresenter,
  outputTemplateFor,
  outputThemeFor,
} from "@shared/overlay-outputs";
import type {
  AppSettings,
  MediaItem,
  MediaPlayback,
  OverlayContentKind,
  OverlayOutput,
  OverlayTheme,
  ScriptureResult,
} from "@shared/ipc";
import type { LiveOutputPayload } from "@shared/live-output";
import { propresenterEnabled } from "@shared/pp-connect-gate";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";

// ─── Per-kind preview fidelity ─────────────────────────────────────────────────
// Only `ndi` and `screen` are rendered by this app, so only they can be shown WYSIWYG. The
// others are styled inside ProPresenter, and pretending otherwise would show the
// operator a slide that does not exist. Each kind is labelled with how much of
// what you see is real.

const EMPTY_TIME: OverlayVideoTime = { currentTime: 0, duration: 0, ended: false };

interface LiveOutputPreviewProps {
  /** Enabled outputs, in the order the Outputs panel lists them. */
  outputs: OverlayOutput[];
  selectedOutputId: string | null;
  onSelectOutput: (outputId: string) => void;
  /** Verse currently live, or null when nothing has been sent. */
  result: ScriptureResult | null;
  /** Generic content sent to ProPresenter (used by the cross-tab review panels). */
  content?: LiveOutputPayload | null;
  /** Content kind used when rendering a result without a generic payload. */
  contentKind?: OverlayContentKind;
  /** Background currently live from the media dock. */
  liveMedia?: { item: MediaItem; playback: MediaPlayback; paused?: boolean } | null;
  overlay: AppSettings["overlay"];
  width: number;
  height: number;
  /** Actions that belong under the monitor — clear, etc. */
  toolbar?: ReactNode;
}

export function LiveOutputPreview({
  outputs: allOutputs,
  selectedOutputId,
  onSelectOutput,
  result,
  content = null,
  contentKind = "scripture",
  liveMedia = null,
  overlay,
  width,
  height,
  toolbar,
}: LiveOutputPreviewProps): React.ReactElement {
  // ProPresenter outputs only show up here once the integration is on.
  const ppOn = useBootstrapStore((s) => propresenterEnabled(s.settings));
  const outputs = ppOn ? allOutputs : allOutputs.filter((output) => !outputRequiresPropresenter(output.kind));
  // Fall back to the first output that can actually be drawn: a library output
  // is triggered inside ProPresenter, so defaulting to it shows a placeholder
  // and hides the render this panel exists to show.
  const selected =
    outputs.find((output) => output.id === selectedOutputId) ??
    outputs.find((output) => output.kind !== "library") ??
    outputs[0] ??
    null;

  const [mediaTime, setMediaTime] = useState(EMPTY_TIME);
  const [seekTo, setSeekTo] = useState<{ token: number; seconds: number } | null>(null);

  useEffect(() => {
    setMediaTime(EMPTY_TIME);
    setSeekTo(null);
  }, [liveMedia?.item.id]);

  const onTime = useCallback((time: OverlayVideoTime) => {
    setMediaTime(time);
  }, []);

  const seek = useCallback((seconds: number) => {
    const duration = mediaTime.duration;
    const next = duration > 0 ? Math.min(duration, Math.max(0, seconds)) : Math.max(0, seconds);
    setSeekTo((current) => ({ token: (current?.token ?? 0) + 1, seconds: next }));
    setMediaTime((current) => ({ ...current, currentTime: next, ended: false }));
    void window.api.media.seek(next);
  }, [mediaTime.duration]);

  const showTransport =
    !!selected && isRenderedKind(selected.kind) && selected.show.backgrounds && liveMedia?.item.kind === "video";
  const program = useProgramState();
  const [presentation] = usePresentation();
  const rendered = !!selected && isRenderedKind(selected.kind);
  const layers = useMemo(
    () => (rendered && selected ? programLayersFor(selected, program, presentation) : null),
    [rendered, selected, program, presentation],
  );
  const info = useMemo(
    () => (rendered && selected ? confidenceFor(selected, program, presentation) : null),
    [rendered, selected, program, presentation],
  );
  const drawn = !!info || !!(layers && (layers.props || layers.message || layers.logo));

  return (
    <div>
      <div className="relative" style={{ width, height }}>
        <PreviewBody
          output={selected}
          result={result}
          content={content}
          contentKind={contentKind}
          liveMedia={liveMedia}
          overlay={overlay}
          width={width}
          height={height}
          seekTo={seekTo}
          onTime={onTime}
          blankWhenIdle={drawn}
        />
        {drawn && layers && <ProgramLayersPreview layers={layers} info={info} width={width} />}
      </div>

      {showTransport && liveMedia && (
        <LiveVideoControls
          key={liveMedia.item.id}
          paused={!!liveMedia.paused}
          ended={mediaTime.ended}
          loop={liveMedia.playback.loop}
          currentTime={mediaTime.currentTime}
          duration={mediaTime.duration}
          onTogglePause={() => {
            void window.api.media.setPaused(!(liveMedia.paused || mediaTime.ended));
          }}
          onSeek={seek}
          onSkip={(delta) => seek(mediaTime.currentTime + delta)}
          onRestart={() => seek(0)}
          onToggleLoop={() => {
            void window.api.media.setPlayback(liveMedia.item.id, {
              loop: !liveMedia.playback.loop,
            });
          }}
        />
      )}

      {/* Screen picker sits BELOW the frame, the way ProPresenter's own output
          preview does — the label names what you are looking at, and opening it
          is how you look at something else. */}
      <div className="flex items-center justify-between gap-3 bg-surface-secondary px-3 py-2">
        <div className="relative min-w-0 w-full max-w-64 rounded-md bg-surface-elevated transition-colors hover:bg-zinc-700 focus-within:ring-2 focus-within:ring-teal-400/60">
          <select
            className="w-full cursor-pointer appearance-none truncate bg-transparent px-2.5 py-2 pr-8 text-xs font-semibold text-zinc-100 outline-none disabled:cursor-default disabled:text-zinc-500"
            value={selected?.id ?? ''}
            onChange={(e) => onSelectOutput(e.target.value)}
            disabled={outputs.length === 0}
            aria-label="Preview output"
          >
            {outputs.length === 0 && <option value="">No screens on</option>}
            {outputs.map((output) => (
              <option key={output.id} value={output.id}>
                {output.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
        </div>

        {toolbar}
      </div>
    </div>
  );
}

function PreviewBody({
  output,
  result,
  content,
  contentKind,
  liveMedia,
  overlay,
  width,
  height,
  seekTo,
  onTime,
  blankWhenIdle = false,
}: {
  output: OverlayOutput | null;
  result: ScriptureResult | null;
  content: LiveOutputPayload | null;
  contentKind: OverlayContentKind;
  liveMedia: { item: MediaItem; playback: MediaPlayback; paused?: boolean } | null;
  overlay: AppSettings["overlay"];
  width: number;
  height: number;
  seekTo: { token: number; seconds: number } | null;
  onTime: (time: OverlayVideoTime) => void;
  /** Countdown, clock or stage message are drawn on top — show the black screen, not a placeholder. */
  blankWhenIdle?: boolean;
}): React.ReactElement {
  // Same rules the push takes (orchestrator `pushRendered`): this screen's Look
  // decides what reaches it, and a verse on a theme that owns its background
  // keeps it even while the dock loop runs. Backgrounds off = words on black.
  const kind = content?.kind ?? contentKind;
  const showsBackgrounds = !output || !isRenderedKind(output.kind) || output.show.backgrounds;
  const showsText = !output || !isRenderedKind(output.kind) || output.show[kind];
  if (!showsBackgrounds) liveMedia = null;
  if (!showsText) {
    result = null;
    content = null;
  }
  // A background with nothing over it is the dock's own "present this", so it wins (force).
  const force = kind === "lyrics" || (!result && !content);
  const liveItem = liveMedia?.item ?? null;
  const playback = liveMedia?.playback;
  const theme = useMemo(
    () =>
      output
        ? themeForPush(outputThemeFor(output, kind), { showsBackgrounds, live: liveItem, playback, force })
        : null,
    [output, kind, showsBackgrounds, liveItem, playback, force],
  );

  if (!output || !theme) {
    return (
      <EmptyFrame width={width} height={height} icon={MonitorOff} title="No screens on">
        Turn one on in Theme → Output
      </EmptyFrame>
    );
  }

  if (!result && !content && !liveMedia) {
    if (blankWhenIdle) return <div className="bg-black" style={{ width, height }} />;
    return (
      <EmptyFrame width={width} height={height} icon={BookOpenCheck} title="Nothing is live">
        Send a verse or click a background
      </EmptyFrame>
    );
  }

  // The one destination this app renders itself, so the preview is the output.
  if (isRenderedKind(output.kind)) {
    if (result && kind === "scripture") {
      return (
        <VerseThemePreview
          result={result}
          theme={theme}
          showTranslation={overlay.showTranslation}
          showVerseNumbers={overlay.showVerseNumbers}
          maxVerses={1}
          width={width}
          height={height}
          isFocused={false}
          isLive
          sendStatus="sent"
          chrome={false}
          motion
          paused={!!liveMedia?.paused}
          seekTo={seekTo}
          onTime={onTime}
          onSelect={() => undefined}
          cardRef={() => undefined}
        />
      );
    }
    if (content) {
      return (
        <GenericThemePreview
          content={content}
          theme={theme}
          width={width}
          height={height}
          paused={!!liveMedia?.paused}
          seekTo={seekTo}
          onTime={onTime}
        />
      );
    }
    return (
      <BackgroundPreview
        theme={theme}
        width={width}
        height={height}
        paused={!!liveMedia?.paused}
        seekTo={seekTo}
        onTime={onTime}
      />
    );
  }

  if (output.kind === "library") {
    return (
      <EmptyFrame width={width} height={height} icon={MonitorOff} title="ProPresenter slide">
        Triggered from your library — this app never sees its design
      </EmptyFrame>
    );
  }

  if (!result && !content) {
    return (
      <EmptyFrame width={width} height={height} icon={MonitorOff} title="Background is on NDI">
        This output does not show dock backgrounds
      </EmptyFrame>
    );
  }

  // message | stage — we know exactly what text goes across the wire, so show
  // that and nothing more. Same renderer the stage push uses.
  const text = content?.text ?? (result
    ? formatOverlayVerseText(result.verses, {
        showVerseNumbers: overlay.showVerseNumbers,
        maxVerses: 1,
      })
    : "");
  const body = text
    ? renderOverlayTemplate(outputTemplateFor(output, kind), {
        reference: content
          ? content.reference
          : formatOverlayReference(
              result!.reference,
              result!.translation,
              overlay.showTranslation,
            ),
        text,
      })
    : "";

  return (
    <div
      className="overflow-auto bg-zinc-950 p-3"
      style={{ width, height }}
    >
      <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-200">
        {body}
      </pre>
    </div>
  );
}

function GenericThemePreview({
  content,
  theme,
  width,
  height,
  paused = false,
  seekTo = null,
  onTime,
}: {
  content: LiveOutputPayload;
  theme: OverlayTheme;
  width: number;
  height: number;
  paused?: boolean;
  seekTo?: { token: number; seconds: number } | null;
  onTime?: (time: OverlayVideoTime) => void;
}): React.ReactElement {
  const html = useMemo(
    () =>
      renderOverlayHTML(theme, content.reference, content.text, 1920, 1080, {
        coloredLines: content.lineColors
          ? content.text.split('\n').map((text, index) => ({
              text,
              color: content.lineColors?.[index],
            }))
          : undefined,
      }),
    [content.lineColors, content.reference, content.text, theme],
  );

  return (
    <div
      className="relative overflow-hidden bg-black"
      style={{ width, height }}
    >
      <ScaledOverlayPreview
        html={html}
        autoFit={theme.layout.autoFitText}
        width={width}
        height={height}
        motion
        paused={paused}
        seekTo={seekTo}
        onTime={onTime}
      />
    </div>
  );
}

function BackgroundPreview({
  theme,
  width,
  height,
  paused = false,
  seekTo = null,
  onTime,
}: {
  theme: OverlayTheme;
  width: number;
  height: number;
  paused?: boolean;
  seekTo?: { token: number; seconds: number } | null;
  onTime?: (time: OverlayVideoTime) => void;
}): React.ReactElement {
  const html = useMemo(() => renderOverlayHTML(theme, "", ""), [theme]);

  return (
    <div
      className="relative overflow-hidden bg-black"
      style={{ width, height }}
    >
      <ScaledOverlayPreview
        html={html}
        autoFit={false}
        width={width}
        height={height}
        motion
        paused={paused}
        seekTo={seekTo}
        onTime={onTime}
      />
    </div>
  );
}

function EmptyFrame({
  width,
  height,
  icon: Icon,
  title,
  children,
}: {
  width: number;
  height: number;
  icon: typeof BookOpenCheck;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className="flex flex-col items-center justify-center bg-zinc-950 px-3 text-center text-zinc-600"
      style={{ width, height }}
    >
      <Icon size={20} className="mb-2 text-slate-600" />
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-0.5 text-[10px] text-slate-600">{children}</p>
    </div>
  );
}
