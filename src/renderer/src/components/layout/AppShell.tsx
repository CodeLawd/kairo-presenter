import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import {
  Bible,
  Eraser,
  MonitorPlay,
  MediaLibrary,
  Pause,
  Play,
  Radio,
  Settings,
} from "@/icons";
import { ChatsCircle, Presentation, Globe, Gauge as CircleGauge, MusicNotes as Music2, Palette } from "@phosphor-icons/react";
import type { NavRoute } from "@/App";
import { AccountRailButton, AudioRailButton } from "./RailPopovers";
import { FeedbackRailButton } from "./FeedbackRailButton";
import { useAppStore } from "@/stores/useAppStore";
import { useMediaDockStore } from "@/stores/useMediaDockStore";
import { useTracksPlaybackStore } from "@/stores/useTracksPlaybackStore";
import { clearLiveAll } from "@/lib/clear-live-output";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import { isRenderedKind } from "@shared/overlay-outputs";
import UpdatePill from "./UpdatePill";
import ActivationChip from "./ActivationChip";
import { ToolbarButton } from "./ToolbarButton";
import { ThemePicker } from "./ThemePicker";
import { cn } from "@/lib/utils";
import { Popover } from "radix-ui";
import { Switch } from "@/components/ui/switch";
import { saveOutputSettings } from "@/lib/output-settings";
import { hueStyle, railHueClass, RAIL_LABEL, type Hue } from "@/lib/hue";
import { HEADER_TOOLBAR_SLOT_ID } from "./header-toolbar";
import { KairoMark } from "@/components/brand/KairoMark";
import { useCaptureElapsed, useCaptureStore } from "@/stores/useCaptureStore";
import {
  CAPTURE_CODECS,
  CAPTURE_RESOLUTIONS,
  captureSourceFor,
  formatCaptureElapsed,
  normalizeCaptureSettings,
} from "@shared/capture";

const IS_MAC = navigator.platform.startsWith("Mac");

/** Whether the main window is full screen, following it as it changes. */
function useFullScreen(): boolean {
  const [fullScreen, setFullScreen] = useState(false);
  useEffect(() => {
    let live = true;
    void window.api.app
      .isFullScreen()
      .then((value) => {
        if (live) setFullScreen(value);
      })
      .catch(() => undefined);
    const unsubscribe = window.api.app.onFullScreenChange(setFullScreen);
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return fullScreen;
}
const workspaces: Array<{
  id: NavRoute;
  label: string;
  /** Shorter name for the rail, where it sits under the icon in a narrow column. */
  rail?: string;
  /** What the rail's shortened name stands for, on hover. */
  hint?: string;
  icon: typeof CircleGauge | typeof Bible;
  hue: Hue;
}> = [
  { id: "operator", label: "Operator", icon: CircleGauge, hue: "green" },
  { id: "scripture", label: "Bible", icon: Bible, hue: "blue" },
  { id: "lyrics", label: "Lyrics", icon: Music2, hue: "violet" },
  { id: "documents", label: "Slides", icon: Presentation, hue: "cyan" },
  { id: "audience", label: "Engage", icon: ChatsCircle, hue: "coral" },
  { id: "web", label: "Web", icon: Globe, hue: "indigo" },
  {
    id: "theme",
    label: "Theme Editor",
    rail: "Theme",
    hint: "Create and edit themes",
    icon: Palette,
    hue: "pink",
  },
];

interface WorkspaceRailProps {
  currentRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onOpenSettings: () => void;
}

export function WorkspaceRail({
  currentRoute,
  onNavigate,
  onOpenSettings,
}: WorkspaceRailProps): React.ReactElement {
  return (
    <nav
      className="workspace-rail flex shrink-0 flex-col items-center"
      aria-label="Workspaces"
    >
      {/* Scrolls only when the window is too short for the whole list; the
          foot of the rail (audio, account, settings) always stays put. */}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto px-1 py-3">
        {workspaces.map(({ id, label, rail, hint, icon: Icon, hue }) => {
          const active = currentRoute === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onNavigate(id)}
              aria-current={active ? "page" : undefined}
              // The visible name is the accessible name; only a shortened rail
              // label needs the full one on hover.
              title={rail ? (hint ? `${label} — ${hint}` : label) : undefined}
              style={hueStyle(hue)}
              className={railHueClass(active)}
            >
              <Icon size={20} weight="fill" aria-hidden="true" />
              <span className={RAIL_LABEL}>{rail ?? label}</span>
            </button>
          );
        })}
      </div>
      <div className="flex w-full shrink-0 flex-col items-center gap-1 px-1 pb-1">
        <FeedbackRailButton context={currentRoute} />
        <AudioRailButton />
        <AccountRailButton />
      </div>
      <div className="w-full shrink-0 px-1 pb-3">
        <button
          type="button"
          onClick={onOpenSettings}
          // Settings stays neutral — it's housekeeping, not a place to work.
          className="flex w-full flex-col items-center justify-center gap-[3px] rounded-lg px-0.5 py-1 text-zinc-500 transition-colors duration-150 hover:bg-surface-tertiary hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <Settings size={20} aria-hidden="true" />
          <span className={RAIL_LABEL}>Settings</span>
        </button>
      </div>
    </nav>
  );
}

