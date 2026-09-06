import {
  commandForShortcut,
  shortcutFromEvent,
} from "@shared/keyboard-shortcuts";
import { ServicePanel, useServiceRecords } from "./ServicePanel";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  BookOpen,
  X,
  Play,
  Pause,
  Volume2,
  AlertTriangle,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Loader,
  Plus,
  BookmarkSimple,
  Copy,
  Download,
  Mic,
} from "@/icons";
import { useAppStore } from "@/stores/useAppStore";
import { cn, downloadFile } from "@/lib/utils";
import {
  normalizeOperatorPanelWidth,
  resizeOperatorPanel,
} from "@shared/operator-layout";
import type { OperatorPanelSide } from "@shared/operator-layout";
import { Button } from "@/components/ui/button";
import { VerseThemePreview } from "@/components/scripture/VerseThemePreview";
import {
  DEFAULT_OVERLAY_SETTINGS,
  normalizeOverlaySettings,
} from "@shared/overlay-defaults";
import { liveOverlayTheme } from "@shared/overlay-outputs";
import { LiveOutputRail } from "./LiveOutputRail";
import { BoothWorkspace } from "@/components/layout/BoothWorkspace";
import { useLiveRailWidth } from "./useLiveRailWidth";
import {
  applyOperatorSuggestionSent,
  findReadingProgress,
  groupScriptureSuggestions,
  mergeScriptureSuggestion,
  navigateOperatorSuggestionId,
  partitionOperatorSuggestionGroups,
  updatePassageFollow,
} from "@shared/scripture-live-progress";
import {
  expandScriptureResult,
  getAdjacentVerseQueries,
} from "@shared/scripture-query";
import type { PassageFollowState } from "@shared/scripture-live-progress";
import type {
  AppSettings,
  MediaLibrary,
  ScriptureResult,
  ScriptureSuggestion,
  PendingAutoPresent,
  ServiceHealth,
  TranscriptResult,
  ResilienceStatus,
} from "@shared/ipc";
import { normalizeMediaPlayback } from "@shared/media-playback";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import { OperatorQueueSearch } from "@/components/operator/OperatorQueueSearch";
import { useBoothToolboxStore } from "@/stores/useBoothToolboxStore";
import { clearLiveText } from "@/lib/clear-live-output";

// ─── Constants for Live Highlight Parsing ─────────────────────────────────────

const TRIGGER_PHRASES = [
  "turn your bibles to",
  "turn to",
  "let's read",
  "the scripture says",
  "the bible says",
  "it is written",
  "as it says in",
  "chapter",
  "verse",
];

const OPERATOR_CARD_WIDTH = 200;
const OPERATOR_CARD_HEIGHT = Math.round((OPERATOR_CARD_WIDTH * 9) / 16);

function detectionCaption(
  suggestion: ScriptureSuggestion,
  flags: { isLive: boolean; isReading: boolean; isUpNext: boolean },
): string | null {
  if (flags.isLive) return null;
  if (flags.isReading) return "Reading";
  if (flags.isUpNext) return "Up next";
  if (suggestion.planMatch === "quote") return "Playlist · read";
  if (suggestion.planMatch) return "Playlist";
  if (suggestion.preloadedNext) return "Preloaded";
  return null;
}

interface ScriptureHighlight {
  id: string;
  triggerText: string;
  reference: string;
  confidence: number;
}

interface MessageNugget {
  id: string;
  text: string;
  capturedAt: number;
}

const NUGGET_STORAGE_KEY = "kairo-message-nuggets";

function storedNuggets(): MessageNugget[] {
  try {
    const value = JSON.parse(
      localStorage.getItem(NUGGET_STORAGE_KEY) ?? "[]",
    ) as unknown;
    return Array.isArray(value)
      ? value.filter((item): item is MessageNugget =>
          Boolean(
            item &&
            typeof item === "object" &&
            typeof (item as MessageNugget).id === "string" &&
            typeof (item as MessageNugget).text === "string" &&
            typeof (item as MessageNugget).capturedAt === "number",
          ),
        )
      : [];
  } catch {
    return [];
  }
}

interface DisplaySegment {
  id: string;
  text: string;
  isFinal: boolean;
  timestamp: number;
  confidence: number;
  scriptureHighlights: ScriptureHighlight[];
}

type TextRun =
  | { type: "plain"; text: string }
  | { type: "trigger"; text: string }
  | { type: "scripture"; text: string; reference: string };

function buildRuns(
  text: string,
  scriptureHighlights: ScriptureHighlight[],
): TextRun[] {
  if (!text) return [];

  const styles: Array<
    null | { type: "trigger" } | { type: "scripture"; reference: string }
  > = Array.from({ length: text.length }, () => null);

  const lower = text.toLowerCase();

  for (const phrase of TRIGGER_PHRASES) {
    const phraseLower = phrase.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(phraseLower, pos)) !== -1) {
      for (let i = pos; i < pos + phrase.length && i < text.length; i++) {
        if (!styles[i]) styles[i] = { type: "trigger" };
      }
      pos += phrase.length;
    }
  }

  for (const h of scriptureHighlights) {
    const trigLower = h.triggerText.toLowerCase();
    const pos = lower.indexOf(trigLower);
    if (pos !== -1) {
      for (
        let i = pos;
        i < pos + h.triggerText.length && i < text.length;
        i++
      ) {
        styles[i] = { type: "scripture", reference: h.reference };
      }
    }
  }

  const runs: TextRun[] = [];
  let i = 0;
  while (i < text.length) {
    const style = styles[i];
    let j = i + 1;

    if (!style) {
      while (j < text.length && !styles[j]) j++;
      runs.push({ type: "plain", text: text.slice(i, j) });
    } else if (style.type === "trigger") {
      while (j < text.length && styles[j]?.type === "trigger") j++;
      runs.push({ type: "trigger", text: text.slice(i, j) });
    } else {
      const ref = style.reference;
      while (j < text.length) {
        const s = styles[j];
        if (!s || s.type !== "scripture" || s.reference !== ref) break;
        j++;
      }
      runs.push({ type: "scripture", text: text.slice(i, j), reference: ref });
    }
    i = j;
  }

  return runs;
}

function HighlightedText({
  text,
  scriptureHighlights,
}: {
  text: string;
  scriptureHighlights: ScriptureHighlight[];
}): React.ReactElement {
  const runs = buildRuns(text, scriptureHighlights);

  return (
    <>
      {runs.map((run, idx) => {
        if (run.type === "trigger") {
          return (
            <mark
              key={idx}
              className="bg-transparent text-teal-300 font-bold not-italic"
            >
              {run.text}
            </mark>
          );
        }
        if (run.type === "scripture") {
          return (
            <span key={idx} className="relative inline">
              <mark className="bg-teal-500/10 text-teal-200 border-b border-teal-500/30 pb-0.5 not-italic">
                {run.text}
              </mark>
              <span className="ml-1 inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-300 border border-zinc-700 align-middle leading-none">
                <BookOpen size={9} />
                {run.reference}
              </span>
            </span>
          );
        }
        return <span key={idx}>{run.text}</span>;
      })}
    </>
  );
}

