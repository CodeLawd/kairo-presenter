import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  BookOpen,
  X,
  Play,
  Pause,
  Activity,
  Trash2,
  Volume2,
  AlertTriangle,
  RotateCcw,
  BookOpenCheck,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  Loader,
  Plus,
} from "lucide-react";
import { useAppStore } from "@/stores/useAppStore";
import { cn } from "@/lib/utils";
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
import { LiveOutputPreview } from "./LiveOutputPreview";
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

interface ScriptureHighlight {
  id: string;
  triggerText: string;
  reference: string;
  confidence: number;
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
  const [interimText, setInterimText] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(true);

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
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
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
      240,
    ),
  );
  const [previewWidth, setPreviewWidth] = useState(() =>
    normalizeOperatorPanelWidth(
      "right",
      localStorage.getItem("operator-preview-width"),
      320,
    ),
  );
  // Fills the panel (minus its p-4 padding) rather than capping at the queue
  // card width — the live output is the one preview worth showing large.
  const liveOutputPreviewWidth = Math.max(160, previewWidth - 32);
  const liveOutputPreviewHeight = Math.round((liveOutputPreviewWidth * 9) / 16);
  const [activeProjection, setActiveProjection] = useState<{
    reference: string;
    text: string;
  } | null>(null);

  const goLive = useCallback((reference: string, text: string): void => {
    setActiveProjection({ reference, text });
    useAppStore.getState().markLiveOutput(reference);
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
      group.suggestions.some((item) => item.reference === activeProjection?.reference),
    )?.id ??
    null;
  const suggestionSections = useMemo(
    () => partitionOperatorSuggestionGroups(suggestionGroups, activeGroupId, 3),
    [suggestionGroups, activeGroupId],
  );
  const visibleSuggestionIds = useMemo(
    () => suggestionSections.current.flatMap((group) => group.suggestions.map((item) => item.id)),
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

  const startPanelResize = useCallback(
    (side: OperatorPanelSide, event: React.PointerEvent): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = side === "left" ? transcriptWidth : previewWidth;
      let finalWidth = startWidth;
      const setWidth = side === "left" ? setTranscriptWidth : setPreviewWidth;
      const storageKey =
        side === "left"
          ? "operator-transcript-width"
          : "operator-preview-width";

      const handlePointerMove = (pointerEvent: PointerEvent): void => {
        finalWidth = resizeOperatorPanel(
          side,
          startWidth,
          pointerEvent.clientX - startX,
        );
        setWidth(finalWidth);
      };
      const handlePointerUp = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem(storageKey, String(finalWidth));
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [previewWidth, transcriptWidth],
  );

  const resizePanelByKeyboard = useCallback(
    (side: OperatorPanelSide, deltaX: number): void => {
      const currentWidth = side === "left" ? transcriptWidth : previewWidth;
      const nextWidth = resizeOperatorPanel(side, currentWidth, deltaX);
      if (side === "left") setTranscriptWidth(nextWidth);
      else setPreviewWidth(nextWidth);
      localStorage.setItem(
        side === "left"
          ? "operator-transcript-width"
          : "operator-preview-width",
        String(nextWidth),
      );
    },
    [previewWidth, transcriptWidth],
  );
  // Only enabled outputs are worth previewing — a disabled one shows nothing on
  // any screen, so offering it as a tab would be a lie.
  const previewOutputs = useMemo(
    () => overlay.outputs.filter((output) => output.enabled),
    [overlay.outputs],
  );
  const previewOutputId = useAppStore((s) => s.operatorPreviewOutputId);
  const setPreviewOutputId = useAppStore((s) => s.setOperatorPreviewOutputId);

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
    const item = mediaLibrary.items.find((candidate) => candidate.id === mediaLibrary.liveItemId);
    if (!item) return null;
    return { item, playback: normalizeMediaPlayback(mediaLibrary.playback[item.id]) };
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
    useAppStore.getState().markLiveOutput(candidate.reference);
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
    const { transcription, orchestrator } = useBootstrapStore.getState();
    if (transcription.length > 0) {
      setSegments(transcription.map((r) => resultToSegment(r)));
    }
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
          goLive(
            sug.reference,
            sug.verses.map((v) => v.text).join(" "),
          );
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
          useAppStore.getState().markLiveOutput(sug.reference);
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
      const edge = direction === "next" ? group.suggestions.at(-1) : group.suggestions[0];
      if (!edge) return;

      const queries = getAdjacentVerseQueries(
        [{ reference: edge.reference, translation: edge.translation, verses: edge.verses }],
        direction,
      );
      setAdjacentLoading(`${groupId}:${direction}`);
      try {
        let adjacent = null;
        for (const query of queries) {
          const [result] = await window.api.scripture.search(query, edge.translation);
          const expanded = result ? expandScriptureResult(result) : [];
          adjacent = direction === "previous" ? expanded.at(-1) : expanded[0];
          if (adjacent) break;
        }
        if (!adjacent || suggestionsRef.current.some(
          (item) => item.reference === adjacent?.reference && item.translation === adjacent?.translation,
        )) return;

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
              ? Math.max(...group.suggestions.map((item) => item.passageIndex ?? 0)) + 1
              : Math.min(...group.suggestions.map((item) => item.passageIndex ?? 0)) - 1,
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
          verseCardRefs.current.get(suggestion.id)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
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
        : [{ ...entry, id: `queued-${entry.reference}-${Date.now()}` }, ...prev],
    )
  }, [])

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

  const handleClearProjection = useCallback(async (): Promise<void> => {
    try {
      await window.api.propresenter.clearOverlay();
    } catch (err) {
      console.error(err);
    } finally {
      setActiveProjection(null);
      useAppStore.getState().clearScriptureLiveOutput();
    }
  }, []);

  const enqueueSearchResults = useCallback((results: ScriptureResult[]): void => {
    setQueue((prev) => {
      const seen = new Set(prev.map((item) => item.reference))
      const incoming: ScriptureSuggestion[] = []
      for (const result of results) {
        if (seen.has(result.reference)) continue
        seen.add(result.reference)
        const verseCount = result.verses.length
        const isRange = verseCount > 1
        incoming.push({
          id: `manual-${result.reference}-${Date.now()}`,
          reference: result.reference,
          verses: result.verses,
          translation: result.translation,
          confidence: 1,
          source: 'manual',
          triggerText: result.reference,
          ...(isRange
            ? {
                passageId: `queue-${result.reference}-${Date.now()}`,
                passageReference: result.reference,
                passageIndex: 0,
                passageLength: verseCount,
              }
            : {}),
        })
      }
      return incoming.length === 0 ? prev : [...incoming, ...prev]
    })
  }, [])

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
    if (isTranscribing) {
      try {
        await window.api.orchestrator.stop();
        setIsTranscribing(false);
      } catch (err) {
        console.error(err);
      }
    } else {
      try {
        const all = await window.api.settings.getAll();
        const devs = await window.api.audio.getDevices();
        const defaultDev = devs.find((d) => d.isDefault) || devs[0];
        const config = {
          audioDeviceId: all.audio.deviceId || defaultDev?.id || "",
          sttProvider: all.stt.apiKey ? "deepgram" : all.stt.provider,
          sttApiKey: all.stt.apiKey,
          sttLanguage: all.stt.language || "en",
          llmProvider: all.stt.llmProvider ?? "anthropic",
          llmApiKey:
            (all.stt.llmProvider ?? "anthropic") === "deepseek"
              ? all.stt.deepseekApiKey
              : all.stt.anthropicApiKey,
          scriptureTranslation: all.scripture.defaultTranslation,
          autoMode: autoModeEnabled,
          confidenceThreshold: all.scripture.confidenceThreshold,
          autoPresentDelaySec: 3,
        };
        await window.api.orchestrator.start(config);
        setIsTranscribing(true);
      } catch (err) {
        console.error(err);
      }
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
      if (isTyping) return;

      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const delta = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1;
        const nextId = navigateOperatorSuggestionId(
          visibleSuggestionIds,
          selectedSuggestionId,
          delta,
        );
        if (nextId) {
          setSelectedSuggestionId(nextId);
          verseCardRefs.current.get(nextId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        return;
      }
      // Ctrl/Cmd+F: Focus search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      // Ctrl/Cmd+A: Toggle auto mode (only when not typing)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        handleToggleAutoMode();
        return;
      }
      // Backspace / Delete: Clear current projection
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        handleClearProjection();
        return;
      }
      // Space / Enter: Approve top suggestion
      if (
        (e.key === " " || e.key === "Enter") &&
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
      if (e.key === "Escape") {
        e.preventDefault();
        if (suggestions.length > 0) {
          handleDismissSuggestion(suggestions[0].id);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    suggestions,
    selectedSuggestionId,
    visibleSuggestionIds,
    autoModeEnabled,
    handleApproveSuggestion,
    handleDismissSuggestion,
    handleClearProjection,
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
    <div className="h-full w-full flex flex-col bg-surface overflow-hidden">
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

      {/* Main columns */}
      <div className="flex-1 min-h-0 w-full flex">
        {/* LEFT COLUMN: compact live transcript */}
        <section
          className="shrink-0 flex flex-col bg-surface-secondary/15"
          style={{ width: transcriptWidth }}
        >
          <div className="px-4 py-3.5 border-b border-surface-border flex items-center justify-between bg-surface-secondary/40 shrink-0">
            <span className="font-narrow text-xs font-semibold text-slate-400 uppercase tracking-[0.08em]">
              Live transcript
            </span>
            {isTranscribing && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[9px] text-emerald-400 font-bold tracking-wider uppercase animate-pulse">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                Live
              </span>
            )}
          </div>
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
            className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth font-sans text-zinc-300 leading-relaxed text-sm antialiased select-text"
          >
            {segments.map((seg) => (
              <p
                key={seg.id}
                className="transition-all duration-300 opacity-90 hover:opacity-100"
              >
                <HighlightedText
                  text={seg.text}
                  scriptureHighlights={seg.scriptureHighlights}
                />
              </p>
            ))}
            {interimText && (
              <p className="text-slate-500 italic opacity-80 animate-pulse">
                {interimText}
              </p>
            )}
            {segments.length === 0 && !interimText && (
              <p className="text-xs text-slate-600 italic font-mono">
                {isTranscribing
                  ? "Listening for speech…"
                  : "Speech pipeline offline."}
              </p>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Audio Signal Level Indicator */}
          <div className="p-3 border-t border-surface-border bg-surface shrink-0 space-y-2">
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
            <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden relative border border-zinc-800/40">
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

        <button
          type="button"
          aria-label="Resize live transcript panel"
          title="Drag to resize live transcript"
          className="group relative w-1.5 shrink-0 cursor-col-resize border-x border-surface-border/60 bg-surface-secondary/30 outline-none transition-colors hover:bg-teal-500/20 focus-visible:bg-teal-500/25"
          onPointerDown={(event) => startPanelResize("left", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizePanelByKeyboard("left", -16);
            if (event.key === "ArrowRight") resizePanelByKeyboard("left", 16);
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-teal-400/70" />
        </button>

        {/* CENTER COLUMN: scripture detection workspace */}
        <section className="min-w-0 flex-1 flex flex-col">
          {resilienceStatus && resilienceStatus.claudeFallbackActive && (
            <div className="bg-amber-950/10 border-b border-amber-500/20 px-5 py-2 text-[10px] font-bold text-amber-400/90 flex items-center justify-between shrink-0 animate-pulse">
              <span>CLAUDE OFFLINE — LOCAL REGEX DETECTION ACTIVE</span>
              <span className="text-[9px] uppercase tracking-wider text-slate-500 font-mono">
                FALLBACK ACTIVE
              </span>
            </div>
          )}
          {/* SUGGESTION QUEUE */}
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-surface-border bg-surface-secondary/40 shrink-0">
            <span className="font-narrow text-xs font-semibold text-zinc-500 uppercase tracking-[0.08em]">
              Detected content
            </span>
            <div className="flex items-center gap-2">
              {heldSuggestions.length > 0 && (
                <button
                  type="button"
                  onClick={flushHeldSuggestions}
                  className="flex items-center gap-1.5 rounded-full bg-teal-500/15 px-2.5 py-1 text-[10px] font-semibold text-teal-300 transition-colors hover:bg-teal-500/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-400"
                >
                  <ArrowDown size={11} />
                  {heldSuggestions.length} new detection
                  {heldSuggestions.length === 1 ? "" : "s"}
                </button>
              )}
              {suggestions.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearDetections}
                  className="text-[10px] font-semibold text-slate-600 transition-colors hover:text-rose-400 focus-visible:outline-none focus-visible:text-rose-400"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
          <div
            ref={queueScrollRef}
            onWheel={noteQueueBrowsing}
            onTouchMove={noteQueueBrowsing}
            className="flex-1 overflow-y-auto bg-surface-secondary/5 p-4"
          >
            <div className="space-y-5">
              {suggestionSections.current.map((group) => {
                const followState = followStateRef.current;
                return (
                  <section key={group.id} className="space-y-2.5">
                    <div className="flex items-end justify-between gap-3 px-0.5">
                      <div>
                        <p className="text-sm font-semibold text-slate-200">
                          {group.reference}
                        </p>
                        <p className="mt-0.5 text-[10px] text-slate-500">
                          {group.suggestions.length} verse
                          {group.suggestions.length !== 1 ? "s" : ""} · selected
                          theme preview
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {followStateRef.current?.passageId === group.id && (
                          <span className="text-[10px] font-semibold text-teal-300">
                            Auto-follow armed
                          </span>
                        )}
                        <div className="flex overflow-hidden rounded-md border border-surface-border bg-surface-secondary">
                          <button
                            type="button"
                            onClick={() => void loadAdjacentDetectedVerse(group.id, "previous")}
                            disabled={adjacentLoading !== null}
                            className="flex size-7 items-center justify-center border-r border-surface-border text-slate-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-50"
                            title="Preload previous verse"
                            aria-label={`Preload verse before ${group.reference}`}
                          >
                            {adjacentLoading === `${group.id}:previous` ? <Loader size={12} className="animate-spin" /> : <ChevronLeft size={13} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void loadAdjacentDetectedVerse(group.id, "next")}
                            disabled={adjacentLoading !== null}
                            className="flex size-7 items-center justify-center text-slate-400 hover:bg-surface-tertiary hover:text-white disabled:opacity-50"
                            title="Preload next verse"
                            aria-label={`Preload verse after ${group.reference}`}
                          >
                            {adjacentLoading === `${group.id}:next` ? <Loader size={12} className="animate-spin" /> : <ChevronRight size={13} />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div
                      className="grid justify-start gap-3"
                      style={{
                        gridTemplateColumns: `repeat(auto-fill, ${OPERATOR_CARD_WIDTH}px)`,
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
                        const isSent = sentSuggestionIds.has(s.id);
                        const isLive =
                          activeProjection?.reference === s.reference;
                        return (
                          <article key={s.id} className="min-w-0 space-y-1.5">
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
                              width={OPERATOR_CARD_WIDTH}
                              height={OPERATOR_CARD_HEIGHT}
                              isActive={isReading || selectedSuggestionId === s.id}
                              isFocused={isReading || isUpNext || selectedSuggestionId === s.id}
                              isLive={isLive}
                              sendStatus={isLive ? "sent" : "idle"}
                              onSelect={() =>
                                void handleApproveSuggestion(s.id)
                              }
                              cardRef={(element) => {
                                if (element)
                                  verseCardRefs.current.set(s.id, element);
                                else verseCardRefs.current.delete(s.id);
                              }}
                            />
                            <div className="flex items-center justify-between gap-2 px-0.5">
                              <div className="min-w-0">
                                <p className="truncate text-[11px] font-semibold text-slate-300">
                                  {s.reference}
                                </p>
                                <p
                                  className={cn(
                                    "text-[9px] font-semibold",
                                    isLive
                                      ? "text-teal-300"
                                      : isReading
                                        ? "text-amber-300"
                                        : isUpNext
                                          ? "text-slate-400"
                                          : "text-slate-600",
                                  )}
                                >
                              {isLive
                                ? "Live · following reading"
                                : isReading
                                  ? "Reading now"
                                  : isUpNext
                                    ? "Up next"
                                    : s.preloadedNext
                                      ? "Preloaded next"
                                    : isSent
                                      ? "Shown"
                                          : `${Math.round(s.confidence * 100)}% confidence`}
                                </p>
                                {s.planMatch && (
                                  <span
                                    className="mt-0.5 inline-block rounded bg-teal-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-teal-300"
                                    title={
                                      s.planMatch === "quote"
                                        ? "Matched the reference playlist by verse text"
                                        : "On the reference playlist"
                                    }
                                  >
                                    {s.planMatch === "quote"
                                      ? "Playlist · read"
                                      : "Playlist"}
                                  </span>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-0.5">
                                <button
                                  type="button"
                                  onClick={() => addToQueue(s)}
                                  className="flex size-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-teal-500/10 hover:text-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
                                  title={`Add ${s.reference} to queue`}
                                  aria-label={`Add ${s.reference} to queue`}
                                >
                                  <Plus size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleDismissSuggestion(s.id)
                                  }
                                  className="flex size-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/50"
                                  title={`Dismiss ${s.reference}`}
                                  aria-label={`Dismiss ${s.reference}`}
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {suggestionSections.history.length > 0 && (
                <details className="rounded-lg border border-surface-border/70 bg-surface-secondary/30">
                  <summary className="cursor-pointer select-none px-3 py-2.5 text-[11px] font-semibold text-slate-400 marker:text-slate-600">
                    History · {suggestionSections.history.length} older passage{suggestionSections.history.length === 1 ? "" : "s"}
                  </summary>
                  <div className="border-t border-surface-border/70 p-2.5">
                    <div className="mb-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleClearHistory}
                        className="text-[10px] font-semibold text-slate-600 transition-colors hover:text-rose-400 focus-visible:outline-none focus-visible:text-rose-400"
                      >
                        Clear completed
                      </button>
                    </div>
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                      {suggestionSections.history.slice(0, 5).map((group) => (
                        <button
                          key={group.id}
                          type="button"
                          onClick={() => void handleApproveSuggestion(group.suggestions[0].id)}
                          className="rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-surface-border hover:bg-surface focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-teal-500/50 active:scale-[0.98]"
                        >
                          <span className="block truncate text-[11px] font-semibold text-slate-300">
                            {group.reference}
                          </span>
                          <span className="block text-[9px] text-slate-600">
                            {group.suggestions.length} verse{group.suggestions.length === 1 ? "" : "s"} · click to recall
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </details>
              )}
            </div>

            {suggestions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-slate-600 border border-dashed border-zinc-800 rounded-xl">
                <Activity
                  size={24}
                  className="mb-2 text-slate-700 animate-pulse"
                />
                <p className="text-xs font-semibold">
                  Listening for scriptures...
                </p>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  Read scripture quotes to trigger automatic cards
                </p>
              </div>
            )}
          </div>
        </section>

        <button
          type="button"
          aria-label="Resize live output preview panel"
          title="Drag to resize live output preview"
          className="group relative w-1.5 shrink-0 cursor-col-resize border-x border-surface-border/60 bg-surface-secondary/30 outline-none transition-colors hover:bg-teal-500/20 focus-visible:bg-teal-500/25"
          onPointerDown={(event) => startPanelResize("right", event)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizePanelByKeyboard("right", -16);
            if (event.key === "ArrowRight") resizePanelByKeyboard("right", 16);
          }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-teal-400/70" />
        </button>

        {/* RIGHT COLUMN: live output preview and essential controls */}
        <aside
          className="shrink-0 flex min-h-0 flex-col overflow-hidden bg-surface-secondary/10"
          style={{ width: previewWidth }}
        >
          {/* Live output scrolls instead of holding its full height. When the
              window (or the background dock) leaves this column short, something
              has to give — and it must not be the pipeline controls at the
              bottom, which are the ones the operator reaches for mid-service. */}
          <div className="min-h-0 shrink overflow-y-auto border-b border-surface-border p-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-slate-300">
                Live output
              </p>
              <p className="text-[10px] text-slate-500">ProPresenter</p>
            </div>
            <LiveOutputPreview
              outputs={previewOutputs}
              selectedOutputId={previewOutputId}
              onSelectOutput={setPreviewOutputId}
              result={livePreviewResult}
              liveMedia={liveMedia}
              overlay={overlay}
              width={liveOutputPreviewWidth}
              height={liveOutputPreviewHeight}
            />
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { label: "PP", status: ppStatus, error: ppError },
                { label: "STT", status: sttStatus, error: sttError },
                {
                  label: "AI",
                  status: claudeStatusMapped,
                  error: claudeErrorMapped,
                },
              ].map((service) => (
                <div
                  key={service.label}
                  title={service.error}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-surface-border bg-surface px-2 py-1.5"
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
                  <span className="text-[9px] font-semibold text-slate-400">
                    {service.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* overflow-hidden is load-bearing: without it the fixed-height header
              and search below spill past this box and paint over the pipeline
              controls once the column is squeezed. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-surface-border px-4 py-2.5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
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
                  <span className="text-slate-500">+</span> on a detection, or
                  search above. Click a row to send it to ProPresenter.
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

          {/* Compact pipeline controls */}
          <div className="shrink-0 border-t border-surface-border bg-surface-secondary/20 p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Pipeline controls
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {isTranscribing
                    ? "Listening and detecting scripture"
                    : "Audio capture is stopped"}
                </p>
              </div>
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  isTranscribing ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
                aria-hidden="true"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Button
                variant={isTranscribing ? "secondary" : "default"}
                onClick={handleTogglePipeline}
              >
                {isTranscribing ? (
                  <Pause data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
                {isTranscribing ? "Pause" : "Start pipeline"}
              </Button>
              <Button
                variant="destructive"
                onClick={handleClearProjection}
                disabled={!activeProjection}
                title="Clear the current ProPresenter output"
              >
                <Trash2 data-icon="inline-start" />
                Clear output
              </Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