/** The media dock belongs beside the other presentation controls. */
function MediaToolbarButton(): React.ReactElement {
  const { open, toggle, liveItemId, liveName } = useMediaDockStore(useShallow((state) => ({ open: state.open, toggle: state.toggle, liveItemId: state.liveItemId, liveName: state.liveName })));
  return (
    <ToolbarButton
      label="Media"
      title={`${open ? "Close" : "Open"} media${liveName ? ` — ${liveName} on screen` : ""}`}
      onClick={toggle}
      pressed={open}
    >
      <span className="relative" aria-hidden="true">
        <MediaLibrary
          size={15}
          weight={open ? "fill" : "regular"}
          style={hueStyle("orange")}
          className="text-[rgb(var(--hue))]"
        />
        {liveItemId && (
          <span className="absolute -right-1 -top-0.5 size-2 rounded-full bg-live ring-2 ring-surface-tertiary" />
        )}
      </span>
    </ToolbarButton>
  );
}

interface AppShellProps {
  currentRoute: NavRoute;
  /** Route-specific controls rendered inline in the top bar (see OperatorToolbar). */
  toolbar?: React.ReactNode;
}

const LIVE_MENU_ITEM =
  "flex min-h-8 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] text-zinc-200 hover:bg-surface-menu-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-400 disabled:opacity-50";

/** Plain capture actions, with settings separated by a single hairline. */
function CaptureSection({
  onSettings,
}: {
  onSettings: () => void;
}): React.ReactElement {
  const { status, busy, start, stop } = useCaptureStore();
  const elapsed = useCaptureElapsed();
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs);
  const settings = normalizeCaptureSettings(
    useBootstrapStore((s) => s.settings.capture),
  );
  const source = captureSourceFor(settings, outputs);
  const codec =
    CAPTURE_CODECS.find((c) => c.value === settings.codec)?.label.replace(
      /^Apple /,
      "",
    ) ?? "";
  const size =
    CAPTURE_RESOLUTIONS.find((r) => r.value === settings.resolution)?.value ??
    "";
  const plan = [
    source?.name ?? "No screen",
    `${codec} ${size}${settings.frameRate}`,
    settings.audioDeviceId ? settings.audioDeviceName || "Sound" : "No sound",
  ].join(" · ");
  return (
    <section aria-label="Capture">
      <button
        type="button"
        disabled={busy || (!status.recording && (!status.available || !source))}
        title={
          (status.recording
            ? status.sourceName
            : status.available
              ? plan
              : status.reason) ?? undefined
        }
        className={LIVE_MENU_ITEM}
        onClick={() => void (status.recording ? stop() : start())}
      >
        <span className="flex-1">
          {busy
            ? status.recording
              ? "Stopping…"
              : "Starting…"
            : status.recording
              ? "Stop Capture"
              : "Start Capture"}
        </span>
        {status.recording && (
          <span className="text-xs tabular-nums text-zinc-400">
            {formatCaptureElapsed(elapsed)}
          </span>
        )}
      </button>
      {status.recording && status.warning && (
        <p className="px-3 py-1 text-[11px] text-amber-400">{status.warning}</p>
      )}
      {!status.recording && status.error && (
        <p role="alert" className="px-3 py-1 text-[11px] text-red-400">
          {status.error}
        </p>
      )}
      <div className="mx-3 my-1 border-t-[0.5px] border-surface-menu-line" />
      <button type="button" onClick={onSettings} className={LIVE_MENU_ITEM}>
        Capture Settings…
      </button>
    </section>
  );
}