function resultToSegment(r: TranscriptResult): DisplaySegment {
  return {
    id: r.id,
    text: r.text,
    isFinal: true,
    timestamp: r.timestamp,
    confidence:
      r.words.length > 0
        ? r.words.reduce((s, w) => s + w.confidence, 0) / r.words.length
        : 0,
    scriptureHighlights: [],
  };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Operator(): React.ReactElement {
  const bootstrapSettings = useBootstrapStore((state) => state.settings);
  const {
    isTranscribing,
    setIsTranscribing,
    autoModeEnabled,
    setAutoMode,
    confidenceThreshold,
    audioLevel,
    scriptureOutputClearToken,
  } = useAppStore();

  // Transcript states
  const [segments, setSegments] = useState<DisplaySegment[]>([]);
  const [legacyNuggets, setLegacyNuggets] =
    useState<MessageNugget[]>(storedNuggets);
  const serviceSnapshot = useServiceRecords();
  const activeService = serviceSnapshot.services.find(
    (service) => service.id === serviceSnapshot.activeId,
  );
  const nuggets = activeService?.nuggets ?? legacyNuggets;
  const [serviceError, setServiceError] = useState("");
  const [creationIntent, setCreationIntent] = useState<
    "manual" | "start" | null
  >(null);
  const pipelineBusyRef = useRef(false);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [nuggetsOpen, setNuggetsOpen] = useState(false);
  const [interimText, setInterimText] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

  useEffect(() => {
    try {
      localStorage.setItem(NUGGET_STORAGE_KEY, JSON.stringify(legacyNuggets));
    } catch {
      // Nugget capture still works for this session when storage is unavailable.
    }
  }, [legacyNuggets]);

  const removeNugget = (id: string): void => {
    if (!activeService) {
      setLegacyNuggets((current) => current.filter((item) => item.id !== id));
      return;
    }
    void window.api.services
      .command({
        action: "removeNugget",
        serviceId: activeService.id,
        nuggetId: id,
      })
      .catch((e) => setServiceError(String(e)));
  };

  const toggleNugget = useCallback(
    (segment: DisplaySegment): void => {
      if (!activeService) {
        setServiceError("Create a service to save this nugget.");
        return;
      }
      void window.api.services
        .command({
          action: "nugget",
          text: segment.text,
          sourceIds: [segment.id],
        })
        .catch((e) => setServiceError(String(e)));
    },
    [activeService],
  );

  const exportNuggets = useCallback((): void => {
    if (nuggets.length === 0) return;
    const body = nuggets
      .map(
        (item, index) =>
          `${index + 1}. ${item.text}\nCaptured ${new Date(item.capturedAt).toLocaleString()}`,
      )
      .join("\n\n");
    downloadFile(
      body,
      `kairo-message-nuggets-${new Date().toISOString().slice(0, 10)}.txt`,
      "text/plain",
    );
  }, [nuggets]);

  // Scripture suggestions queue
  const [suggestions, setSuggestions] = useState<ScriptureSuggestion[]>([]);
  const suggestionsRef = useRef<ScriptureSuggestion[]>([]);
  const recentReadingTextRef = useRef("");
  const verseCardRefs = useRef(new Map<string, HTMLButtonElement>());
  const queueScrollRef = useRef<HTMLDivElement>(null);
  /** True while the operator is browsing the queue by hand — auto-follow yields. */
  const queueUserBrowsingRef = useRef(false);
  const queueGroupCountRef = useRef(0);
  /** Detections withheld from the list while the operator scrolls it by hand. */
  const [heldSuggestions, setHeldSuggestions] = useState<ScriptureSuggestion[]>(
    [],
  );
  /** Verses the operator staged to push on cue. Separate from what was detected. */
  const [queue, setQueue] = useState<ScriptureSuggestion[]>([]);
  const [queueBusyId, setQueueBusyId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<
    string | null
  >(null);
  const [adjacentLoading, setAdjacentLoading] = useState<string | null>(null);
  const [readingProgress, setReadingProgress] = useState<{
    matchedId: string;
    nextId: string;
  } | null>(null);
  const [sentSuggestionIds, setSentSuggestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const sentSuggestionIdsRef = useRef(new Set<string>());
  const followStateRef = useRef<PassageFollowState | null>(null);
  useEffect(() => {
    if (!serviceSnapshot.loaded) return;
    const record = useServiceRecords
      .getState()
      .services.find((service) => service.id === serviceSnapshot.activeId);
    setSegments(record?.transcript.slice(-50).map(resultToSegment) ?? []);
    setSuggestions(record?.scriptures ?? []);
    suggestionsRef.current = record?.scriptures ?? [];
    setInterimText("");
    setQueue([]);
    setSelectedSuggestionId(null);
    setHeldSuggestions([]);
    setPendingAuto([]);
    sentSuggestionIdsRef.current = new Set();
    setSentSuggestionIds(new Set());
    followStateRef.current = null;
    recentReadingTextRef.current = "";
  }, [serviceSnapshot.activeId, serviceSnapshot.loaded]);
  const [overlay, setOverlay] = useState<AppSettings["overlay"]>(
    DEFAULT_OVERLAY_SETTINGS,
  );
  const [mediaLibrary, setMediaLibrary] = useState<MediaLibrary | null>(null);
  const [defaultTranslation, setDefaultTranslation] =
    useState<AppSettings["scripture"]["defaultTranslation"]>("NKJV");
  const [pendingAuto, setPendingAuto] = useState<PendingAutoPresent[]>([]);
  const [transcriptWidth, setTranscriptWidth] = useState(() =>
    normalizeOperatorPanelWidth(
      "left",
      localStorage.getItem("operator-transcript-width"),
    ),
  );
  // The rail width is shared app state, not local: Operator stays mounted while
  // hidden, so resizing the rail on Lyrics or Scripture must land here too.
  const liveRail = useLiveRailWidth();
  const [activeProjection, setActiveProjection] = useState<{
    reference: string;
    text: string;
  } | null>(null);

  const goLive = useCallback((reference: string, text: string): void => {
    setActiveProjection({ reference, text });
    const store = useAppStore.getState();
    store.markLiveOutput(reference);
    store.setLiveOutputPreview({ kind: "scripture", reference, text });
  }, []);

  // Header CLEAR (and other clear paths) bump this token — drop the local preview.
  useEffect(() => {
    if (scriptureOutputClearToken === 0) return;
    setActiveProjection(null);
  }, [scriptureOutputClearToken]);
  const suggestionGroups = useMemo(
    () => groupScriptureSuggestions(suggestions),
    [suggestions],
  );
  const activeGroupId =
    followStateRef.current?.passageId ??
    suggestionGroups.find((group) =>
      group.suggestions.some(
        (item) => item.reference === activeProjection?.reference,
      ),
    )?.id ??
    null;
  const suggestionSections = useMemo(
    () => partitionOperatorSuggestionGroups(suggestionGroups, activeGroupId, 3),
    [suggestionGroups, activeGroupId],
  );
  const visibleSuggestionIds = useMemo(
    () =>
      suggestionSections.current.flatMap((group) =>
        group.suggestions.map((item) => item.id),
      ),
    [suggestionSections.current],
  );

  // A newly detected passage is worth jumping to, so it re-arms auto-follow.
  // Verses added to a passage already on screen do not.
  useEffect(() => {
    if (suggestionGroups.length > queueGroupCountRef.current) {
      queueUserBrowsingRef.current = false;
    }
    queueGroupCountRef.current = suggestionGroups.length;
  }, [suggestionGroups]);

  // Held detections must not outlive the list they belong to.
  useEffect(() => {
    if (suggestions.length === 0) setHeldSuggestions([]);
  }, [suggestions.length]);

  // Left transcript panel only — the right rail owns its own resize via
  // useLiveRailWidth so every screen showing it stays in sync.
  const startPanelResize = useCallback(
    (side: OperatorPanelSide, event: React.PointerEvent): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = transcriptWidth;
      let finalWidth = startWidth;

      const handlePointerMove = (pointerEvent: PointerEvent): void => {
        finalWidth = resizeOperatorPanel(
          side,
          startWidth,
          pointerEvent.clientX - startX,
        );
        setTranscriptWidth(finalWidth);
      };
      const handlePointerUp = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("operator-transcript-width", String(finalWidth));
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [transcriptWidth],
  );

  const resizePanelByKeyboard = useCallback(
    (side: OperatorPanelSide, deltaX: number): void => {
      const nextWidth = resizeOperatorPanel(side, transcriptWidth, deltaX);
      setTranscriptWidth(nextWidth);
      localStorage.setItem("operator-transcript-width", String(nextWidth));
    },
    [transcriptWidth],
  );
  const livePreviewResult = useMemo(() => {
    if (!activeProjection) return null;
    const detected = suggestions.find(
      (item) => item.reference === activeProjection.reference,
    );
    if (detected) {
      return {
        reference: detected.reference,
        translation: detected.translation,
        verses: detected.verses,
      };
    }
    const parsed = activeProjection.reference.match(/^(.+?)\s+(\d+):(\d+)/);
    return {
      reference: activeProjection.reference,
      translation: defaultTranslation,
      verses: [
        {
          book: parsed?.[1] ?? "",
          chapter: Number(parsed?.[2] ?? 0),
          verse: Number(parsed?.[3] ?? 0),
          text: activeProjection.text,
        },
      ],
    };
  }, [activeProjection, defaultTranslation, suggestions]);

  const liveMedia = useMemo(() => {
    if (!mediaLibrary?.liveItemId) return null;
    const item = mediaLibrary.items.find(
      (candidate) => candidate.id === mediaLibrary.liveItemId,
    );
    if (!item) return null;
    return {
      item,
      playback: normalizeMediaPlayback(mediaLibrary.playback[item.id]),
      paused: mediaLibrary.livePaused,
    };
  }, [mediaLibrary]);

  useEffect(() => {
    suggestionsRef.current = suggestions;
  }, [suggestions]);

  // Settings arrive with the startup snapshot and stay current as other screens
  // save them, so Operator never re-reads them on mount.
  useEffect(() => {
    setOverlay(normalizeOverlaySettings(bootstrapSettings.overlay));
    setDefaultTranslation(bootstrapSettings.scripture.defaultTranslation);
  }, [bootstrapSettings]);

  useEffect(() => {
    let cancelled = false;
    window.api.media
      .getLibrary()
      .then((library) => {
        if (!cancelled) setMediaLibrary(library);
      })
      .catch(() => undefined);
    const off = window.api.media.onLibraryChange(setMediaLibrary);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const advanceAutoFollowFromText = useCallback((text: string): void => {
    const current = followStateRef.current;
    if (!current || !text.trim()) return;
    const update = updatePassageFollow(current, text, suggestionsRef.current);
    followStateRef.current = update.state;
    if (
      !update.nextSuggestionId ||
      sentSuggestionIdsRef.current.has(update.nextSuggestionId)
    )
      return;
    const candidate = suggestionsRef.current.find(
      (item) => item.id === update.nextSuggestionId,
    );
    if (!candidate) return;

    const sent = new Set(sentSuggestionIdsRef.current).add(candidate.id);
    sentSuggestionIdsRef.current = sent;
    setSentSuggestionIds(sent);
    setActiveProjection({
      reference: candidate.reference,
      text: candidate.verses.map((verse) => verse.text).join(" "),
    });
    const store = useAppStore.getState();
    store.markLiveOutput(candidate.reference);
    store.setLiveOutputPreview({
      kind: "scripture",
      reference: candidate.reference,
      text: candidate.verses.map((verse) => verse.text).join(" "),
      verses: candidate.verses,
      translation: candidate.translation,
    });
    window.api.scripture
      .register(candidate)
      .then(() => window.api.orchestrator.approveSuggestion(candidate.id))
      .catch((err) => {
        console.error(err);
        followStateRef.current = current;
        const reverted = new Set(sentSuggestionIdsRef.current);
        reverted.delete(candidate.id);
        sentSuggestionIdsRef.current = reverted;
        setSentSuggestionIds(reverted);
      });
  }, []);

  /**
   * Auto-follow scrolls the queue to the verse being read. It must never fight
   * the operator: reading progress recomputes on every final transcript segment,
   * and the follow target is usually mid-passage, so an unconditional
   * `scrollIntoView` yanked the list away from whoever was reaching for the
   * newest card. Hand-scrolling suspends it until genuinely new content lands.
   */
  // Only real scroll gestures count. Clicking a card must not suspend follow —
  // advancing to the next verse of the passage is exactly what should happen
  // after the operator sends one.
  const noteQueueBrowsing = useCallback((): void => {
    queueUserBrowsingRef.current = true;
  }, []);

  const insertSuggestion = useCallback(
    (incoming: ScriptureSuggestion): void => {
      setSuggestions((prev) => {
        if (prev.some((s) => s.id === incoming.id)) return prev;
        const next = mergeScriptureSuggestion(prev, incoming);
        suggestionsRef.current = next;
        const progress = findReadingProgress(
          recentReadingTextRef.current,
          next,
        );
        if (progress) {
          setReadingProgress({
            matchedId:
              next[progress.matchedIndex]?.id ?? progress.activeSuggestionId,
            nextId: progress.activeSuggestionId,
          });
        }
        return next;
      });
    },
    [],
  );

  /** Releases withheld detections and hands the list back to auto-follow. */
  const flushHeldSuggestions = useCallback((): void => {
    queueUserBrowsingRef.current = false;
    setHeldSuggestions((held) => {
      held.forEach(insertSuggestion);
      return [];
    });
  }, [insertSuggestion]);

  useEffect(() => {
    if (!readingProgress || queueUserBrowsingRef.current) return;
    const card = verseCardRefs.current.get(readingProgress.nextId);
    if (!card) return;

    // Already on screen — scrolling again would only jitter the list.
    const container = queueScrollRef.current;
    if (container) {
      const view = container.getBoundingClientRect();
      const target = card.getBoundingClientRect();
      if (target.top >= view.top && target.bottom <= view.bottom) return;
    }

    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [readingProgress]);

  // Queue search — Cmd/Ctrl+K focuses the combobox inside OperatorQueueSearch.
  const searchInputRef = useRef<HTMLInputElement>(null);

  // System Health state
  const [health, setHealth] = useState<ServiceHealth[]>([]);

  // Resilience Status state
  const [resilienceStatus, setResilienceStatus] =
    useState<ResilienceStatus | null>(null);
  const prevPpStateRef = useRef<boolean>(true);

  // play beep function using Web Audio API
  const playBeep = useCallback(() => {
    try {
      const audioCtx = new (
        window.AudioContext || (window as any).webkitAudioContext
      )();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // 880Hz
      gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.001,
        audioCtx.currentTime + 0.3,
      );

      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.3);
    } catch (err) {
      console.error("Failed to play beep sound:", err);
    }
  }, []);

  useEffect(() => {
    // 1. Get initial status
    window.api.resilience
      .getStatus()
      .then((status) => {
        setResilienceStatus(status);
        prevPpStateRef.current = (status.ppReconnectCountdown ?? 0) === 0;
      })
      .catch(console.error);

    // 2. Subscribe to status changes
    const unsubResilience = window.api.resilience.onStatusChange((status) => {
      setResilienceStatus(status);
      const wasConnected = prevPpStateRef.current;
      const isConnected =
        (status.ppReconnectCountdown ?? 0) === 0 &&
        status.overallHealth !== "CRITICAL";
      if (
        wasConnected &&
        !isConnected &&
        (status.ppReconnectCountdown ?? 0) > 0
      ) {
        playBeep();
      }
      prevPpStateRef.current = isConnected;
    });

    return () => {
      unsubResilience();
    };
  }, [playBeep]);

  // Session duration timer

  // ── Sync Active Projection with Store's Current Slide ──────────────────────

  const currentSlide = useAppStore((state) => state.currentSlide);
  useEffect(() => {
    if (currentSlide) {
      // Split reference and verse if stored together, or default back
      const match = currentSlide.match(/^(.*?\d+:\d+)\s*[\r\n]+([\s\S]+)$/);
      if (match) {
        goLive(match[1], match[2]);
      } else {
        goLive("Projected", currentSlide);
      }
    }
  }, [currentSlide, goLive]);

  // ── Load Init History & Health On Mount ──────────────────────────────────────

  useEffect(() => {
    const { orchestrator } = useBootstrapStore.getState();
    if (orchestrator) {
      setHealth(orchestrator.health);
      setIsTranscribing(orchestrator.running);
      setAutoMode(orchestrator.autoMode, confidenceThreshold);
    }
    // Live orchestrator pushes keep this current from here on.
  }, [setIsTranscribing, setAutoMode, confidenceThreshold]);

  // ── IPC subscriptions for live speech and Claude suggestions ───────────────

  useEffect(() => {
    const unsubTranscript = window.api.transcription.onTranscript((result) => {
      const serviceState = useServiceRecords.getState();
      // Keep the live feed when a service is open — transcription pause is separate.
      if (
        !serviceState.services.some(
          (s) => s.id === serviceState.activeId && s.status !== "ended",
        )
      )
        return;
      const seg = resultToSegment(result);
      setSegments((prev) => [...prev, seg].slice(-50));
      setInterimText("");
      advanceAutoFollowFromText(result.text);

      recentReadingTextRef.current =
        `${recentReadingTextRef.current} ${result.text}`.slice(-650);
      const progress = findReadingProgress(
        recentReadingTextRef.current,
        suggestionsRef.current,
      );
      if (progress) {
        setReadingProgress({
          matchedId:
            suggestionsRef.current[progress.matchedIndex]?.id ??
            progress.activeSuggestionId,
          nextId: progress.activeSuggestionId,
        });
      }
    });

    const unsubInterim = window.api.transcription.onInterim((result) => {
      const serviceState = useServiceRecords.getState();
      if (
        !serviceState.services.some(
          (s) => s.id === serviceState.activeId && s.status !== "ended",
        )
      )
        return;
      setInterimText(result.text);
      advanceAutoFollowFromText(result.text);
    });

    const unsubSuggestion = window.api.scripture.onSuggestion((suggestion) => {
      // 1. Apply visual highlight to the transcript segment containing the trigger
      const highlight: ScriptureHighlight = {
        id: suggestion.id,
        triggerText: suggestion.triggerText,
        reference: suggestion.reference,
        confidence: suggestion.confidence,
      };
      setSegments((prev) => {
        const lower = suggestion.triggerText.toLowerCase();
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].text.toLowerCase().includes(lower)) {
            const updated = [...prev];
            updated[i] = {
              ...prev[i],
              scriptureHighlights: [
                ...prev[i].scriptureHighlights.filter(
                  (h) => h.id !== suggestion.id,
                ),
                highlight,
              ],
            };
            return updated;
          }
        }
        return prev;
      });

      // 2. Always render a detection immediately. Manual browsing suppresses
      // auto-scroll only; it must never hide a live scripture from the operator
      // or starve auto-follow of the passage it needs to advance.
      insertSuggestion(suggestion);
    });

    const unsubPendingAuto = window.api.orchestrator.onPendingAuto(
      (pending) => {
        setPendingAuto((prev) => [
          ...prev.filter((p) => p.suggestionId !== pending.suggestionId),
          pending,
        ]);
      },
    );

    const unsubStatus = window.api.orchestrator.onStatus((status) => {
      setHealth(status.health);
      setIsTranscribing(status.running);
      setAutoMode(status.autoMode, confidenceThreshold);
    });

    return () => {
      unsubTranscript();
      unsubInterim();
      unsubSuggestion();
      unsubPendingAuto();
      unsubStatus();
    };
  }, [
    setIsTranscribing,
    setAutoMode,
    confidenceThreshold,
    advanceAutoFollowFromText,
    insertSuggestion,
  ]);

  // ── Auto-present Cleanup and Projection Trigger ─────────────────────────────

  useEffect(() => {
    if (pendingAuto.length === 0) return;
    const timers = pendingAuto.map((item) => {
      const delay = Math.max(0, item.expiresAt - Date.now());
      return setTimeout(() => {
        const sug = suggestions.find((s) => s.id === item.suggestionId);
        if (sug) {
          goLive(sug.reference, sug.verses.map((v) => v.text).join(" "));
          const sent = new Set(sentSuggestionIdsRef.current).add(sug.id);
          sentSuggestionIdsRef.current = sent;
          setSentSuggestionIds(sent);
          if (sug.passageId && (sug.passageLength ?? 1) > 1) {
            followStateRef.current = {
              passageId: sug.passageId,
              currentIndex: sug.passageIndex ?? 0,
              matchedTokenIndexes: [],
            };
          }
        }
        setPendingAuto((prev) =>
          prev.filter((p) => p.suggestionId !== item.suggestionId),
        );
      }, delay);
    });
    return () => timers.forEach(clearTimeout);
  }, [pendingAuto, suggestions]);

  // ── Auto-scroll Transcript ──────────────────────────────────────────────────

  useEffect(() => {
    if (isAutoScrolling.current) {
      transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [segments, interimText]);

  const handleTranscriptScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isAtBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight < 20;
    isAutoScrolling.current = isAtBottom;
  };

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleApproveSuggestion = useCallback(
    async (id: string): Promise<void> => {
      setSelectedSuggestionId(id);
      try {
        const sug = suggestions.find((s) => s.id === id);
        if (sug) {
          if (sug.passageId && (sug.passageLength ?? 1) > 1) {
            followStateRef.current = {
              passageId: sug.passageId,
              currentIndex: sug.passageIndex ?? 0,
              matchedTokenIndexes: [],
            };
          }
          setActiveProjection({
            reference: sug.reference,
            text: sug.verses.map((v) => v.text).join(" "),
          });
          const store = useAppStore.getState();
          store.markLiveOutput(sug.reference);
          store.setLiveOutputPreview({
            kind: "scripture",
            reference: sug.reference,
            text: sug.verses.map((verse) => verse.text).join(" "),
            verses: sug.verses,
            translation: sug.translation,
          });
        }
        const sentState = applyOperatorSuggestionSent(
          suggestions,
          sentSuggestionIdsRef.current,
          id,
        );
        sentSuggestionIdsRef.current = sentState.sentSuggestionIds;
        setSentSuggestionIds(sentState.sentSuggestionIds);
        setSuggestions(sentState.suggestions);
        await window.api.orchestrator.approveSuggestion(id);
        setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id));
      } catch (err) {
        console.error(err);
      }
    },
    [suggestions],
  );

  const loadAdjacentDetectedVerse = useCallback(
    async (groupId: string, direction: "previous" | "next"): Promise<void> => {
      const group = suggestionGroups.find((item) => item.id === groupId);
      if (!group || adjacentLoading) return;
      const edge =
        direction === "next" ? group.suggestions.at(-1) : group.suggestions[0];
      if (!edge) return;

      const queries = getAdjacentVerseQueries(
        [
          {
            reference: edge.reference,
            translation: edge.translation,
            verses: edge.verses,
          },
        ],
        direction,
      );
      setAdjacentLoading(`${groupId}:${direction}`);
      try {
        let adjacent = null;
        for (const query of queries) {
          const [result] = await window.api.scripture.search(
            query,
            edge.translation,
          );
          const expanded = result ? expandScriptureResult(result) : [];
          adjacent = direction === "previous" ? expanded.at(-1) : expanded[0];
          if (adjacent) break;
        }
        if (
          !adjacent ||
          suggestionsRef.current.some(
            (item) =>
              item.reference === adjacent?.reference &&
              item.translation === adjacent?.translation,
          )
        )
          return;

        const suggestion: ScriptureSuggestion = {
          id: `operator-adjacent-${groupId}-${adjacent.reference}-${Date.now()}`,
          reference: adjacent.reference,
          verses: adjacent.verses,
          translation: adjacent.translation,
          confidence: 1,
          source: "manual",
          triggerText: adjacent.reference,
          passageId: groupId,
          passageReference: group.reference,
          passageIndex:
            direction === "next"
              ? Math.max(
                  ...group.suggestions.map((item) => item.passageIndex ?? 0),
                ) + 1
              : Math.min(
                  ...group.suggestions.map((item) => item.passageIndex ?? 0),
                ) - 1,
          passageLength: group.suggestions.length + 1,
          preloadedNext: direction === "next",
        };
        await window.api.scripture.register(suggestion);
        setSuggestions((current) => {
          const next = current.map((item) =>
            item.passageId === groupId
              ? { ...item, passageLength: group.suggestions.length + 1 }
              : item,
          );
          const merged = mergeScriptureSuggestion(next, suggestion);
          suggestionsRef.current = merged;
          return merged;
        });
        setSelectedSuggestionId(suggestion.id);
        requestAnimationFrame(() =>
          verseCardRefs.current
            .get(suggestion.id)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        );
      } catch (error) {
        console.error(error);
      } finally {
        setAdjacentLoading(null);
      }
    },
    [adjacentLoading, suggestionGroups],
  );

  const addToQueue = useCallback((entry: ScriptureSuggestion): void => {
    setQueue((prev) =>
      // Same passage staged twice is always a misclick, never an intent.
      prev.some((item) => item.reference === entry.reference)
        ? prev
        : [
            { ...entry, id: `queued-${entry.reference}-${Date.now()}` },
            ...prev,
          ],
    );
  }, []);

  const removeFromQueue = useCallback((id: string): void => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  }, []);

  /** Queue rows push straight to ProPresenter; the themed preview follows. */
  const handlePresentQueued = useCallback(
    async (entry: ScriptureSuggestion): Promise<void> => {
      setQueueBusyId(entry.id);
      try {
        await window.api.scripture.register(entry);
        await window.api.orchestrator.approveSuggestion(entry.id);
        goLive(
          entry.reference,
          entry.verses.map((verse) => verse.text).join(" "),
        );
      } catch (err) {
        console.error(err);
      } finally {
        setQueueBusyId(null);
      }
    },
    [goLive],
  );

  const handleClearDetections = useCallback((): void => {
    suggestionsRef.current.forEach((s) => {
      window.api.orchestrator.dismissSuggestion(s.id).catch(console.error);
    });
    suggestionsRef.current = [];
    setSuggestions([]);
    setHeldSuggestions([]);
    setReadingProgress(null);
    followStateRef.current = null;
    queueUserBrowsingRef.current = false;
  }, []);

  const handleClearHistory = useCallback((): void => {
    const historyIds = new Set(
      suggestionSections.history.flatMap((group) =>
        group.suggestions.map((item) => item.id),
      ),
    );
    historyIds.forEach((id) => {
      window.api.orchestrator.dismissSuggestion(id).catch(console.error);
    });
    setSuggestions((prev) => {
      const next = prev.filter((item) => !historyIds.has(item.id));
      suggestionsRef.current = next;
      return next;
    });
  }, [suggestionSections.history]);

  const handleDismissSuggestion = useCallback(
    async (id: string): Promise<void> => {
      try {
        await window.api.orchestrator.dismissSuggestion(id);
        setSuggestions((prev) => prev.filter((s) => s.id !== id));
        setPendingAuto((prev) => prev.filter((p) => p.suggestionId !== id));
      } catch (err) {
        console.error(err);
      }
    },
    [],
  );

  const handleClearText = useCallback(async (): Promise<void> => {
    await clearLiveText();
    setActiveProjection(null);
  }, []);

  const enqueueSearchResults = useCallback(
    (results: ScriptureResult[]): void => {
      setQueue((prev) => {
        const seen = new Set(prev.map((item) => item.reference));
        const incoming: ScriptureSuggestion[] = [];
        for (const result of results) {
          if (seen.has(result.reference)) continue;
          seen.add(result.reference);
          const verseCount = result.verses.length;
          const isRange = verseCount > 1;
          incoming.push({
            id: `manual-${result.reference}-${Date.now()}`,
            reference: result.reference,
            verses: result.verses,
            translation: result.translation,
            confidence: 1,
            source: "manual",
            triggerText: result.reference,
            ...(isRange
              ? {
                  passageId: `queue-${result.reference}-${Date.now()}`,
                  passageReference: result.reference,
                  passageIndex: 0,
                  passageLength: verseCount,
                }
              : {}),
          });
        }
        return incoming.length === 0 ? prev : [...incoming, ...prev];
      });
    },
    [],
  );

  const handleToggleAutoMode = async () => {
    const nextVal = !autoModeEnabled;
    try {
      await window.api.scripture.setAutoMode(nextVal);
      setAutoMode(nextVal, confidenceThreshold);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTogglePipeline = async () => {
    if (pipelineBusyRef.current) return;
    if (!useServiceRecords.getState().activeId) {
      setCreationIntent("start");
      return;
    }
    pipelineBusyRef.current = true;
    setPipelineBusy(true);
    setServiceError("");
    try {
      if (isTranscribing) {
        await window.api.orchestrator.stop();
        setIsTranscribing(false);
      } else {
        const all = await window.api.settings.getAll();
        const devs = await window.api.audio.getDevices();
        const defaultDev = devs.find((d) => d.isDefault) || devs[0];
        const config = {
          audioDeviceId: all.audio.deviceId || defaultDev?.id || "",
          sttProvider: all.secretsConfigured.deepgram
            ? "deepgram"
            : all.stt.provider,
          sttApiKey: "",
          sttLanguage: all.stt.language || "en",
          llmProvider: all.stt.llmProvider ?? "anthropic",
          llmApiKey: "",
          scriptureTranslation: all.scripture.defaultTranslation,
          autoMode: autoModeEnabled,
          confidenceThreshold: all.scripture.confidenceThreshold,
          autoPresentDelaySec: 3,
        };
        await window.api.orchestrator.start(config);
        setIsTranscribing(true);
      }
    } catch (err) {
      setServiceError(String(err));
    } finally {
      pipelineBusyRef.current = false;
      setPipelineBusy(false);
    }
  };

  // ── Keyboard Shortcuts Listener ─────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = Boolean(
        target?.matches('input, textarea, select, [contenteditable="true"]') ||
        target?.closest('[contenteditable="true"]'),
      );

      // Operator stays mounted across routes, so these shortcuts fire app-wide.
      // Never steal Cmd/Ctrl+A (or other keys) while a field is focused.
      if (
        isTyping ||
        e.defaultPrevented ||
        e.repeat ||
        e.isComposing ||
        !document.hasFocus() ||
        document.querySelector(
          '.kairo-pp-settings, [role="dialog"], [role="alertdialog"], [role="menu"]',
        )
      )
        return;
      const shortcut = shortcutFromEvent(e);
      const command = shortcut
        ? commandForShortcut(shortcut, bootstrapSettings.display.shortcuts)
        : undefined;
      if (!command) return;

      if (command === "previous" || command === "next") {
        e.preventDefault();
        const delta = command === "previous" ? -1 : 1;
        const nextId = navigateOperatorSuggestionId(
          visibleSuggestionIds,
          selectedSuggestionId,
          delta,
        );
        if (nextId && nextId !== selectedSuggestionId) {
          const controllingCards = [...verseCardRefs.current.values()].some(
            (card) => card === target || card.contains(target),
          );
          setSelectedSuggestionId(nextId);
          const nextCard = verseCardRefs.current.get(nextId);
          nextCard?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          if (controllingCards) {
            nextCard?.focus({ preventScroll: true });
            void handleApproveSuggestion(nextId);
          }
        }
        return;
      }
      // Ctrl/Cmd+F: Focus search
      if (command === "search") {
        e.preventDefault();
        useBoothToolboxStore.getState().setTab("search");
        searchInputRef.current?.focus();
        return;
      }
      // Ctrl/Cmd+A: Toggle auto mode (only when not typing)
      if (command === "auto") {
        e.preventDefault();
        handleToggleAutoMode();
        return;
      }
      // Backspace / Delete: clear text, keep the dock background
      if (command === "clear") {
        e.preventDefault();
        void handleClearText();
        return;
      }
      // Space / Enter: Approve top suggestion
      if (
        command === "approve" &&
        document.activeElement?.tagName !== "BUTTON"
      ) {
        e.preventDefault();
        const id = selectedSuggestionId ?? visibleSuggestionIds[0];
        if (id) {
          handleApproveSuggestion(id);
        }
        return;
      }
      // Escape: Dismiss top suggestion
      if (command === "dismiss") {
        e.preventDefault();
        if (suggestions.length > 0) {
          handleDismissSuggestion(suggestions[0].id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    bootstrapSettings.display.shortcuts,
    suggestions,
    selectedSuggestionId,
    visibleSuggestionIds,
    autoModeEnabled,
    handleApproveSuggestion,
    handleDismissSuggestion,
    handleClearText,
  ]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getServiceStatus = (
    serviceName: string,
  ): "ok" | "degraded" | "error" | "unknown" => {
    const service = health.find((h) => h.service === serviceName);
    return service ? service.status : "unknown";
  };

  const getServiceError = (serviceName: string): string | undefined => {
    const service = health.find((h) => h.service === serviceName);
    return service ? service.lastError : undefined;
  };

  const ppReconnectCountdown = resilienceStatus?.ppReconnectCountdown ?? 0;

  const ppStatus = resilienceStatus
    ? ppReconnectCountdown > 0
      ? "error"
      : resilienceStatus.overallHealth === "CRITICAL"
        ? "error"
        : "ok"
    : getServiceStatus("propresenter");

  const ppError = resilienceStatus
    ? ppReconnectCountdown > 0
      ? `Disconnected. Reconnecting... (Queue: ${resilienceStatus.ppQueueSize} items)`
      : getServiceError("propresenter")
    : getServiceError("propresenter");

  const sttHealth = resilienceStatus?.health.find((h) => h.service === "stt");

  const sttStatus = sttHealth
    ? sttHealth.status === "degraded"
      ? "degraded"
      : sttHealth.status === "error"
        ? "error"
        : "ok"
    : getServiceStatus("stt");

  const sttError = sttHealth?.lastError ?? getServiceError("stt");

  const claudeStatusMapped = resilienceStatus
    ? resilienceStatus.claudeFallbackActive
      ? "degraded"
      : "ok"
    : getServiceStatus("detector");

  const claudeErrorMapped = resilienceStatus
    ? resilienceStatus.claudeFallbackActive
      ? "Claude offline. Local Regex fallback active."
      : getServiceError("detector")
    : getServiceError("detector");

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-transparent">
      {resilienceStatus?.recoverySessionAvailable && (
        <div className="bg-teal-950/40 border-b border-teal-500/30 px-6 py-3 flex items-center justify-between text-xs text-teal-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={15} className="text-teal-400 animate-pulse" />
            <div>
              <span className="font-bold">Active Recovery State Detected.</span>
              <span className="text-slate-400 ml-1">
                Would you like to restore your previous session transcription,
                settings, and queue?
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await window.api.resilience.discardSession();
                } catch (e) {
                  console.error(e);
                }
              }}
            >
              Discard
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await window.api.resilience.restoreSession();
                } catch (e) {
                  console.error(e);
                }
              }}
            >
              Restore Session
            </Button>
          </div>
        </div>
      )}

      {resilienceStatus && ppReconnectCountdown > 0 && (
        <div className="bg-rose-950/20 border-b border-rose-500/30 px-6 py-2.5 flex items-center justify-between text-xs font-bold text-rose-400 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
            <span>PP DISCONNECTED — RETRYING IN {ppReconnectCountdown}s</span>
            {resilienceStatus.ppQueueSize > 0 && (
              <span className="bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded text-[10px]">
                {resilienceStatus.ppQueueSize} projection(s) queued
              </span>
            )}
          </div>
          <span className="text-[10px] uppercase font-mono tracking-widest text-rose-500/80">
            Queue active
          </span>
        </div>
      )}

      <BoothWorkspace
        rail={
          <LiveOutputRail
            width={liveRail.width}
            overlay={overlay}
            liveMedia={liveMedia}
            result={livePreviewResult}
            onResizeStart={liveRail.onResizeStart}
            onResizeKeyDown={liveRail.onResizeKeyDown}
            serviceStatuses={[
              { label: "PP", status: ppStatus, error: ppError },
              { label: "STT", status: sttStatus, error: sttError },
              {
                label: "AI",
                status: claudeStatusMapped,
                error: claudeErrorMapped,
              },
            ]}
            search={
              <div className="flex h-full min-h-0 flex-col overflow-hidden bg-transparent">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-border bg-surface-tertiary px-3 py-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                    Queue
                  </label>
                  {queue.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setQueue([])}
                      className="text-[10px] font-semibold text-slate-600 transition-colors hover:text-rose-400 focus-visible:text-rose-400 focus-visible:outline-none"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                <div className="shrink-0 px-4 py-2.5">
                  <OperatorQueueSearch
                    translation={defaultTranslation}
                    inputRef={searchInputRef}
                    onEnqueue={enqueueSearchResults}
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                  {queue.length === 0 ? (
                    <p className="px-2 py-6 text-center text-[10px] leading-relaxed text-slate-600">
                      Stage verses here with{" "}
                      <span className="text-slate-500">+</span> on a detection,
                      or search above. Click a row to send it to ProPresenter.
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {queue.map((entry) => {
                        const isLive =
                          activeProjection?.reference === entry.reference;
                        return (
                          <li key={entry.id}>
                            <div
                              className={cn(
                                "group flex items-start gap-2 rounded-md border px-2.5 py-2 transition-colors",
                                isLive
                                  ? "border-teal-500/40 bg-teal-500/10"
                                  : "border-transparent hover:border-surface-border hover:bg-surface",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => void handlePresentQueued(entry)}
                                disabled={queueBusyId === entry.id}
                                className="min-w-0 flex-1 text-left focus-visible:outline-none"
                                title={`Send ${entry.reference} to ProPresenter`}
                              >
                                <p
                                  className={cn(
                                    "truncate text-[11px] font-semibold",
                                    isLive ? "text-teal-300" : "text-slate-300",
                                  )}
                                >
                                  {entry.reference}
                                  <span className="ml-1.5 font-normal text-slate-600">
                                    {entry.translation}
                                  </span>
                                  {entry.verses.length > 1 && (
                                    <span className="ml-1.5 font-normal text-slate-600">
                                      · {entry.verses.length} verses
                                    </span>
                                  )}
                                </p>
                                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">
                                  {entry.verses
                                    .map((verse) => verse.text)
                                    .join(" ")}
                                </p>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeFromQueue(entry.id)}
                                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-slate-700 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus-visible:outline-none focus-visible:text-rose-400"
                                title={`Remove ${entry.reference} from the queue`}
                                aria-label={`Remove ${entry.reference} from the queue`}
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            }
          />
        }
      >
        <div className="flex h-full min-h-0 w-full">
          {/* LEFT COLUMN: compact live transcript */}
          <section
            className="transcript-glass relative flex shrink-0 flex-col border-r border-white/10"
            style={{ width: transcriptWidth }}
          >
            <button
              type="button"
              aria-label="Resize live transcript panel"
              title="Drag to resize live transcript"
              className="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize bg-transparent outline-none hover:bg-teal-500/15 focus-visible:bg-teal-500/20"
              onPointerDown={(event) => startPanelResize("left", event)}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft")
                  resizePanelByKeyboard("left", -16);
                if (event.key === "ArrowRight")
                  resizePanelByKeyboard("left", 16);
              }}
            />
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-3 py-1.5">
              <span className="font-narrow text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                Live transcript
              </span>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setNuggetsOpen((open) => !open)}
                    className={cn(
                      "flex h-6 items-center gap-1 rounded px-2 text-[10px] font-semibold",
                      nuggetsOpen
                        ? "bg-amber-500/15 text-amber-300"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200",
                    )}
                    aria-expanded={nuggetsOpen}
                    aria-label={`Saved message nuggets: ${nuggets.length}`}
                  >
                    <BookmarkSimple
                      size={11}
                      weight={nuggets.length ? "fill" : "regular"}
                    />
                    Nuggets {nuggets.length > 0 ? nuggets.length : ""}
                  </button>
                  {nuggetsOpen && (
                    <div className="absolute left-0 top-full z-40 mt-2 w-72 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 shadow-2xl">
                      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                        <span className="text-[11px] font-semibold text-zinc-200">
                          {activeService
                            ? "This service’s nuggets"
                            : "Legacy nuggets"}
                        </span>
                        <button
                          type="button"
                          onClick={exportNuggets}
                          disabled={nuggets.length === 0}
                          className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white disabled:opacity-30"
                        >
                          <Download size={11} /> Export
                        </button>
                      </div>
                      <div className="max-h-72 overflow-y-auto p-2">
                        {nuggets.length === 0 ? (
                          <p className="px-2 py-5 text-center text-[11px] leading-relaxed text-zinc-500">
                            Bookmark a transcript line to save a quote for after
                            service.
                          </p>
                        ) : (
                          nuggets.map((nugget) => (
                            <div
                              key={nugget.id}
                              className="group/nugget flex gap-2 rounded-md px-2 py-2 hover:bg-white/[0.04]"
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] leading-relaxed text-zinc-300">
                                  {nugget.text}
                                </p>
                                <p className="mt-1 text-[9px] text-zinc-600">
                                  {new Date(
                                    nugget.capturedAt,
                                  ).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </p>
                              </div>
                              <div className="flex self-start opacity-0 group-hover/nugget:opacity-100 focus-within:opacity-100">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void navigator.clipboard.writeText(
                                      nugget.text,
                                    )
                                  }
                                  className="grid size-6 place-items-center text-zinc-600 hover:text-white"
                                  aria-label="Copy nugget"
                                  title="Copy nugget"
                                >
                                  <Copy size={11} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeNugget(nugget.id)}
                                  className="grid size-6 place-items-center text-zinc-600 hover:text-rose-400"
                                  aria-label="Remove nugget"
                                  title="Remove nugget"
                                >
                                  <X size={11} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
                {isTranscribing && (
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                    <span className="size-1 rounded-full bg-emerald-400" />
                    Live
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void handleTogglePipeline()}
                  disabled={pipelineBusy}
                  title={
                    isTranscribing
                      ? "Pause transcription"
                      : activeService
                        ? "Start transcription"
                        : "Create a service and start transcription"
                  }
                  className={cn(
                    "flex h-6 items-center gap-1 rounded px-2 text-[10px] font-semibold uppercase tracking-wider",
                    isTranscribing
                      ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      : "bg-teal-500 text-[#111827] hover:bg-teal-400",
                  )}
                >
                  {isTranscribing ? (
                    <Pause size={10} aria-hidden="true" />
                  ) : (
                    <Play size={10} aria-hidden="true" />
                  )}
                  {isTranscribing ? "Pause" : "Start"}
                </button>
              </div>
            </div>
            <ServicePanel
              onStartTranscription={handleTogglePipeline}
              creationIntent={creationIntent}
              onCreationIntentChange={setCreationIntent}
            />
            {resilienceStatus &&
              (sttHealth?.status === "degraded" ||
                sttHealth?.status === "error") && (
                <div className="bg-amber-950/20 border-b border-amber-500/30 px-4 py-2 text-[10px] font-bold text-amber-400 flex items-center justify-between animate-pulse shrink-0">
                  <span>TRANSCRIPTION PAUSED — RECONNECTING</span>
                  <span className="bg-amber-500/10 px-1.5 py-0.5 rounded text-[9px]">
                    BUFFERING AUDIO
                  </span>
                </div>
              )}
            <div
              onScroll={handleTranscriptScroll}
              className={cn(
                "flex-1 overflow-y-auto p-4 scroll-smooth font-sans text-zinc-100 leading-relaxed text-sm antialiased select-text",
                segments.length === 0 &&
                  !interimText &&
                  !activeService &&
                  !isTranscribing
                  ? "flex flex-col"
                  : "space-y-3",
              )}
            >
              {segments.map((seg) => {
                const saved = nuggets.some((item) => item.text === seg.text);
                return (
                  <div
                    key={seg.id}
                    className={cn(
                      "group/segment relative rounded-md py-1 pr-7 transition-colors",
                      saved && "bg-amber-500/[0.06]",
                    )}
                  >
                    <p className="transition-all duration-300">
                      <HighlightedText
                        text={seg.text}
                        scriptureHighlights={seg.scriptureHighlights}
                      />
                    </p>
                    <button
                      type="button"
                      onClick={() => toggleNugget(seg)}
                      className={cn(
                        "absolute right-1 top-1 grid size-6 place-items-center rounded opacity-0 transition-opacity hover:bg-amber-500/10 hover:text-amber-300 group-hover/segment:opacity-100 focus-visible:opacity-100",
                        saved && "text-amber-400 opacity-100",
                      )}
                      disabled={saved || !activeService}
                      aria-label={
                        saved ? "Nugget saved" : "Save as message nugget"
                      }
                      title={
                        saved ? "Nugget saved" : "Save this message nugget"
                      }
                    >
                      <BookmarkSimple
                        size={13}
                        weight={saved ? "fill" : "regular"}
                      />
                    </button>
                  </div>
                );
              })}
              {interimText && (
                <p className="animate-pulse italic text-zinc-300">
                  {interimText}
                </p>
              )}
              {segments.length === 0 &&
                !interimText &&
                (!activeService && !isTranscribing ? (
                  <div className="flex flex-1 flex-col items-center justify-center px-4 text-center">
                    <div className="grid size-10 place-items-center rounded-full border border-white/10 bg-white/[0.03] text-zinc-400">
                      <Mic size={16} aria-hidden />
                    </div>
                    <p className="mt-4 text-[13px] font-semibold tracking-tight text-zinc-100">
                      Create a service to start the transcript
                    </p>
                    <p className="mt-1.5 max-w-[16rem] text-[11px] leading-relaxed text-zinc-500">
                      The live feed, nuggets, and detected scriptures save into
                      one service for this message.
                    </p>
                    <button
                      type="button"
                      disabled={pipelineBusy}
                      onClick={() => void handleTogglePipeline()}
                      className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-500 px-3 text-[11px] font-semibold text-[#111827] hover:bg-teal-400 disabled:opacity-40"
                    >
                      <Play size={11} aria-hidden />
                      Create and start
                    </button>
                    <button
                      type="button"
                      className="mt-2 text-[11px] text-zinc-500 hover:text-zinc-300"
                      onClick={() => setCreationIntent("manual")}
                    >
                      Create without transcription
                    </button>
                  </div>
                ) : (
                  <p className="font-mono text-xs italic text-zinc-400">
                    {isTranscribing
                      ? "Listening for speech…"
                      : "Transcription paused."}
                  </p>
                ))}
              <div ref={transcriptEndRef} />
            </div>

            {/* Audio Signal Level Indicator */}
            <div className="shrink-0 space-y-2 border-t border-white/10 bg-black/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Volume2
                    size={11}
                    className={
                      isTranscribing ? "text-teal-400" : "text-slate-500"
                    }
                  />
                  Audio Input Signal
                </span>
                <span className="text-[9px] font-mono text-slate-600">
                  {Math.round((audioLevel?.rms ?? 0) * 100)}% RMS
                </span>
              </div>
              <div className="relative h-1.5 w-full overflow-hidden rounded-full border border-white/10 bg-black/40">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-75 ease-out",
                    (audioLevel?.clipping ?? false)
                      ? "bg-rose-500 animate-pulse"
                      : "bg-teal-500",
                  )}
                  style={{
                    width: `${Math.min(100, (audioLevel?.rms ?? 0) * 100 * 3.5)}%`,
                  }}
                />
              </div>
            </div>
          </section>

          {/* CENTER COLUMN: scripture detection workspace */}
          <section className="flex min-w-0 flex-1 flex-col bg-surface">
            {serviceError && (
              <p role="alert" className="px-4 py-2 text-xs text-red-400">
                {serviceError}
              </p>
            )}
            {resilienceStatus && resilienceStatus.claudeFallbackActive && (
              <div className="bg-amber-950/10 border-b border-amber-500/20 px-5 py-2 text-[10px] font-bold text-amber-400/90 flex items-center justify-between shrink-0 animate-pulse">
                <span>CLAUDE OFFLINE — LOCAL REGEX DETECTION ACTIVE</span>
                <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">
                  FALLBACK ACTIVE
                </span>
              </div>
            )}
            <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-surface-border px-4">
              <div className="flex min-w-0 items-center gap-2">
                <span className="font-narrow text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
                  Detected content
                </span>
                {suggestions.length > 0 && (
                  <span className="tabular-nums text-[10px] text-zinc-600">
                    {suggestions.length}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {heldSuggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={flushHeldSuggestions}
                    className="flex items-center gap-1 text-[10px] font-semibold text-teal-300 hover:text-teal-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
                  >
                    <ArrowDown size={11} aria-hidden="true" />
                    {heldSuggestions.length} new
                  </button>
                )}
                {suggestions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearDetections}
                    className="text-[10px] font-semibold text-zinc-600 hover:text-rose-400 focus-visible:outline-none focus-visible:text-rose-400"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div
              ref={queueScrollRef}
              onWheel={noteQueueBrowsing}
              onTouchMove={noteQueueBrowsing}
              className="flex flex-1 flex-col overflow-y-auto px-4 py-3"
            >
              <div className="flex w-full min-w-0 flex-col space-y-5">
                {suggestionSections.current.map((group) => {
                  const followState = followStateRef.current;
                  const following = followState?.passageId === group.id;
                  return (
                    <section
                      key={group.id}
                      className="flex w-full min-w-0 flex-col space-y-3"
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="flex min-w-0 items-baseline gap-2">
                          <h3 className="truncate text-[13px] font-semibold text-zinc-100">
                            {group.reference}
                          </h3>
                          <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                            {group.suggestions.length} verses
                          </span>
                          {following && (
                            <span className="shrink-0 text-[10px] font-medium text-teal-400">
                              Following
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center">
                          <button
                            type="button"
                            onClick={() =>
                              void loadAdjacentDetectedVerse(
                                group.id,
                                "previous",
                              )
                            }
                            disabled={adjacentLoading !== null}
                            className="grid size-6 place-items-center text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                            title="Preload previous verse"
                            aria-label={`Preload verse before ${group.reference}`}
                          >
                            {adjacentLoading === `${group.id}:previous` ? (
                              <Loader size={12} className="animate-spin" />
                            ) : (
                              <ChevronLeft size={14} />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void loadAdjacentDetectedVerse(group.id, "next")
                            }
                            disabled={adjacentLoading !== null}
                            className="grid size-6 place-items-center text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
                            title="Preload next verse"
                            aria-label={`Preload verse after ${group.reference}`}
                          >
                            {adjacentLoading === `${group.id}:next` ? (
                              <Loader size={12} className="animate-spin" />
                            ) : (
                              <ChevronRight size={14} />
                            )}
                          </button>
                        </div>
                      </div>
                      <div
                        className="grid w-full gap-3"
                        style={{
                          gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${OPERATOR_CARD_WIDTH}px), 1fr))`,
                        }}
                      >
                        {group.suggestions.map((s) => {
                          const isReading =
                            followState !== null &&
                            followState.passageId === s.passageId &&
                            followState.currentIndex === s.passageIndex;
                          const isUpNext =
                            followState !== null &&
                            followState.passageId === s.passageId &&
                            followState.currentIndex + 1 === s.passageIndex;
                          const isLive =
                            activeProjection?.reference === s.reference;
                          const caption = detectionCaption(s, {
                            isLive,
                            isReading,
                            isUpNext,
                          });
                          return (
                            <article
                              key={s.id}
                              className="group/card relative min-w-0"
                            >
                              <VerseThemePreview
                                result={{
                                  reference: s.reference,
                                  translation: s.translation,
                                  verses: s.verses,
                                }}
                                theme={liveOverlayTheme(overlay)}
                                showTranslation={overlay.showTranslation}
                                showVerseNumbers={overlay.showVerseNumbers}
                                maxVerses={1}
                                responsive
                                width={OPERATOR_CARD_WIDTH}
                                height={OPERATOR_CARD_HEIGHT}
                                isActive={
                                  isReading || selectedSuggestionId === s.id
                                }
                                isFocused={
                                  isReading ||
                                  isUpNext ||
                                  selectedSuggestionId === s.id
                                }
                                isLive={isLive}
                                sendStatus={isLive ? "sent" : "idle"}
                                onSelect={() => {
                                  verseCardRefs.current
                                    .get(s.id)
                                    ?.focus({ preventScroll: true });
                                  void handleApproveSuggestion(s.id);
                                }}
                                cardRef={(element) => {
                                  if (element)
                                    verseCardRefs.current.set(s.id, element);
                                  else verseCardRefs.current.delete(s.id);
                                }}
                              />
                              <div className="absolute right-1 top-1 z-[1] flex opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100">
                                <button
                                  type="button"
                                  onClick={() => addToQueue(s)}
                                  className="grid size-6 place-items-center rounded-md bg-black/55 text-zinc-200 hover:bg-black/75 hover:text-white"
                                  title={`Add ${s.reference} to queue`}
                                  aria-label={`Add ${s.reference} to queue`}
                                >
                                  <Plus size={12} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDismissSuggestion(s.id)
                                  }
                                  className="grid size-6 place-items-center rounded-md bg-black/55 text-zinc-200 hover:bg-black/75 hover:text-rose-300"
                                  title={`Dismiss ${s.reference}`}
                                  aria-label={`Dismiss ${s.reference}`}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                              {caption && (
                                <p
                                  className={cn(
                                    "mt-1 truncate text-center text-[10px]",
                                    isReading
                                      ? "text-amber-300"
                                      : "text-zinc-500",
                                  )}
                                >
                                  {caption}
                                </p>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
                {suggestionSections.history.length > 0 && (
                  <section className="w-full max-w-md border-t border-surface-border pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-narrow text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-600">
                        History
                        <span className="ml-2 font-sans font-medium normal-case tracking-normal tabular-nums">
                          {suggestionSections.history.length}
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        className="text-[10px] font-semibold text-zinc-600 hover:text-rose-400 focus-visible:outline-none"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-col">
                      {suggestionSections.history.slice(0, 5).map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() =>
                            void handleApproveSuggestion(
                              group.suggestions[0].id,
                            )
                          }
                          className="flex items-baseline justify-between gap-3 py-1.5 text-left hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
                        >
                          <span className="truncate text-[12px] font-medium text-zinc-300">
                            {group.reference}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                            {group.suggestions.length}
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {suggestions.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  <p className="text-[13px] font-medium text-zinc-400">
                    {isTranscribing
                      ? "Listening for scripture"
                      : "Nothing detected yet"}
                  </p>
                  <p className="mt-1 max-w-[16rem] text-[11px] leading-relaxed text-zinc-600">
                    {isTranscribing
                      ? "Quoted verses land here as slides. Click one to send it live."
                      : "Start the speech pipeline to detect verses as they are read."}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      </BoothWorkspace>
    </div>
  );
}
