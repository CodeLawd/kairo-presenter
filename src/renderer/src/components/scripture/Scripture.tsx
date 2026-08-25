import { useState, useRef, useCallback, useEffect } from "react";
import { AlertCircle, BookOpen, Loader, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/useAppStore";
import {
  appendScriptureResultsToPlan,
  completeSermonPlanReview,
  insertScriptureResultInPlan,
  reorderSermonPlanItem,
  sermonPlanNeedsReview,
} from "@shared/ipc";
import type {
  ScriptureResult,
  ScriptureSuggestion,
  ScriptureTranslation,
  ScriptureTranslationOption,
  SermonPlan,
  SermonScriptureItem,
} from "@shared/ipc";
import {
  combineScriptureResults,
  expandScriptureResult,
  getAdjacentVerseQueries,
  getBookCompletion,
  normalizeScriptureQuery,
  resolveSubmittedScriptureQuery,
  shouldLiveSuggestScriptureQuery,
} from "@shared/scripture-query";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { PlanReviewPanel } from "./PlanReviewPanel";
import { QueueDock } from "./QueueDock";
import { ScriptureSearchBar } from "./ScriptureSearchBar";
import { VerseCardGrid } from "./VerseCardGrid";
import {
  CARD_BASE_HEIGHT,
  CARD_BASE_WIDTH,
  CARD_ZOOM_DEFAULT,
  createResultRow,
  findFlatCardIndex,
  flatIndexAt,
  flattenResultRows,
  locateFlatCard,
  type ResultRow,
  type SendStatus,
} from "./types";
import {
  DEFAULT_OVERLAY_SETTINGS,
  normalizeOverlaySettings,
} from "@shared/overlay-defaults";
import {
  resolveSermonPlanItems,
  translationFallbackOrder,
} from "@shared/sermon-plan-resolve";
import type { AppSettings } from "@shared/ipc";
import { useBootstrapStore } from "@/bootstrap/useBootstrapStore";
import { shouldShowApiBibleWarning } from "@/bootstrap/bootstrap-state";
import {
  API_BIBLE_ATTRIBUTION,
  getScriptureCacheNotice,
  shouldShowApiBibleAttribution,
} from "@shared/scripture-offline-state";

function mapCardStatus(
  rows: ResultRow[],
  flatIndex: number,
  sendStatus: SendStatus,
): ResultRow[] {
  let cursor = 0;
  return rows.map((row) => ({
    ...row,
    cards: row.cards.map((card) => {
      const index = cursor;
      cursor += 1;
      return index === flatIndex ? { ...card, sendStatus } : card;
    }),
  }));
}

export default function Scripture(): React.ReactElement {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Startup data comes from the shared bootstrap snapshot, so switching tabs
  // never shows an empty state while a first-mount IPC read resolves.
  const bootstrapSettings = useBootstrapStore((s) => s.settings);
  const bootstrapTranslations = useBootstrapStore((s) => s.translations);
  const bootstrapPlans = useBootstrapStore((s) => s.sermonPlans);
  const apiBibleAuth = useBootstrapStore((s) => s.apiBibleAuth);
  const bootstrapPhase = useBootstrapStore((s) => s.phase);

  const [translation, setTranslation] = useState<ScriptureTranslation>(
    bootstrapSettings.scripture.defaultTranslation,
  );
  const [translations, setTranslations] =
    useState<ScriptureTranslationOption[]>(bootstrapTranslations);
  const [plans, setPlans] = useState<SermonPlan[]>(bootstrapPlans);
  const [activePlan, setActivePlan] = useState<SermonPlan | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [cardsSource, setCardsSource] = useState<"search" | "plan" | null>(null);
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("before");
  const [pendingDeletePlanId, setPendingDeletePlanId] = useState<string | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [importing, setImporting] = useState(false);
  const [savingReview, setSavingReview] = useState(false);
  const [searchSuggestions, setSearchSuggestions] = useState<ScriptureResult[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [navigating, setNavigating] = useState<"previous" | "next" | null>(null);
  const [addedAllToPlan, setAddedAllToPlan] = useState<string | null>(null);
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [cueHighlight, setCueHighlight] = useState(false);
  const [focusHighlight, setFocusHighlight] = useState(false);
  const [cardZoom, setCardZoom] = useState(CARD_ZOOM_DEFAULT);
  const [overlay, setOverlay] = useState<AppSettings["overlay"]>(
    bootstrapSettings.overlay ?? DEFAULT_OVERLAY_SETTINGS,
  );
  const [plansReady, setPlansReady] = useState(true);

  const scriptureActivePlanId = useAppStore((s) => s.scriptureActivePlanId);
  const setScriptureViewState = useAppStore((s) => s.setScriptureViewState);
  const clearScriptureViewState = useAppStore((s) => s.clearScriptureViewState);
  const scriptureOutputClearToken = useAppStore((s) => s.scriptureOutputClearToken);
  const restoredPlanRef = useRef(false);
  const pendingItemRestoreRef = useRef<{
    itemId: string | null;
    cardInRow: number;
    mode: "none" | "focus" | "live";
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionRequestRef = useRef(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const bookCompletion = getBookCompletion(query);
  const cardMinWidth = Math.round(CARD_BASE_WIDTH * (cardZoom / 100));
  const cardHeight = Math.round(CARD_BASE_HEIGHT * (cardZoom / 100));
  const cards = flattenResultRows(rows);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const showQueueDock = !activePlan && rows.length > 0;
  const showVerseGrid = !activePlan && rows.length > 0;
  const openPlanItems: SermonScriptureItem[] =
    cardsSource === "plan" && selectedPlan
      ? selectedPlan.items
      : [];
  const activeLocation = locateFlatCard(rows, activeCardIndex);
  const activeItemId =
    cardsSource === "plan" && activeLocation
      ? (rows[activeLocation.rowIndex]?.planItemId ?? null)
      : null;

  const scrollToPlanItem = useCallback((itemId: string): void => {
    const scrollRoot = mainScrollRef.current;
    const rowEl = rowRefs.current.get(itemId);
    if (scrollRoot && rowEl) {
      const rootTop = scrollRoot.getBoundingClientRect().top;
      const rowTop = rowEl.getBoundingClientRect().top;
      scrollRoot.scrollTo({
        top: scrollRoot.scrollTop + (rowTop - rootTop) - 12,
        behavior: "smooth",
      });
      return;
    }
    rowEl?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const persistPlanView = useCallback(
    (
      planId: string,
      itemId: string | null,
      cardInRow: number,
      mode: "none" | "focus" | "live",
    ): void => {
      setScriptureViewState({ planId, itemId, cardInRow, mode });
    },
    [setScriptureViewState],
  );

  const selectPlanItem = useCallback((itemId: string): void => {
    const index = findFlatCardIndex(rows, (_card, row) => row.planItemId === itemId);
    if (index < 0) return;
    // Focus + scroll only — never go live / no Live badge
    setActiveCardIndex(index);
    setCueHighlight(false);
    setFocusHighlight(true);
    if (selectedPlanId) {
      persistPlanView(selectedPlanId, itemId, 0, "focus");
    }
    scrollToPlanItem(itemId);
  }, [persistPlanView, rows, scrollToPlanItem, selectedPlanId]);

  // Keep in step with the shared snapshot as other screens refresh it.
  useEffect(() => {
    setTranslations(bootstrapTranslations);
  }, [bootstrapTranslations]);

  useEffect(() => {
    setOverlay(normalizeOverlaySettings(bootstrapSettings.overlay));
  }, [bootstrapSettings.overlay]);

  // Playlist edits here are the source of truth: publish them so the toolbar
  // and a later remount of this tab never restore stale startup data.
  useEffect(() => {
    useBootstrapStore.getState().setSermonPlans(plans);
  }, [plans]);

  // When header CLEAR (or Operator clear) empties PP, drop Live badges in the UI
  useEffect(() => {
    if (scriptureOutputClearToken === 0) return;
    const mode = useAppStore.getState().scriptureHighlightMode;
    setCueHighlight(false);
    setFocusHighlight(mode === "focus");
    setRows((previous) =>
      previous.map((row) => ({
        ...row,
        cards: row.cards.map((card) =>
          card.sendStatus === "idle" ? card : { ...card, sendStatus: "idle" },
        ),
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to clear token
  }, [scriptureOutputClearToken]);

  // Pick up Theme / Settings overlay changes when returning to the window
  useEffect(() => {
    const refreshOverlay = (): void => {
      void window.api.settings
        .get("overlay")
        .then((stored) => setOverlay(normalizeOverlaySettings(stored)))
        .catch(() => {});
    };
    window.addEventListener("focus", refreshOverlay);
    return () => window.removeEventListener("focus", refreshOverlay);
  }, []);

  useEffect(() => {
    const requestId = ++suggestionRequestRef.current;
    if (!shouldLiveSuggestScriptureQuery(query)) {
      setSearchSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void window.api.scripture
        .search(query.trim(), translation)
        .then((results) => {
          if (suggestionRequestRef.current !== requestId) return;
          setSearchSuggestions(results.slice(0, 5));
          setActiveSuggestion(0);
          setSuggestionsOpen(results.length > 0);
        })
        .catch(() => {
          if (suggestionRequestRef.current !== requestId) return;
          setSearchSuggestions([]);
          setSuggestionsOpen(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query, translation]);

  const handleSearch = useCallback(
    async (submittedQuery?: string): Promise<void> => {
      const q = (submittedQuery ?? query).trim();
      if (!q) return;
      setLoading(true);
      setError(null);
      try {
        let results = await window.api.scripture.search(q, translation);
        // Multi-verse / reference lookup: if the selected Bible has no text,
        // try local fallbacks so ranges like Philippians 4:6–7 still load.
        if (results.length === 0) {
          const looksLikeReference = Boolean(
            normalizeScriptureQuery(q) ?? q.match(/\d+:\d+/),
          );
          if (looksLikeReference) {
            for (const fallback of translationFallbackOrder(
              translation,
              translation,
              translations,
            )) {
              if (fallback === translation) continue;
              results = await window.api.scripture.search(q, fallback);
              if (results.length > 0) {
                setError(
                  `${translation} text unavailable — showing ${fallback}. Change translation in the dropdown when the Bible is available.`,
                );
                break;
              }
            }
          }
        }
        setRows(
          results.map((result, index) =>
            createResultRow(result, { id: `search-${index}-${result.reference}` }),
          ),
        );
        setCardsSource("search");
        setActivePlan(null);
        setAddedAllToPlan(null);
        setActiveCardIndex(0);
        if (results.length === 0) {
          setError('No results. Try a reference like “John 3:16” or “Romans 8:28”.');
        }
      } catch (err) {
        // Cache/expiry states get an explanation of what to do next; other
        // failures keep their original wording.
        const notice = getScriptureCacheNotice(err);
        setError(
          notice
            ? `${notice.message} ${notice.hint}`
            : (err as Error).message || "Search failed",
        );
        setRows([]);
      } finally {
        setLoading(false);
      }
    },
    [query, translation, translations],
  );

  const previewSuggestion = useCallback((result: ScriptureResult): void => {
    setQuery(result.reference);
    setRows([createResultRow(result, { id: `suggest-${result.reference}` })]);
    setCardsSource("search");
    setActivePlan(null);
    setError(null);
    setSuggestionsOpen(false);
    setSearchSuggestions([]);
    setAddedAllToPlan(null);
    setActiveCardIndex(0);
  }, []);

  const handleTranslationChange = useCallback(
    async (next: ScriptureTranslation): Promise<void> => {
      setTranslation(next);
      await window.api.scripture.setTranslation(next);
      const store = useBootstrapStore.getState();
      store.patchSettings('scripture', {
        ...store.settings.scripture,
        defaultTranslation: next,
      });
    },
    [],
  );

  const openPlan = useCallback(async (plan: SermonPlan): Promise<void> => {
    const items = await resolveSermonPlanItems(
      plan.items,
      translation,
      (query, itemTranslation) =>
        window.api.scripture.search(query, itemTranslation),
      translations,
    );
    const refreshed = items.some((item, index) => {
      const previous = plan.items[index];
      return (
        item.available !== previous?.available ||
        item.translation !== previous?.translation ||
        item.verses.length !== previous?.verses.length ||
        item.error !== previous?.error
      );
    })
      ? await window.api.scripture.saveSermonPlan({ ...plan, items })
      : { ...plan, items };

    setPlans((previous) =>
      previous.map((candidate) =>
        candidate.id === refreshed.id ? refreshed : candidate,
      ),
    );
    setSelectedPlanId(refreshed.id);
    setScriptureViewState({
      planId: refreshed.id,
      itemId: null,
      cardInRow: 0,
      mode: "none",
    });
    setAddedAllToPlan(null);
    setActiveCardIndex(0);
    setCueHighlight(false);
    setFocusHighlight(false);
    setError(null);

    if (sermonPlanNeedsReview(refreshed)) {
      setActivePlan(refreshed);
      setCardsSource("plan");
      setRows([]);
      return;
    }

    // Every playlist item is a row — including multi-verse ranges
    setActivePlan(null);
    setCardsSource("plan");
    setRows(
      refreshed.items.map((item) =>
        createResultRow(
          {
            reference: item.reference,
            translation: item.translation,
            verses: item.verses,
          },
          { id: item.id, planItemId: item.id, note: item.error },
        ),
      ),
    );

    const missing = refreshed.items.filter((item) => !item.available);
    if (missing.length > 0) {
      setError(
        `${missing.length} playlist item${missing.length !== 1 ? "s" : ""} still have no verse text. Check Bible translations / API key.`,
      );
    }
  }, [setScriptureViewState, translation, translations]);

  // Restore last opened playlist + item when returning to Scripture
  useEffect(() => {
    if (!plansReady || restoredPlanRef.current) return;
    restoredPlanRef.current = true;
    const saved = useAppStore.getState();
    if (!saved.scriptureActivePlanId) return;
    const plan = plans.find(
      (candidate) => candidate.id === saved.scriptureActivePlanId,
    );
    if (!plan) return;
    pendingItemRestoreRef.current = {
      itemId: saved.scriptureActiveItemId,
      cardInRow: saved.scriptureActiveCardInRow,
      mode: saved.scriptureHighlightMode,
    };
    void openPlan(plan);
  }, [openPlan, plans, plansReady]);

  // After plan rows load, restore the last item focus/live position
  useEffect(() => {
    const pending = pendingItemRestoreRef.current;
    if (!pending || cardsSource !== "plan" || rows.length === 0) return;
    pendingItemRestoreRef.current = null;

    const rowIndex = pending.itemId
      ? rows.findIndex((row) => row.planItemId === pending.itemId)
      : 0;
    if (rowIndex < 0) return;
    const row = rows[rowIndex];
    const cardInRow = Math.min(
      Math.max(0, pending.cardInRow),
      Math.max(0, row.cards.length - 1),
    );
    const index = flatIndexAt(rows, rowIndex, cardInRow);
    setActiveCardIndex(index);
    setCueHighlight(pending.mode === "live");
    setFocusHighlight(pending.mode === "focus" || pending.mode === "live");
    const itemId = row.planItemId ?? row.id;
    if (selectedPlanId) {
      persistPlanView(selectedPlanId, itemId, cardInRow, pending.mode);
    }
    requestAnimationFrame(() => {
      scrollToPlanItem(itemId);
    });
  }, [cardsSource, persistPlanView, rows, scrollToPlanItem, selectedPlanId]);

  const handleImport = useCallback(async (): Promise<void> => {
    setImporting(true);
    setError(null);
    try {
      const draft = await window.api.scripture.importSermonNotes();
      if (!draft) return;
      if (draft.items.length === 0) {
        setError("No scripture references were found in that document.");
        return;
      }
      const resolvedItems = await resolveSermonPlanItems(
        draft.items.map((item) => ({
          ...item,
          verses: [],
          available: false,
        })),
        translation,
        (query, itemTranslation) =>
          window.api.scripture.search(query, itemTranslation),
        translations,
      );
      const now = Date.now();
      const plan = await window.api.scripture.saveSermonPlan({
        id: `sermon-${now}`,
        title: draft.title,
        sourceFileName: draft.sourceFileName,
        items: resolvedItems,
        createdAt: now,
        updatedAt: now,
      });
      setPlans((previous) => [plan, ...previous]);
      await openPlan(plan);
    } catch (importError) {
      setError(
        (importError as Error).message || "Could not import sermon notes.",
      );
    } finally {
      setImporting(false);
    }
  }, [openPlan, translation, translations]);

  const deletePlan = useCallback(
    async (planId: string): Promise<void> => {
      await window.api.scripture.deleteSermonPlan(planId);
      setPlans((previous) => {
        const remaining = previous.filter((plan) => plan.id !== planId);
        if (selectedPlanId === planId) setSelectedPlanId(remaining[0]?.id ?? null);
        return remaining;
      });
      setPendingDeletePlanId(null);
      if (renamingPlanId === planId) {
        setRenamingPlanId(null);
        setRenameDraft("");
      }
      if (activePlan?.id === planId || (cardsSource === "plan" && selectedPlanId === planId)) {
        setActivePlan(null);
        setRows([]);
        setCardsSource(null);
      }
      if (scriptureActivePlanId === planId) clearScriptureViewState();
    },
    [activePlan, cardsSource, clearScriptureViewState, renamingPlanId, scriptureActivePlanId, selectedPlanId],
  );

  const startRenamePlan = useCallback((plan: SermonPlan): void => {
    setPendingDeletePlanId(null);
    setRenamingPlanId(plan.id);
    setRenameDraft(plan.title);
  }, []);

  const cancelRenamePlan = useCallback((): void => {
    setRenamingPlanId(null);
    setRenameDraft("");
  }, []);

  const saveRenamePlan = useCallback(async (): Promise<void> => {
    if (!renamingPlanId) return;
    const title = renameDraft.trim();
    if (!title) {
      setError("Playlist name cannot be empty.");
      return;
    }
    const target = plans.find((plan) => plan.id === renamingPlanId);
    if (!target) return;
    if (target.title === title) {
      cancelRenamePlan();
      return;
    }

    const optimistic = { ...target, title, updatedAt: Date.now() };
    setPlans((previous) =>
      previous.map((plan) => (plan.id === optimistic.id ? optimistic : plan)),
    );
    setActivePlan((current) =>
      current?.id === optimistic.id ? { ...current, title } : current,
    );
    cancelRenamePlan();

    try {
      const saved = await window.api.scripture.saveSermonPlan(optimistic);
      setPlans((previous) =>
        previous.map((plan) => (plan.id === saved.id ? saved : plan)),
      );
      setActivePlan((current) => (current?.id === saved.id ? saved : current));
    } catch (saveError) {
      setPlans((previous) =>
        previous.map((plan) => (plan.id === target.id ? target : plan)),
      );
      setActivePlan((current) =>
        current?.id === target.id ? target : current,
      );
      setError((saveError as Error).message || "Could not rename that playlist.");
    }
  }, [cancelRenamePlan, plans, renameDraft, renamingPlanId]);

  const createPlaylist = useCallback(async (): Promise<void> => {
    if (creatingPlaylist) return;
    setCreatingPlaylist(true);
    setError(null);
    try {
      const now = Date.now();
      const plan = await window.api.scripture.saveSermonPlan({
        id: `sermon-${now}`,
        title: "Untitled playlist",
        sourceFileName: "Manual",
        items: [],
        createdAt: now,
        updatedAt: now,
        reviewedAt: now,
      });
      setPlans((previous) => [
        plan,
        ...previous.filter((candidate) => candidate.id !== plan.id),
      ]);
      setSelectedPlanId(plan.id);
      setScriptureViewState({
        planId: plan.id,
        itemId: null,
        cardInRow: 0,
        mode: "none",
      });
      setAddedAllToPlan(null);
      setRows([]);
      setCardsSource("plan");
      setActivePlan(null);
      setActiveCardIndex(0);
      setCueHighlight(false);
      setFocusHighlight(false);
      setRenamingPlanId(plan.id);
      setRenameDraft(plan.title);
    } catch (createError) {
      setError((createError as Error).message || "Could not create a playlist.");
    } finally {
      setCreatingPlaylist(false);
    }
  }, [creatingPlaylist, setScriptureViewState]);

  const finishReview = useCallback(async (): Promise<void> => {
    if (!activePlan || savingReview) return;
    const completed = completeSermonPlanReview(activePlan);
    setSavingReview(true);
    setActivePlan(null);
    setPlans((previous) =>
      previous.map((plan) => (plan.id === completed.id ? completed : plan)),
    );
    try {
      const saved = await window.api.scripture.saveSermonPlan(completed);
      setPlans((previous) =>
        previous.map((plan) => (plan.id === saved.id ? saved : plan)),
      );
      await openPlan(saved);
    } catch (saveError) {
      setActivePlan(activePlan);
      setPlans((previous) =>
        previous.map((plan) => (plan.id === activePlan.id ? activePlan : plan)),
      );
      setError(
        (saveError as Error).message || "Could not save review completion.",
      );
    } finally {
      setSavingReview(false);
    }
  }, [activePlan, openPlan, savingReview]);

  const addAllResultsToPlaylist = useCallback(async (): Promise<void> => {
    const target = plans.find((plan) => plan.id === selectedPlanId);
    // One playlist item per row (keep multi-verse passages together)
    const results = rows
      .map((row) => combineScriptureResults(row.cards.map((card) => card.result)))
      .filter((result): result is ScriptureResult => result !== null && result.verses.length > 0);
    if (!target || results.length === 0) return;

    try {
      const batchId = `manual-${Date.now()}`;
      const updated = appendScriptureResultsToPlan(target, results, batchId);
      const saved = await window.api.scripture.saveSermonPlan(updated);
      setPlans((previous) =>
        previous.map((plan) => (plan.id === saved.id ? saved : plan)),
      );
      setAddedAllToPlan(saved.title);
      await openPlan(saved);
    } catch (saveError) {
      setError(
        (saveError as Error).message ||
          "Could not add the loaded verses to that playlist.",
      );
    }
  }, [openPlan, plans, rows, selectedPlanId]);

  const reorderPlanItem = useCallback(
    async (
      draggedId: string,
      targetId: string,
      position: "before" | "after",
    ): Promise<void> => {
      if (!activePlan || draggedId === targetId) return;
      const optimistic = reorderSermonPlanItem(
        activePlan,
        draggedId,
        targetId,
        position,
      );
      if (optimistic === activePlan) return;
      const previousPlan = activePlan;
      setActivePlan(optimistic);
      setPlans((previous) =>
        previous.map((plan) => (plan.id === optimistic.id ? optimistic : plan)),
      );

      try {
        const saved = await window.api.scripture.saveSermonPlan(optimistic);
        setActivePlan(saved);
        setPlans((previous) =>
          previous.map((plan) => (plan.id === saved.id ? saved : plan)),
        );
      } catch (saveError) {
        setActivePlan(previousPlan);
        setPlans((previous) =>
          previous.map((plan) =>
            plan.id === previousPlan.id ? previousPlan : plan,
          ),
        );
        setError(
          (saveError as Error).message ||
            "Could not save the new passage order.",
        );
      }
    },
    [activePlan],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>): void => {
      if (e.key === "Tab" && bookCompletion) {
        e.preventDefault();
        setQuery(bookCompletion.value);
        return;
      }
      if (e.key === "Escape" && suggestionsOpen) {
        e.preventDefault();
        setSuggestionsOpen(false);
        return;
      }
      if (suggestionsOpen && searchSuggestions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setActiveSuggestion((current) => (current + 1) % searchSuggestions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setActiveSuggestion(
            (current) =>
              (current - 1 + searchSuggestions.length) % searchSuggestions.length,
          );
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          previewSuggestion(searchSuggestions[activeSuggestion]);
          return;
        }
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const submittedQuery = resolveSubmittedScriptureQuery(query);
        setQuery(submittedQuery);
        void handleSearch(submittedQuery);
      }
    },
    [
      activeSuggestion,
      bookCompletion,
      handleSearch,
      previewSuggestion,
      query,
      searchSuggestions,
      suggestionsOpen,
    ],
  );

  const loadAdjacentVerse = useCallback(
    async (direction: "previous" | "next"): Promise<void> => {
      const location = locateFlatCard(rows, activeCardIndex);
      if (!location || navigating) return;

      const activeRow = rows[location.rowIndex];
      const anchorCard =
        direction === "next"
          ? activeRow.cards.at(-1)
          : activeRow.cards[0];
      if (!anchorCard) return;

      // Next/Previous relative to the selected item (row), not the playlist ends
      const queries = getAdjacentVerseQueries([anchorCard.result], direction);
      if (queries.length === 0) return;

      setNavigating(direction);
      setError(null);
      try {
        let adjacent: ScriptureResult | undefined;
        const lookupTranslation =
          (anchorCard.result.translation as ScriptureTranslation) || translation;
        for (const adjacentQuery of queries) {
          const [result] = await window.api.scripture.search(
            adjacentQuery,
            lookupTranslation,
          );
          const expanded = result ? expandScriptureResult(result) : [];
          adjacent = direction === "previous" ? expanded.at(-1) : expanded[0];
          if (adjacent) break;
        }
        if (!adjacent) {
          // Fall back to the operator's selected translation if the item's Bible failed
          if (lookupTranslation !== translation) {
            for (const adjacentQuery of queries) {
              const [result] = await window.api.scripture.search(
                adjacentQuery,
                translation,
              );
              const expanded = result ? expandScriptureResult(result) : [];
              adjacent = direction === "previous" ? expanded.at(-1) : expanded[0];
              if (adjacent) break;
            }
          }
        }
        if (!adjacent) {
          setError(
            `No ${direction === "next" ? "next" : "previous"} verse is available in ${lookupTranslation}.`,
          );
          return;
        }

        const existingIndex = findFlatCardIndex(
          rows,
          (card) =>
            card.result.reference === adjacent.reference &&
            card.result.translation === adjacent.translation,
        );
        if (existingIndex >= 0) {
          setActiveCardIndex(existingIndex);
          setCueHighlight(true);
          setFocusHighlight(true);
          const location = locateFlatCard(rows, existingIndex);
          if (cardsSource === "plan" && selectedPlanId && location) {
            persistPlanView(
              selectedPlanId,
              rows[location.rowIndex]?.planItemId ?? null,
              location.cardIndex,
              "live",
            );
          }
          cardRefs.current[existingIndex]?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
          return;
        }

        const relativeItemId = activeRow.planItemId ?? null;
        let planItemId: string | undefined;
        if (cardsSource === "plan" && selectedPlanId) {
          const target = plans.find((plan) => plan.id === selectedPlanId);
          if (target) {
            planItemId = `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const updated = insertScriptureResultInPlan(
              target,
              adjacent,
              planItemId,
              relativeItemId,
              direction === "next" ? "after" : "before",
            );
            const saved = await window.api.scripture.saveSermonPlan(updated);
            setPlans((previous) =>
              previous.map((plan) => (plan.id === saved.id ? saved : plan)),
            );
            const savedItem = saved.items.find((item) => item.id === planItemId)
              ?? (direction === "next"
                ? saved.items[saved.items.findIndex((item) => item.id === relativeItemId) + 1]
                : saved.items[saved.items.findIndex((item) => item.id === relativeItemId) - 1]);
            planItemId = savedItem?.id ?? planItemId;
          }
        }

        const newCard = {
          result: adjacent,
          sendStatus: "idle" as const,
          planItemId,
        };

        if (cardsSource === "search") {
          const insertCardAt =
            direction === "next" ? activeRow.cards.length : 0;
          const updatedRows = rows.map((row, idx) => {
            if (idx !== location.rowIndex) return row;
            const cards =
              direction === "next"
                ? [...row.cards, newCard]
                : [newCard, ...row.cards];
            const combined = combineScriptureResults(
              cards.map((card) => card.result),
            );
            return {
              ...row,
              reference: combined?.reference ?? row.reference,
              cards,
            };
          });
          const newFlatIndex = flatIndexAt(
            updatedRows,
            location.rowIndex,
            insertCardAt,
          );
          setRows(updatedRows);
          setActiveCardIndex(newFlatIndex);
          setCueHighlight(true);
          setFocusHighlight(true);
          requestAnimationFrame(() => {
            cardRefs.current[newFlatIndex]?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          });
          setAddedAllToPlan(null);
          return;
        }

        const nextRow = createResultRow(adjacent, {
          id: planItemId ?? `adj-${adjacent.reference}-${Date.now()}`,
          planItemId,
        });
        const insertAt =
          direction === "next" ? location.rowIndex + 1 : location.rowIndex;
        setRows((previous) => {
          const copy = [...previous];
          copy.splice(insertAt, 0, nextRow);
          return copy;
        });
        const newFlatIndex = flatIndexAt(
          [
            ...rows.slice(0, insertAt),
            nextRow,
            ...rows.slice(insertAt),
          ],
          insertAt,
          0,
        );
        setActiveCardIndex(newFlatIndex);
        setCueHighlight(true);
        setFocusHighlight(true);
        if (cardsSource === "plan" && selectedPlanId) {
          persistPlanView(selectedPlanId, planItemId ?? null, 0, "live");
        }
        requestAnimationFrame(() => {
          cardRefs.current[newFlatIndex]?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
        });
        setAddedAllToPlan(null);
      } catch (navigationError) {
        setError(
          (navigationError as Error).message ||
            `Could not load the ${direction} verse.`,
        );
      } finally {
        setNavigating(null);
      }
    },
    [
      activeCardIndex,
      cardsSource,
      navigating,
      persistPlanView,
      plans,
      rows,
      selectedPlanId,
      translation,
    ],
  );

  const handleSend = useCallback(
    async (idx: number): Promise<void> => {
      const card = cards[idx];
      if (!card || card.sendStatus === "sending") return;

      setRows((prev) => mapCardStatus(prev, idx, "sending"));

      try {
        const suggestion: ScriptureSuggestion = {
          id: `manual-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          reference: card.result.reference,
          verses: card.result.verses,
          translation: card.result.translation as ScriptureTranslation,
          confidence: 1.0,
          source: "manual",
          triggerText: card.result.reference,
        };
        await window.api.scripture.register(suggestion);
        await window.api.scripture.approve(suggestion.id);
        useAppStore.getState().markLiveOutput(card.result.reference);
        setRows((prev) => mapCardStatus(prev, idx, "sent"));
        setTimeout(() => {
          setRows((prev) => mapCardStatus(prev, idx, "idle"));
        }, 3000);
      } catch {
        setRows((prev) => mapCardStatus(prev, idx, "error"));
      }
    },
    [cards],
  );

  useEffect(() => {
    if (activePlan || cards.length === 0) return;

    const handleQueueKeyboard = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"], [role="slider"]')) return;
      if (target?.closest('[data-slot="slider"]')) return;
      // Sidebar / menus: clicking an item must not send on Enter/Space
      if (target?.closest("[data-playlist-sidebar]")) return;
      if (target?.closest('[role="menu"], [data-radix-menu-content]')) return;

      const location = locateFlatCard(rows, activeCardIndex);
      if (!location) return;

      let nextIndex = activeCardIndex;
      if (event.key === "ArrowLeft") {
        nextIndex -= 1;
      } else if (event.key === "ArrowRight") {
        nextIndex += 1;
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (location.rowIndex <= 0) return;
        const prevRow = rows[location.rowIndex - 1];
        const cardIndex = Math.min(location.cardIndex, prevRow.cards.length - 1);
        nextIndex = flatIndexAt(rows, location.rowIndex - 1, cardIndex);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (location.rowIndex >= rows.length - 1) return;
        const nextRow = rows[location.rowIndex + 1];
        const cardIndex = Math.min(location.cardIndex, nextRow.cards.length - 1);
        nextIndex = flatIndexAt(rows, location.rowIndex + 1, cardIndex);
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        void handleSend(activeCardIndex);
        return;
      } else return;

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
      }      nextIndex = Math.max(0, Math.min(cards.length - 1, nextIndex));
      if (nextIndex === activeCardIndex) return;
      setActiveCardIndex(nextIndex);
      setCueHighlight(true);
      setFocusHighlight(true);
      const nextLocation = locateFlatCard(rows, nextIndex);
      if (cardsSource === "plan" && selectedPlanId && nextLocation) {
        persistPlanView(
          selectedPlanId,
          rows[nextLocation.rowIndex]?.planItemId ?? null,
          nextLocation.cardIndex,
          "live",
        );
      }
      cardRefs.current[nextIndex]?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      void handleSend(nextIndex);
    };

    window.addEventListener("keydown", handleQueueKeyboard);
    return () => window.removeEventListener("keydown", handleQueueKeyboard);
  }, [
    activeCardIndex,
    activePlan,
    cards.length,
    cardsSource,
    handleSend,
    persistPlanView,
    rows,
    selectedPlanId,
  ]);

  const handleClearResults = useCallback((): void => {
    setRows([]);
    setCardsSource(null);
    setError(null);
    setAddedAllToPlan(null);
    setActiveCardIndex(0);
    setCueHighlight(false);
    setFocusHighlight(false);
    setSelectedPlanId(null);
    clearScriptureViewState();
    inputRef.current?.focus();
  }, [clearScriptureViewState]);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden">
      <PlaylistSidebar
        plans={plans}
        selectedPlanId={selectedPlanId}
        openPlanItems={openPlanItems}
        activeItemId={activeItemId}
        showItems={cardsSource === "plan" && !activePlan}
        renamingPlanId={renamingPlanId}
        renameDraft={renameDraft}
        pendingDeletePlanId={pendingDeletePlanId}
        creatingPlaylist={creatingPlaylist}
        showAddTarget={showQueueDock && cardsSource === "search" && plans.length > 0}
        onCreate={() => void createPlaylist()}
        onOpenPlan={(plan) => void openPlan(plan)}
        onSelectItem={selectPlanItem}
        onStartRename={startRenamePlan}
        onCancelRename={cancelRenamePlan}
        onSaveRename={() => void saveRenamePlan()}
        onRenameDraftChange={setRenameDraft}
        onRequestDelete={setPendingDeletePlanId}
        onCancelDelete={() => setPendingDeletePlanId(null)}
        onConfirmDelete={(planId) => void deletePlan(planId)}
        onSelectedPlanChange={(planId) => {
          setSelectedPlanId(planId);
          setAddedAllToPlan(null);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 space-y-4 border-b border-surface-border/70 bg-surface-secondary/95 px-5 pt-5 pb-4 backdrop-blur-xl lg:px-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="page-header">Scripture</h1>
              <p className="page-subtitle">
                Search verses or prepare a reusable sermon playlist
              </p>
            </div>
            <Button variant="outline" onClick={() => void handleImport()} disabled={importing}>
              {importing ? (
                <Loader data-icon="inline-start" className="animate-spin" />
              ) : (
                <Upload data-icon="inline-start" />
              )}
              {importing ? "Extracting…" : "Import sermon notes"}
            </Button>
          </div>

          <ScriptureSearchBar
            query={query}
            translation={translation}
            translations={translations}
            loading={loading}
            bookCompletion={bookCompletion}
            searchSuggestions={searchSuggestions}
            suggestionsOpen={suggestionsOpen}
            activeSuggestion={activeSuggestion}
            inputRef={inputRef}
            onQueryChange={(value) => {
              setQuery(value);
              if (shouldLiveSuggestScriptureQuery(value)) setSuggestionsOpen(true);
            }}
            onTranslationChange={(value) => void handleTranslationChange(value)}
            onSearch={() => void handleSearch()}
            onClearQuery={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (searchSuggestions.length > 0) setSuggestionsOpen(true);
            }}
            onActiveSuggestionChange={setActiveSuggestion}
            onPreviewSuggestion={previewSuggestion}
          />

          {shouldShowApiBibleWarning(
            apiBibleAuth,
            Boolean(bootstrapSettings.stt.bibleApiKey),
            bootstrapPhase === 'ready' || bootstrapPhase === 'ready-with-warnings',
          ) &&
            translation === "NKJV" &&
            !translations.find((item) => item.id === "NKJV")?.available && (
              <div className="flex gap-2 rounded-lg border border-yellow-500/25 bg-yellow-500/5 px-3.5 py-3 text-xs text-yellow-400">
                <AlertCircle size={14} className="shrink-0" />
                NKJV is the default, but its text requires an API.Bible key authorized for
                NKJV. Add the key in Settings → API Keys.
              </div>
            )}

          {rows.length > 0 &&
            shouldShowApiBibleAttribution(
              translations.find((option) => option.id === translation),
            ) && (
              <p className="px-1 text-[10px] text-slate-500">
                <a
                  href={API_BIBLE_ATTRIBUTION.url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-slate-300"
                >
                  {API_BIBLE_ATTRIBUTION.label}
                </a>
              </p>
            )}

          {error && (
            <div
              className="flex items-start gap-2.5 rounded-xl border border-yellow-500/15 bg-yellow-500/5 px-4 py-3.5 text-sm text-yellow-400 shadow-glow-yellow/5 animate-slide-in"
              role="alert"
              aria-live="polite"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div
          ref={mainScrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          style={{ scrollbarGutter: "stable" }}
        >
          <div className="w-full space-y-4 px-5 py-4 lg:px-6">
            {activePlan && (
              <PlanReviewPanel
                activePlan={activePlan}
                draggingItemId={draggingItemId}
                dragOverItemId={dragOverItemId}
                dropPosition={dropPosition}
                savingReview={savingReview}
                onFinishReview={() => void finishReview()}
                onDraggingItemIdChange={setDraggingItemId}
                onDragOverItemIdChange={setDragOverItemId}
                onDropPositionChange={setDropPosition}
                onReorder={(draggedId, targetId, position) =>
                  void reorderPlanItem(draggedId, targetId, position)
                }
              />
            )}

            {!activePlan && rows.length === 0 && !loading && !error && (
              <div className="double-bezel-outer">
                <div className="double-bezel-inner flex flex-col items-center py-14 text-center">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary/60">
                    <BookOpen size={20} className="text-slate-500" aria-hidden="true" />
                  </div>
                  {cardsSource === "plan" ? (
                    <>
                      <p className="text-sm font-semibold text-slate-300">
                        {selectedPlan?.title ?? "Playlist"} is empty
                      </p>
                      <p className="mt-1.5 font-sans text-xs text-slate-500">
                        Search a reference, then use Add all — or use Previous / Next after
                        the first verse is in the playlist
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-300">
                        Enter a reference or words you remember
                      </p>
                      <p className="mt-1.5 font-sans text-xs text-slate-500">
                        Try “jos 1 5 9”, press Tab to complete a book, or search a phrase
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {showVerseGrid && (
              <div className="px-0.5">
                <p className="text-xs font-semibold text-slate-300">
                  {cardsSource === "plan"
                    ? (selectedPlan?.title ?? "Playlist")
                    : "Loaded passage"}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {rows.length} item{rows.length !== 1 ? "s" : ""} · {cards.length}{" "}
                  verse{cards.length !== 1 ? "s" : ""} · theme preview
                  {cardsSource === "plan"
                    ? " · Previous / Next adds more · arrows send"
                    : " · Previous / Next fills the row · arrows send · Enter goes live"}
                </p>
              </div>
            )}

            {showVerseGrid && (
              <VerseCardGrid
                rows={rows}
                activeCardIndex={activeCardIndex}
                cueHighlight={cueHighlight}
                focusHighlight={focusHighlight}
                cardMinWidth={cardMinWidth}
                cardHeight={cardHeight}
                theme={overlay.theme}
                showTranslation={overlay.showTranslation}
                showVerseNumbers={overlay.showVerseNumbers}
                maxVerses={overlay.maxVerses}
                gridRef={gridRef}
                cardRefs={cardRefs}
                rowRefs={rowRefs}
                  onSelectCard={(index) => {
                    setActiveCardIndex(index);
                    setCueHighlight(true);
                    setFocusHighlight(true);
                    const location = locateFlatCard(rows, index);
                    if (cardsSource === "plan" && selectedPlanId && location) {
                      const itemId =
                        rows[location.rowIndex]?.planItemId ?? null;
                      persistPlanView(
                        selectedPlanId,
                        itemId,
                        location.cardIndex,
                        "live",
                      );
                    }
                    void handleSend(index);
                  }}
              />
            )}
          </div>
        </div>

        {showQueueDock && (
          <QueueDock
            cards={cards}
            activeCardIndex={activeCardIndex}
            cardZoom={cardZoom}
            navigating={navigating}
            selectedPlanId={selectedPlanId}
            addedAllToPlan={addedAllToPlan}
            plansCount={plans.length}
            cardsSource={cardsSource}
            queueLabel={
              cardsSource === "plan"
                ? (selectedPlan?.title ?? "Playlist")
                : (activeLocation
                    ? rows[activeLocation.rowIndex]?.reference
                    : cards[activeCardIndex]?.result.reference)
            }
            onCardZoomChange={setCardZoom}
            onPrevious={() => void loadAdjacentVerse("previous")}
            onNext={() => void loadAdjacentVerse("next")}
            onSendSelected={() => void handleSend(activeCardIndex)}
            onAddAll={() => void addAllResultsToPlaylist()}
            onClear={handleClearResults}
          />
        )}
      </div>
    </div>
  );
}