function LiveMenu({
  label,
  live,
  detail,
}: {
  label: string;
  live: boolean;
  detail: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const recording = useCaptureStore((s) => s.status.recording);
  const elapsed = useCaptureElapsed();
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs);
  const status = useBootstrapStore((s) => s.ndiStatus);
  const syphons = outputs.filter((o) => o.kind === "syphon");
  const setEnabled = (id: string, enabled: boolean): void => {
    void saveOutputSettings((current) =>
      current.map((o) => (o.id === id ? { ...o, enabled } : o)),
    );
  };
  // Straight to the work: a new Syphon output, or the existing one.
  const openScreens = (): void => {
    setOpen(false);
    useAppStore
      .getState()
      .openScreens(syphons.length === 0 ? "add:syphon" : "kind:syphon");
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div aria-live="polite" className="header-live-label">
          <ToolbarButton
            label={
              recording ? `${label} · ${formatCaptureElapsed(elapsed)}` : label
            }
            tone={live || recording ? "live" : "muted"}
            title={`${detail}${recording ? ` · recording ${formatCaptureElapsed(elapsed)}` : ""}. Click for live outputs and capture`}
            onClick={() => setOpen(!open)}
            labelClassName="header-live-text tabular-nums"
          >
            {/* Recording shows as a red dot on the icon, as on a camera. */}
            <span className="relative" aria-hidden="true">
              <Radio size={15} />
              {recording && (
                <span className="absolute -right-1 -top-0.5 size-2 animate-pulse rounded-full bg-live ring-2 ring-surface-tertiary" />
              )}
            </span>
          </ToolbarButton>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <div className="contents">
          {/* Cover Electron's draggable header too: native drag regions do not
            send the pointer events Radix uses for outside-click dismissal. */}
          <div
            aria-hidden="true"
            className="no-drag fixed inset-0 z-40 bg-transparent"
            onPointerDown={() => setOpen(false)}
          />
          <Popover.Content
            side="bottom"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            className="z-50 w-64 max-w-[calc(100vw-24px)] overflow-hidden rounded-xl bg-surface-menu p-1 text-zinc-200 ring-1 ring-surface-menu-line animate-spring-in"
          >
            {!IS_MAC && (
              <p className="px-3 py-2 text-[13px] text-zinc-200">{detail}</p>
            )}
            {IS_MAC && (
              <CaptureSection
                onSettings={() => {
                  setOpen(false);
                  useAppStore.getState().openCapture();
                }}
              />
            )}
            {IS_MAC && (
              <section aria-label="Syphon">
                <div className="mx-3 my-1 border-t-[0.5px] border-surface-menu-line" />
                {syphons.map((output) => {
                  const state = status?.outputs.find((o) => o.id === output.id);
                  return (
                    <label
                      key={output.id}
                      className="flex min-h-8 items-center gap-3 rounded-md px-3 py-2 hover:bg-surface-menu-hover"
                      title={
                        !output.enabled
                          ? "Off"
                          : state?.ready
                            ? "Sending"
                            : state?.reason || "Starting"
                      }
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">
                        {output.name}
                      </span>
                      <Switch
                        size="sm"
                        checked={output.enabled}
                        onCheckedChange={(on) => setEnabled(output.id, on)}
                        aria-label={`Send ${output.name} over Syphon`}
                      />
                    </label>
                  );
                })}
                <button
                  type="button"
                  onClick={openScreens}
                  className={LIVE_MENU_ITEM}
                >
                  {syphons.length === 0 ? "Set up Syphon…" : "Syphon Settings…"}
                </button>
              </section>
            )}
          </Popover.Content>
        </div>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * One line for the header: are Kairo's own outputs (screens, NDI) on the air.
 * Polls the same readiness the Screens window shows, and shares it through the
 * bootstrap store so nothing else has to poll.
 */
function useScreensStatus(): {
  detail: string;
  state: "ready" | "warning" | "offline";
} {
  const outputs = useBootstrapStore((s) => s.settings.overlay.outputs);
  const status = useBootstrapStore((s) => s.ndiStatus);
  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      window.api.ndi
        .getStatus()
        .then((next) => {
          if (cancelled) return;
          const store = useBootstrapStore.getState();
          if (JSON.stringify(store.ndiStatus) !== JSON.stringify(next))
            store.setNdiStatus(next);
        })
        .catch(() => undefined);
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const rendered = outputs.filter((o) => o.enabled && isRenderedKind(o.kind));
  if (rendered.length === 0)
    return { detail: "No screens set up — click to add one", state: "offline" };
  const problems = rendered.filter((o) => {
    const s = status?.outputs.find((x) => x.id === o.id);
    return !s || !s.ready;
  });
  if (problems.length === 0) {
    return {
      detail:
        rendered.length === 1
          ? `${rendered[0].name} is live`
          : `${rendered.length} live`,
      state: "ready",
    };
  }
  const first = problems[0];
  const reason =
    status?.outputs.find((x) => x.id === first.id)?.reason ?? "checking";
  return { detail: `${first.name}: ${reason}`, state: "warning" };
}

export default function AppShell({
  currentRoute,
  toolbar,
}: AppShellProps): React.ReactElement {
  const { liveOutputLabel, isTranscribing } = useAppStore(useShallow((state) => ({ liveOutputLabel: state.liveOutputLabel, isTranscribing: state.isTranscribing })));
  const houseTrack = useTracksPlaybackStore(useShallow((state) => {
    const live = state.library.items.find(
      (item) => item.id === state.library.liveId,
    );
    if (!live) return null;
    return { name: live.name, paused: state.library.livePaused || state.ended };
  }));
  const [clearing, setClearing] = useState(false);
  const screens = useScreensStatus();
  const fullScreen = useFullScreen();
  // Window buttons sit in the corner only on a Mac outside full screen.
  const showLogo = !IS_MAC || fullScreen;
  /** Session is live while the transcript pipeline runs; show output ref when one is up. */
  const isLive = isTranscribing || Boolean(liveOutputLabel?.trim());
  const liveDetail =
    liveOutputLabel?.trim() || (isTranscribing ? "Listening" : null);

  const clearOutput = async (): Promise<void> => {
    if (clearing) return;
    setClearing(true);
    try {
      await clearLiveAll();
    } finally {
      setClearing(false);
    }
  };

  return (
    // Only the macOS hidden-inset title bar needs the header to drag the window.
    // Windows and Linux have a native title bar, and a drag region there
    // swallows clicks on anything drawn over the header — Settings, menus.
    <header className={cn("app-header shrink-0", IS_MAC && "drag-region")}>
      {/* The corner the Mac window buttons sit in. With them hidden (full
          screen) or absent (Windows, Linux), the logo takes their place. */}
      <div
        className="flex w-[68px] shrink-0 items-center pl-1.5"
        aria-hidden={showLogo ? undefined : true}
      >
        {showLogo && <KairoMark size="sm" />}
      </div>
      <div id={HEADER_TOOLBAR_SLOT_ID} className="header-toolbar min-w-0">
        {toolbar}
      </div>

      <div
        className="header-statuses flex items-center gap-1"
        aria-label="Presentation controls"
      >
        <MediaToolbarButton />
        <ThemePicker currentRoute={currentRoute} />
        <ToolbarButton
          label="Screens"
          title={`Screens: ${screens.detail}. Open Screens (⌥⌘1)`}
          onClick={() => useAppStore.getState().openScreens()}
        >
          {/* The screen icon, its state as a dot on the corner. */}
          <span className="relative" aria-hidden="true">
            <MonitorPlay
              size={15}
              weight="fill"
              style={hueStyle("cyan")}
              className="text-[rgb(var(--hue))]"
            />
            <span
              className={cn(
                "absolute -right-1 -top-0.5 size-2 rounded-full ring-2 ring-surface-tertiary",
                screens.state === "ready"
                  ? "bg-emerald-500"
                  : screens.state === "warning"
                    ? "bg-amber-500"
                    : "bg-zinc-500",
              )}
            />
          </span>
        </ToolbarButton>
      </div>

      <div className="header-live flex shrink-0 items-center gap-1 pl-1">
        {houseTrack && (
          <ToolbarButton
            label={houseTrack.name}
            title={
              houseTrack.paused
                ? `Play ${houseTrack.name}`
                : `Pause ${houseTrack.name}`
            }
            onClick={() => void window.api.tracks.setPaused(!houseTrack.paused)}
            labelClassName="max-w-[6rem]"
          >
            {houseTrack.paused ? (
              <Play size={13} fill="currentColor" aria-hidden="true" />
            ) : (
              <Pause size={13} fill="currentColor" aria-hidden="true" />
            )}
          </ToolbarButton>
        )}
        <LiveMenu
          label={liveDetail ?? "Live"}
          live={isLive}
          detail={
            liveOutputLabel?.trim()
              ? liveOutputLabel.trim()
              : isTranscribing
                ? "Listening for scripture"
                : "Nothing on screen"
          }
        />
        <ToolbarButton
          label={clearing ? "Clearing" : "Clear"}
          title="Clear text and the dock background"
          onClick={() => void clearOutput()}
          disabled={clearing}
        >
          <Eraser
            size={14}
            style={hueStyle("pink")}
            className="text-[rgb(var(--hue))]"
            aria-hidden="true"
          />
        </ToolbarButton>
        <ActivationChip />
        <UpdatePill />
      </div>
    </header>
  );
}
