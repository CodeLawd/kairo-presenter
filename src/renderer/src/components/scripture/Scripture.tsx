import { useImportRequest } from '@/hooks/useImportRequest'
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AlertCircle, BookOpen, Loader, Plus, Settings as SettingsIcon, Upload } from '@/icons';
import { useMultiSelect } from "@/hooks/useMultiSelect";
import { SelectionAction, SelectionBar } from "@/components/shared/SelectionBar";
import { useTransferStore } from "@/stores/useTransfer";
import { DEFAULT_LIBRARY_ID } from "@shared/libraries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/stores/useAppStore";
import {
  appendScriptureResultsToPlan,
  extendSermonPlanItemWithAdjacent,
  reorderSermonPlanItem,
} from "@shared/ipc";
import type {
  ScriptureResult,
  ScriptureSuggestion,
  ScriptureTranslation,
  ScriptureTranslationOption,
  SermonPlan,
  SermonNotesAnalysis,
  SermonPlanDraft,
  SermonScriptureItem,
} from "@shared/ipc";
import {
  combineScriptureResults,
  expandScriptureResult,
  getAdjacentVerseQueries,
  getBookCompletion,
  getBookCompletions,
  normalizeScriptureQuery,
  reloadPassagesInTranslation,
  resolveSubmittedScriptureQuery,
  shouldLiveSuggestScriptureQuery,
} from "@shared/scripture-query";
import { PlaylistSidebar } from "./PlaylistSidebar";
import { passageToResult } from "@shared/passages";
import { runPassagesCommand } from "@/stores/usePassages";
import { QueueDock } from "./QueueDock";
import { ScriptureSearchBar } from "./ScriptureSearchBar";
import { SermonNotesReviewModal } from "./SermonNotesReviewModal";
import { LiveOutputRail } from "@/components/operator/LiveOutputRail";
import { BoothWorkspace } from "@/components/layout/BoothWorkspace";
import { useLiveRailWidth } from "@/components/operator/useLiveRailWidth";
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
import { liveOverlayTheme } from "@shared/overlay-outputs";
import { pushScriptureFromTab } from "@shared/scripture-tab-presentation";
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
  const liveRail = useLiveRailWidth();
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  /**
   * The last search's rows, kept while a playlist is open.
   *
   * `rows` is shared by both sources, so opening a playlist overwrites the
   * search; without this the Library row could show what it found but never
   * take the operator back to it.
   */
  const [searchRows, setSearchRows] = useState<ResultRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Startup data comes from the shared bootstrap snapshot, so switching tabs
  // never shows an empty state while a first-mount IPC read resolves.
  const bootstrapSettings = useBootstrapStore((s) => s.settings);
  const bootstrapTranslations = useBootstrapStore((s) => s.translations);
  const bootstrapPlans = useBootstrapStore((s) => s.sermonPlans);
  const livePlan = useBootstrapStore((s) => s.livePlan);
  const apiBibleAuth = useBootstrapStore((s) => s.apiBibleAuth);
  const bootstrapPhase = useBootstrapStore((s) => s.phase);

  const [translation, setTranslation] = useState<ScriptureTranslation>(
    bootstrapSettings.scripture.defaultTranslation,
  );
  const [translations, setTranslations] =
    useState<ScriptureTranslationOption[]>(bootstrapTranslations);
  const [plans, setPlans] = useState<SermonPlan[]>(bootstrapPlans);
  // Playlists can land while this page is mounted (a .kairo import). Pick up
  // new ones and newer copies without discarding edits held here.
  useEffect(() => {
    setPlans((previous) => {
      const held = new Map(previous.map((plan) => [plan.id, plan]));
      const added = bootstrapPlans.filter((plan) => !held.has(plan.id));
      const fresher = new Map(
        bootstrapPlans
          .filter((plan) => {
            const current = held.get(plan.id);
            return current !== undefined && plan.updatedAt > current.updatedAt;
          })
          .map((plan) => [plan.id, plan]),
      );
      if (added.length === 0 && fresher.size === 0) return previous;
      return [...added, ...previous.map((plan) => fresher.get(plan.id) ?? plan)];
    });
  }, [bootstrapPlans]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [cardsSource, setCardsSource] = useState<"search" | "plan" | null>(null);
  const [pendingDeletePlanId, setPendingDeletePlanId] = useState<string | null>(null);
  const [renamingPlanId, setRenamingPlanId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importDraft, setImportDraft] = useState<SermonPlanDraft | null>(null);
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
  const [plansReady] = useState(true);

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
  const suppressSuggestionsQueryRef = useRef<string | null>(null);
  const translationRef = useRef(translation);
  const translationReloadRef = useRef(0);
  translationRef.current = translation;
  const gridRef = useRef<HTMLDivElement>(null);
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  const bookCompletion = getBookCompletion(query);
  const bookCompletions = getBookCompletions(query);
  const cardMinWidth = Math.round(CARD_BASE_WIDTH * (cardZoom / 100));
  const cardHeight = Math.round(CARD_BASE_HEIGHT * (cardZoom / 100));
  const cards = flattenResultRows(rows);
  // Picked cards for bulk actions. A new passage or playlist starts clean.
  const cardOrder = useMemo(() => cards.map((_card, index) => index), [cards.length]);
  const cardSelect = useMultiSelect<number>(cardOrder);
  const clearCardSelection = cardSelect.clear;
  // Keyed on which passages are loaded, not on `rows` itself: rows also change
  // when a card's send status updates, and going live must not drop a selection.
  const loadedPassages = rows.map((row) => `${row.id}:${row.cards.length}`).join("|");
  useEffect(() => { clearCardSelection(); }, [loadedPassages, clearCardSelection]);
  const selectedPlan = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const showQueueDock = rows.length > 0;
  const showVerseGrid = rows.length > 0;
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
    // Only react to the clear token (no exhaustive-deps plugin configured).
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
    if (
      suppressSuggestionsQueryRef.current === query.trim() ||
      !shouldLiveSuggestScriptureQuery(query)
    ) {
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
      suppressSuggestionsQueryRef.current = q;
      suggestionRequestRef.current += 1;
      setSuggestionsOpen(false);
      setSearchSuggestions([]);
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
        const targetTranslation = translationRef.current;
        if (targetTranslation !== translation && results.length > 0) {
          const reloaded = await reloadPassagesInTranslation(
            results,
            targetTranslation,
            (lookupQuery, lookupTranslation) =>
              window.api.scripture.search(lookupQuery, lookupTranslation),
          );
          results = reloaded.results;
        }
        const searchResultRows = results.map((result, index) =>
          createResultRow(result, { id: `search-${index}-${result.reference}` }),
        );
        setRows(searchResultRows);
        setSearchRows(searchResultRows);
        setCardsSource("search");
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
    suppressSuggestionsQueryRef.current = result.reference;
    suggestionRequestRef.current += 1;
    setQuery(result.reference);
    const previewRows = [createResultRow(result, { id: `suggest-${result.reference}` })];
    setRows(previewRows);
    setSearchRows(previewRows);
    setCardsSource("search");
    setError(null);
    setSuggestionsOpen(false);
    setSearchSuggestions([]);
    setAddedAllToPlan(null);
    setActiveCardIndex(0);
  }, []);

  const handleTranslationChange = useCallback(
    async (next: ScriptureTranslation): Promise<void> => {
      translationRef.current = next;
      setTranslation(next);
      await window.api.scripture.setTranslation(next);
      const store = useBootstrapStore.getState();
      store.patchSettings('scripture', {
        ...store.settings.scripture,
        defaultTranslation: next,
      });

      // Playlist items keep the translation they were saved with.
      if (cardsSource !== "search" || rows.length === 0) return;
      if (
        rows.every((row) =>
          row.cards.every((card) => card.result.translation === next),
        )
      ) {
        return;
      }

      const requestId = ++translationReloadRef.current;
      const activeLocation = locateFlatCard(rows, activeCardIndex);
      const activeReference = activeLocation
        ? rows[activeLocation.rowIndex]?.cards[activeLocation.cardIndex]?.result
            .reference
        : null;
      const passages = rows
        .map((row) =>
          combineScriptureResults(row.cards.map((card) => card.result)),
        )
        .filter((result): result is ScriptureResult => result !== null);

      setLoading(true);
      setError(null);
      try {
        const { results, unavailable } = await reloadPassagesInTranslation(
          passages,
          next,
          (lookupQuery, lookupTranslation) =>
            window.api.scripture.search(lookupQuery, lookupTranslation),
        );
        if (requestId !== translationReloadRef.current) return;

        const updated = results.map((result, index) =>
          createResultRow(result, {
            id: rows[index]?.id ?? `search-${index}-${result.reference}`,
          }),
        );
        setRows(updated);

        if (activeReference) {
          const nextIndex = findFlatCardIndex(
            updated,
            (card) => card.result.reference === activeReference,
          );
          setActiveCardIndex(
            nextIndex >= 0
              ? nextIndex
              : Math.min(
                  activeCardIndex,
                  Math.max(0, flattenResultRows(updated).length - 1),
                ),
          );
        }

        if (unavailable.length > 0) {
          setError(
            `${next} text unavailable for ${unavailable.join(", ")}. Those verses still show the previous translation.`,
          );
        } else {
          const fallback = results.find((result) => result.translation !== next);
          if (fallback) {
            setError(
              `${next} text unavailable — showing ${fallback.translation}. Change translation in the dropdown when the Bible is available.`,
            );
          }
        }
      } catch (err) {
        if (requestId !== translationReloadRef.current) return;
        const notice = getScriptureCacheNotice(err);
        setError(
          notice
            ? `${notice.message} ${notice.hint}`
            : (err as Error).message ||
              "Could not reload the loaded verses in the new translation.",
        );
      } finally {
        if (requestId === translationReloadRef.current) setLoading(false);
      }
    },
    [activeCardIndex, cardsSource, rows],
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

    // Every playlist item is a row — including multi-verse ranges
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
      setImportDraft(draft);
    } catch (importError) {
      setError(
        (importError as Error).message || "Could not import sermon notes.",
      );
    } finally {
      setImporting(false);
    }
  }, []);

  useImportRequest(['sermon'], handleImport, !importing && !importDraft);

  const confirmImport = useCallback(async (
    title: string,
    _text: string,
    analysis: SermonNotesAnalysis,
  ): Promise<void> => {
    if (!importDraft) return;
    setImporting(true);
    setError(null);
    try {
      const resolvedItems = await resolveSermonPlanItems(
        analysis.items.map((item) => ({
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
        title,
        sourceFileName: importDraft.sourceFileName,
        sourceText: _text,
        items: resolvedItems,
        createdAt: now,
        updatedAt: now,
      });
      setPlans((previous) => [plan, ...previous]);
      useBootstrapStore.getState().setSermonPlans([plan, ...plans.filter((item) => item.id !== plan.id)]);
      setImportDraft(null);
      await openPlan(plan);
    } catch (importError) {
      setError(
        (importError as Error).message || "Could not import sermon notes.",
      );
    } finally {
      setImporting(false);
    }
  }, [importDraft, openPlan, plans, translation, translations]);

  const useSelectedPlanForService = useCallback(async (): Promise<void> => {
    if (!selectedPlan) return;
    setError(null);
    try {
      const state = await window.api.scripture.setLivePlan(selectedPlan.id);
      useBootstrapStore.getState().setLivePlan(state);
    } catch (selectionError) {
      setError((selectionError as Error).message || "Could not select this playlist for the service.");
    }
  }, [selectedPlan]);

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
      if (cardsSource === "plan" && selectedPlanId === planId) {
        setRows([]);
        setCardsSource(null);
      }
      if (scriptureActivePlanId === planId) clearScriptureViewState();
    },
    [cardsSource, clearScriptureViewState, renamingPlanId, scriptureActivePlanId, selectedPlanId],
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
    cancelRenamePlan();

    try {
      const saved = await window.api.scripture.saveSermonPlan(optimistic);
      setPlans((previous) =>
        previous.map((plan) => (plan.id === saved.id ? saved : plan)),
      );
    } catch (saveError) {
      setPlans((previous) =>
        previous.map((plan) => (plan.id === target.id ? target : plan)),
      );
      setError((saveError as Error).message || "Could not rename that playlist.");
    }
  }, [cancelRenamePlan, plans, renameDraft, renamingPlanId]);

  const createPlaylist = useCallback(async (includeLoaded = false): Promise<void> => {
    if (creatingPlaylist) return;
    setCreatingPlaylist(true);
    setError(null);
    try {
      const now = Date.now();
      const emptyPlan: SermonPlan = {
        id: `sermon-${now}`,
        title: "Untitled playlist",
        sourceFileName: "Manual",
        items: [],
        createdAt: now,
        updatedAt: now,
      };
      const loaded = rows.map(row => combineScriptureResults(row.cards.map(card => card.result)))
        .filter((result): result is ScriptureResult => result !== null && result.verses.length > 0);
      const plan = await window.api.scripture.saveSermonPlan(
        includeLoaded ? appendScriptureResultsToPlan(emptyPlan, loaded, `manual-${now}`) : emptyPlan,
      );
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
      setAddedAllToPlan(includeLoaded ? plan.title : null);
      if (cardsSource !== "search") {
        setRows([]);
        setCardsSource("plan");
      }
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
  }, [creatingPlaylist, cardsSource, rows, setScriptureViewState]);

  /** Picked cards as passages: one per row, keeping multi-verse runs together. */
  const pickedResults = useCallback((): ScriptureResult[] => {
    const results: ScriptureResult[] = [];
    let flat = 0;
    for (const row of rows) {
      const picked = row.cards.filter((_card, index) => cardSelect.selected.has(flat + index));
      flat += row.cards.length;
      const combined = combineScriptureResults(picked.map((card) => card.result));
      if (combined && combined.verses.length > 0) results.push(combined);
    }
    return results;
  }, [rows, cardSelect.selected]);

  const addPickedToPlaylist = useCallback(async (targetId: string): Promise<void> => {
    const target = plans.find((plan) => plan.id === targetId);
    const results = pickedResults();
    if (!target || results.length === 0) return;
    try {
      const saved = await window.api.scripture.saveSermonPlan(
        appendScriptureResultsToPlan(target, results, `manual-${Date.now()}`),
      );
      setPlans((previous) => previous.map((plan) => (plan.id === saved.id ? saved : plan)));
      cardSelect.clear();
      useTransferStore.getState().notify({
        tone: "ok",
        text: `Added ${results.length} passage${results.length === 1 ? "" : "s"} to ${saved.title}`,
      });
    } catch (saveError) {
      setError((saveError as Error).message || "Could not add those verses to the playlist.");
    }
  }, [cardSelect, pickedResults, plans]);

  const savePickedToLibrary = useCallback(async (): Promise<void> => {
    const results = pickedResults();
    if (results.length === 0) return;
    for (const result of results) {
      await runPassagesCommand({ action: "save", result, libraryId: DEFAULT_LIBRARY_ID });
    }
    cardSelect.clear();
    useTransferStore.getState().notify({
      tone: "ok",
      text: `Saved ${results.length} passage${results.length === 1 ? "" : "s"} to your library`,
    });
  }, [cardSelect, pickedResults]);

  const addAllResultsToPlaylist = useCallback(async (targetId: string): Promise<void> => {
    const target = plans.find((plan) => plan.id === targetId);
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

  /** Removes several items from the open playlist (sidebar ⌘A + Delete). */
  const removePlanItems = useCallback(async (itemIds: string[]): Promise<void> => {
    const plan = plans.find((candidate) => candidate.id === selectedPlanId);
    if (!plan || itemIds.length === 0) return;
    const drop = new Set(itemIds);
    try {
      const saved = await window.api.scripture.saveSermonPlan({
        ...plan,
        items: plan.items.filter((item) => !drop.has(item.id)),
      });
      setPlans((previous) => previous.map((candidate) => (candidate.id === saved.id ? saved : candidate)));
      setRows((previous) => previous.filter((row) => !row.planItemId || !drop.has(row.planItemId)));
      setActiveCardIndex(0);
    } catch (removeError) {
      setError((removeError as Error).message || "Could not remove those items.");
    }
  }, [plans, selectedPlanId]);

  /** Reorders the open playlist from the sidebar, rows and all. */
  const reorderPlanItem = useCallback(
    async (
      draggedId: string,
      targetId: string,
      position: "before" | "after",
    ): Promise<void> => {
      if (draggedId === targetId || cardsSource !== "plan") return;
      const openPlanRecord = plans.find((plan) => plan.id === selectedPlanId);
      if (!openPlanRecord) return;

      const optimistic = reorderSermonPlanItem(
        openPlanRecord,
        draggedId,
        targetId,
        position,
      );
      if (optimistic === openPlanRecord) return;

      // Rows mirror plan items, so re-sort what is already on screen rather
      // than re-resolving every passage through the Bible API.
      const orderedRows = (current: ResultRow[]): ResultRow[] => {
        const byItemId = new Map(
          current.map((row) => [row.planItemId ?? row.id, row] as const),
        );
        const next = optimistic.items
          .map((item) => byItemId.get(item.id))
          .filter((row): row is ResultRow => row !== undefined);
        return next.length === current.length ? next : current;
      };

      setPlans((previous) =>
        previous.map((plan) => (plan.id === optimistic.id ? optimistic : plan)),
      );
      setRows(orderedRows);

      try {
        const saved = await window.api.scripture.saveSermonPlan(optimistic);
        setPlans((previous) =>
          previous.map((plan) => (plan.id === saved.id ? saved : plan)),
        );
      } catch (saveError) {
        setPlans((previous) =>
          previous.map((plan) =>
            plan.id === openPlanRecord.id ? openPlanRecord : plan,
          ),
        );
        setRows((current) => {
          const byItemId = new Map(
            current.map((row) => [row.planItemId ?? row.id, row] as const),
          );
          const reverted = openPlanRecord.items
            .map((item) => byItemId.get(item.id))
            .filter((row): row is ResultRow => row !== undefined);
          return reverted.length === current.length ? reverted : current;
        });
        setError(
          (saveError as Error).message ||
            "Could not save the new passage order.",
        );
      }
    },
    [cardsSource, plans, selectedPlanId],
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
        suppressSuggestionsQueryRef.current = submittedQuery;
        suggestionRequestRef.current += 1;
        setSuggestionsOpen(false);
        setSearchSuggestions([]);
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

      const queries = getAdjacentVerseQueries([anchorCard.result], direction);
      if (queries.length === 0) return;

      setNavigating(direction);
      setError(null);
      try {
        let adjacent: ScriptureResult | undefined;
        const lookupTranslation =
          (anchorCard.result.translation as ScriptureTranslation) || translation;

        const resolveAdjacent = async (
          tx: ScriptureTranslation,
        ): Promise<ScriptureResult | undefined> => {
          for (const adjacentQuery of queries) {
            const [result] = await window.api.scripture.search(
              adjacentQuery,
              tx,
            );
            if (!result || result.verses.length === 0) continue;
            // Chapter-range fallback (prev at v1): keep only the last verse.
            if (result.verses.length > 1 && direction === "previous") {
              const last = result.verses.at(-1)!;
              return {
                reference: `${last.book} ${last.chapter}:${last.verse}`,
                translation: result.translation,
                verses: [last],
              };
            }
            const expanded = expandScriptureResult(result);
            return direction === "previous"
              ? expanded.at(-1)
              : expanded[0];
          }
          return undefined;
        };

        adjacent = await resolveAdjacent(lookupTranslation);
        if (!adjacent && lookupTranslation !== translation) {
          adjacent = await resolveAdjacent(translation);
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
          const existingLocation = locateFlatCard(rows, existingIndex);
          if (cardsSource === "plan" && selectedPlanId && existingLocation) {
            persistPlanView(
              selectedPlanId,
              rows[existingLocation.rowIndex]?.planItemId ?? null,
              existingLocation.cardIndex,
              "live",
            );
          }
          cardRefs.current[existingIndex]?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          });
          return;
        }

        const planItemId = activeRow.planItemId;
        if (cardsSource === "plan" && selectedPlanId && planItemId) {
          const target = plans.find((plan) => plan.id === selectedPlanId);
          if (target) {
            const updated = extendSermonPlanItemWithAdjacent(
              target,
              planItemId,
              adjacent,
              direction,
            );
            const saved = await window.api.scripture.saveSermonPlan(updated);
            setPlans((previous) =>
              previous.map((plan) => (plan.id === saved.id ? saved : plan)),
            );
          }
        }

        const newCard = {
          result: adjacent,
          sendStatus: "idle" as const,
          planItemId,
        };
        const insertCardAt =
          direction === "next" ? activeRow.cards.length : 0;
        const updatedRows = rows.map((row, idx) => {
          if (idx !== location.rowIndex) return row;
          const nextCards =
            direction === "next"
              ? [...row.cards, newCard]
              : [newCard, ...row.cards];
          const combined = combineScriptureResults(
            nextCards.map((card) => card.result),
          );
          return {
            ...row,
            reference: combined?.reference ?? row.reference,
            cards: nextCards,
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
        if (cardsSource === "plan" && selectedPlanId) {
          persistPlanView(
            selectedPlanId,
            planItemId ?? null,
            insertCardAt,
            "live",
          );
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
        await pushScriptureFromTab(window.api.scripture, suggestion);
        const store = useAppStore.getState();
        store.markLiveOutput(card.result.reference);
        store.setLiveOutputPreview({
          kind: "scripture",
          reference: card.result.reference,
          text: card.result.verses.map((verse) => verse.text).join(" "),
          verses: card.result.verses,
          translation: card.result.translation,
        });
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
    if (cards.length === 0) return;

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
    <>
    <BoothWorkspace
      rail={
        <LiveOutputRail
          width={liveRail.width}
          onResizeStart={liveRail.onResizeStart}
          onResizeKeyDown={liveRail.onResizeKeyDown}
        />
      }
    >
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden bg-surface">
      <PlaylistSidebar
        plans={plans}
        selectedPlanId={selectedPlanId}
        openPlanItems={openPlanItems}
        activeItemId={activeItemId}
        showItems={cardsSource === "plan"}
        searchResultCount={searchRows.length}
        viewingSearch={cardsSource === "search"}
        onSelectSearch={() => { setRows(searchRows); setCardsSource("search") }}
        onOpenPassage={(passage) => previewSuggestion(passageToResult(passage))}
        renamingPlanId={renamingPlanId}
        renameDraft={renameDraft}
        pendingDeletePlanId={pendingDeletePlanId}
        creatingPlaylist={creatingPlaylist}
        showAddTarget={false}
        onCreate={() => void createPlaylist()}
        onOpenPlan={(plan) => void openPlan(plan)}
        onSelectItem={selectPlanItem}
        onRemoveItems={cardsSource === "plan" ? (ids) => void removePlanItems(ids) : undefined}
        onStartRename={startRenamePlan}
        onCancelRename={cancelRenamePlan}
        onSaveRename={() => void saveRenamePlan()}
        onRenameDraftChange={setRenameDraft}
        onRequestDelete={setPendingDeletePlanId}
        onCancelDelete={() => setPendingDeletePlanId(null)}
        onConfirmDelete={(planId) => void deletePlan(planId)}
        onReorderItem={(draggedId, targetId, position) =>
          void reorderPlanItem(draggedId, targetId, position)
        }
        onSelectedPlanChange={(planId) => {
          setSelectedPlanId(planId);
          setAddedAllToPlan(null);
        }}
      />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="shrink-0 space-y-2 border-b border-surface-border bg-surface px-3 py-2">
          <div className="flex items-start justify-between gap-4">
            <h1 className="self-center text-xs font-medium text-slate-400">Scripture</h1>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {selectedPlan && (
                <Button
                  variant={livePlan?.planId === selectedPlan.id ? "secondary" : "default"}
                  onClick={() => void useSelectedPlanForService()}
                  disabled={livePlan?.planId === selectedPlan.id}
                  title="Use this playlist to guide live scripture detection"
                >
                  <BookOpen data-icon="inline-start" />
                  {livePlan?.planId === selectedPlan.id ? "In use for this service" : "Use for this service"}
                </Button>
              )}
              <Button variant="outline" onClick={() => void handleImport()} disabled={importing}>
                {importing ? (
                  <Loader data-icon="inline-start" className="animate-spin" />
                ) : (
                  <Upload data-icon="inline-start" />
                )}
                {importing ? "Extracting…" : "Import sermon notes"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => useAppStore.getState().openSettings("scripture")}
                aria-label="Scripture settings"
                title="Scripture settings — translations, Bible downloads, auto-detection"
              >
                <SettingsIcon />
              </Button>
            </div>
          </div>

          <ScriptureSearchBar
            query={query}
            translation={translation}
            translations={translations}
            loading={loading}
            bookCompletion={bookCompletion}
            bookCompletions={bookCompletions}
            searchSuggestions={searchSuggestions}
            suggestionsOpen={suggestionsOpen}
            activeSuggestion={activeSuggestion}
            inputRef={inputRef}
            onQueryChange={(value) => {
              if (value !== query) suppressSuggestionsQueryRef.current = null;
              setQuery(value);
              if (shouldLiveSuggestScriptureQuery(value)) setSuggestionsOpen(true);
            }}
            onTranslationChange={(value) => void handleTranslationChange(value)}
            onSearch={() => void handleSearch()}
            onClearQuery={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            onBookCompletionSelect={(value) => {
              const submitted = resolveSubmittedScriptureQuery(value);
              setQuery(submitted);
              void handleSearch(submitted);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (suppressSuggestionsQueryRef.current === query.trim()) return;
              if (searchSuggestions.length > 0) setSuggestionsOpen(true);
            }}
            onActiveSuggestionChange={setActiveSuggestion}
            onPreviewSuggestion={previewSuggestion}
          />

          {shouldShowApiBibleWarning(
            apiBibleAuth,
            Boolean(bootstrapSettings.secretsConfigured.bible),
            bootstrapPhase === 'ready' || bootstrapPhase === 'ready-with-warnings',
          ) &&
            translation &&
            !translations.find((item) => item.id === translation)?.available && (
              <div className="flex gap-2 rounded-lg border border-yellow-500/25 bg-yellow-500/5 px-3.5 py-3 text-xs text-yellow-400">
                <AlertCircle size={14} className="shrink-0" />
                {translations.find((item) => item.id === translation)?.downloadable
                  ? `${translation} is the default but isn't installed yet. Download it in Settings → Scripture, or add an API.Bible key authorized for ${translation} in Settings → API Keys.`
                  : `${translation} is the default, but its text requires an API.Bible key authorized for ${translation}. Add the key in Settings → API Keys.`}
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
            {rows.length === 0 && !loading && !error && (
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
                  verse{cards.length !== 1 ? "s" : ""}
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
                theme={liveOverlayTheme(overlay)}
                showTranslation={overlay.showTranslation}
                showVerseNumbers={overlay.showVerseNumbers}
                maxVerses={overlay.maxVerses}
                gridRef={gridRef}
                cardRefs={cardRefs}
                rowRefs={rowRefs}
                pickedCards={cardSelect.selected}
                onPickCard={cardSelect.pick}
                onMarqueeBegin={cardSelect.beginMarquee}
                onMarqueeChange={cardSelect.updateMarquee}
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
            {cardSelect.selected.size > 0 && (
              <SelectionBar
                className="sticky bottom-3 mt-4"
                count={cardSelect.selected.size}
                noun="verse"
                onClear={cardSelect.clear}
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md bg-white/[0.08] px-2.5 text-[12px] font-medium text-white hover:bg-white/[0.13]">
                      <Plus size={12} /> Add to playlist
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
                    {plans.length === 0 && (
                      <DropdownMenuItem disabled>No playlists yet</DropdownMenuItem>
                    )}
                    {plans.map((plan) => (
                      <DropdownMenuItem key={plan.id} onSelect={() => void addPickedToPlaylist(plan.id)}>
                        <span className="truncate">{plan.title}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <SelectionAction onClick={() => void savePickedToLibrary()}>
                  <BookOpen size={12} /> Save to library
                </SelectionAction>
              </SelectionBar>
            )}
          </div>
        </div>

        {showQueueDock && (
          <QueueDock
            cards={cards}
            activeCardIndex={activeCardIndex}
            cardZoom={cardZoom}
            navigating={navigating}
            addedAllToPlan={addedAllToPlan}
            plans={plans}
            creatingPlaylist={creatingPlaylist}
            onCreatePlaylist={() => void createPlaylist(true)}
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
            onAddAll={(planId) => void addAllResultsToPlaylist(planId)}
            onSaveToLibrary={(libraryId) => {
              const result = cards[activeCardIndex]?.result;
              if (!result) return;
              void runPassagesCommand({ action: "save", result, libraryId });
            }}
            onClear={handleClearResults}
          />
        )}
      </div>
    </div>
    </BoothWorkspace>

      {importDraft && (
        <SermonNotesReviewModal
          draft={importDraft}
          confirming={importing}
          onCancel={() => setImportDraft(null)}
          onConfirm={(title, text, analysis) => void confirmImport(title, text, analysis)}
        />
      )}
    </>
  );
}
