import { useMemo } from "react";
import { BookOpenCheck, ChevronDown, MonitorOff } from "lucide-react";
import { VerseThemePreview } from "@/components/scripture/VerseThemePreview";
import {
  formatOverlayReference,
  formatOverlayVerseText,
  renderOverlayTemplate,
} from "@shared/overlay-content";
import { renderOverlayHTML } from "@shared/overlay-template";
import { ScaledOverlayPreview } from "@/components/overlay/ScaledOverlayPreview";
import { themeOwnsBackground, themeWithLiveMedia } from "@shared/media-playback";
import { layerLabel, layerOfKind } from "@shared/overlay-outputs";
import type {
  AppSettings,
  MediaItem,
  MediaPlayback,
  OverlayOutput,
  OverlayTheme,
  ScriptureResult,
} from "@shared/ipc";

// ─── Per-kind preview fidelity ─────────────────────────────────────────────────
// Only `ndi` is rendered by this app, so only `ndi` can be shown WYSIWYG. The
// others are styled inside ProPresenter, and pretending otherwise would show the
// operator a slide that does not exist. Each kind is labelled with how much of
// what you see is real.

const FIDELITY: Record<OverlayOutput["kind"], string> = {
  ndi: "Exact — this app renders these pixels",
  stage: "Exact — stage messages are plain text",
  message: "Text is exact; ProPresenter controls the styling",
  library: "ProPresenter renders this slide — no preview available",
};

interface LiveOutputPreviewProps {
  /** Enabled outputs, in the order the Outputs panel lists them. */
  outputs: OverlayOutput[];
  selectedOutputId: string | null;
  onSelectOutput: (outputId: string) => void;
  /** Verse currently live, or null when nothing has been sent. */
  result: ScriptureResult | null;
  /** Background currently live from the media dock. */
  liveMedia?: { item: MediaItem; playback: MediaPlayback } | null;
  overlay: AppSettings["overlay"];
  width: number;
  height: number;
}

export function LiveOutputPreview({
  outputs,
  selectedOutputId,
  onSelectOutput,
  result,
  liveMedia = null,
  overlay,
  width,
  height,
}: LiveOutputPreviewProps): React.ReactElement {
  // Fall back to the first enabled output so the panel is never blank just
  // because a remembered selection was disabled or deleted.
  const selected =
    outputs.find((output) => output.id === selectedOutputId) ?? outputs[0] ?? null;

  return (
    <div className="space-y-1.5">
      <PreviewBody
        output={selected}
        result={result}
        liveMedia={liveMedia}
        overlay={overlay}
        width={width}
        height={height}
      />

      {/* Screen picker sits BELOW the frame, the way ProPresenter's own output
          preview does — the label names what you are looking at, and opening it
          is how you look at something else. */}
      <div className="flex items-center gap-2" style={{ width }}>
        <div className="relative min-w-0 flex-1">
          <select
            className="w-full cursor-pointer appearance-none truncate rounded-md bg-transparent py-1 pl-1 pr-6 text-xs font-semibold text-slate-200 outline-none transition-colors hover:text-white focus-visible:ring-1 focus-visible:ring-teal-500/40"
            value={selected?.id ?? ''}
            onChange={(e) => onSelectOutput(e.target.value)}
            disabled={outputs.length === 0}
            aria-label="Preview output"
            title={selected ? FIDELITY[selected.kind] : undefined}
          >
            {outputs.length === 0 && <option value="">No outputs enabled</option>}
            {outputs.map((output) => (
              <option key={output.id} value={output.id}>
                {output.name}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-slate-500"
          />
        </div>

        {selected && (
          <span
            className="shrink-0 text-[10px] text-slate-600"
            title={FIDELITY[selected.kind]}
          >
            {layerLabel(layerOfKind(selected.kind))}
          </span>
        )}
      </div>
    </div>
  );
}

function PreviewBody({
  output,
  result,
  liveMedia,
  overlay,
  width,
  height,
}: {
  output: OverlayOutput | null;
  result: ScriptureResult | null;
  liveMedia: { item: MediaItem; playback: MediaPlayback } | null;
  overlay: AppSettings["overlay"];
  width: number;
  height: number;
}): React.ReactElement {
  // Same rule the push takes (orchestrator `withLiveBackground`): a verse on a
  // theme that owns its background keeps it, even while the dock loop runs.
  const theme = output
    ? result && themeOwnsBackground(output.theme)
      ? output.theme
      : themeWithLiveMedia(output.theme, liveMedia?.item ?? null, liveMedia?.playback)
    : null;

  if (!output || !theme) {
    return (
      <EmptyFrame width={width} height={height} icon={MonitorOff} title="No outputs enabled">
        Turn one on in Theme → Output
      </EmptyFrame>
    );
  }

  if (!result && !liveMedia) {
    return (
      <EmptyFrame width={width} height={height} icon={BookOpenCheck} title="Nothing is live">
        Send a verse or click a background
      </EmptyFrame>
    );
  }

  // The one destination this app renders itself, so the preview is the output.
  if (output.kind === "ndi") {
    if (result) {
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
          onSelect={() => undefined}
          cardRef={() => undefined}
        />
      );
    }
    return <BackgroundPreview theme={theme} width={width} height={height} />;
  }

  if (output.kind === "library") {
    return (
      <EmptyFrame width={width} height={height} icon={MonitorOff} title="ProPresenter slide">
        Triggered from your library — this app never sees its design
      </EmptyFrame>
    );
  }

  if (!result) {
    return (
      <EmptyFrame width={width} height={height} icon={MonitorOff} title="Background is on NDI">
        This output does not show dock backgrounds
      </EmptyFrame>
    );
  }

  // message | stage — we know exactly what text goes across the wire, so show
  // that and nothing more. Same renderer the stage push uses.
  const text = formatOverlayVerseText(result.verses, {
    showVerseNumbers: overlay.showVerseNumbers,
    maxVerses: 1,
  });
  const body = text
    ? renderOverlayTemplate(output.template, {
        reference: formatOverlayReference(
          result.reference,
          result.translation,
          overlay.showTranslation,
        ),
        text,
      })
    : "";

  return (
    <div
      className="overflow-auto rounded-xl border border-surface-border bg-surface p-3"
      style={{ width, height }}
    >
      <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-slate-200">
        {body}
      </pre>
    </div>
  );
}

function BackgroundPreview({
  theme,
  width,
  height,
}: {
  theme: OverlayTheme;
  width: number;
  height: number;
}): React.ReactElement {
  const html = useMemo(() => renderOverlayHTML(theme, "", ""), [theme]);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-teal-400/40 bg-black"
      style={{ width, height }}
    >
      <ScaledOverlayPreview
        html={html}
        autoFit={false}
        width={width}
        height={height}
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
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-border bg-surface px-3 text-center text-slate-500"
      style={{ width, height }}
    >
      <Icon size={20} className="mb-2 text-slate-600" />
      <p className="text-xs font-semibold">{title}</p>
      <p className="mt-0.5 text-[10px] text-slate-600">{children}</p>
    </div>
  );
}
