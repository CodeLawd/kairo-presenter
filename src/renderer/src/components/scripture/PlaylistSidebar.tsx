import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Download,
  GripVertical,
  FileText,
  Loader,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from '@/icons';
import { exportKairo, importKairo } from "@/stores/useTransfer";
import { cn } from "@/lib/utils";
import { PICKED_ROW, listShortcuts, selectGesture, useMultiSelect } from "@/hooks/useMultiSelect";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SermonPlan, SermonScriptureItem } from "@shared/ipc";
import { LibrarySection } from "@/components/shared/LibrarySection";
import { startLibraryItemDrag, useLibrary } from "@/stores/useLibraries";
import { usePassagesStore, runPassagesCommand } from "@/stores/usePassages";
import { DEFAULT_LIBRARY_ID, itemsInLibrary, libraryCounts } from "@shared/libraries";
import { type SavedPassage } from "@shared/passages";

export interface PlaylistSidebarProps {
  width: number;
  plans: SermonPlan[];
  selectedPlanId: string | null;
  openPlanItems: SermonScriptureItem[];
  activeItemId: string | null;
  showItems: boolean;
  renamingPlanId: string | null;
  renameDraft: string;
  pendingDeletePlanId: string | null;
  creatingPlaylist: boolean;
  /** Extract a playlist from sermon notes (PDF, Word…). */
  onImportNotes: () => void;
  importingNotes: boolean;
  showAddTarget: boolean;
  /** How many verses the last search produced, for the Library row. */
  searchResultCount: number;
  /** True while the cards on screen come from search rather than a playlist. */
  viewingSearch: boolean;
  onSelectSearch: () => void;
  /** Opens a kept passage back onto the cards. */
  onOpenPassage: (passage: SavedPassage) => void;
  onCreate: () => void;
  onOpenPlan: (plan: SermonPlan) => void;
  onSelectItem: (itemId: string) => void;
  /** Remove several items from the open playlist (⌘A + Delete). */
  onRemoveItems?: (itemIds: string[]) => void;
  onStartRename: (plan: SermonPlan) => void;
  onCancelRename: () => void;
  onSaveRename: () => void;
  onRenameDraftChange: (value: string) => void;
  onRequestDelete: (planId: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (planId: string) => void;
  onSelectedPlanChange: (planId: string) => void;
  /** Reorders the open playlist. Omitted while a plan is not open. */
  onReorderItem?: (
    draggedId: string,
    targetId: string,
    position: "before" | "after",
  ) => void;
}

export function PlaylistSidebar({
  width,
  plans,
  selectedPlanId,
  openPlanItems,
  activeItemId,
  showItems,
  renamingPlanId,
  renameDraft,
  pendingDeletePlanId,
  creatingPlaylist,
  onImportNotes,
  importingNotes,
  showAddTarget,
  searchResultCount,
  viewingSearch,
  onSelectSearch,
  onOpenPassage,
  onCreate,
  onOpenPlan,
  onSelectItem,
  onRemoveItems,
  onStartRename,
  onCancelRename,
  onSaveRename,
  onRenameDraftChange,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onSelectedPlanChange,
  onReorderItem,
}: PlaylistSidebarProps): React.ReactElement {
  const [itemQuery, setItemQuery] = useState("");
  const passages = usePassagesStore((store) => store.passages);
  const passageLibrary = useLibrary("scripture");
  const [activeLibraryId, setActiveLibraryId] = useState<string>(DEFAULT_LIBRARY_ID);
  const visiblePassages = itemsInLibrary(passageLibrary, passages, activeLibraryId);
  const passageIds = useMemo(() => visiblePassages.map((passage) => passage.id), [visiblePassages]);
  const passageSelect = useMultiSelect<string>(passageIds);
  const removePickedPassages = (): void => {
    const ids = passageIds.filter((id) => passageSelect.selected.has(id));
    if (ids.length === 0) return;
    if (ids.length > 1 && !window.confirm(`Remove ${ids.length} saved passages?`)) return;
    void (async () => {
      for (const passageId of ids) await runPassagesCommand({ action: "remove", passageId });
      passageSelect.clear();
    })();
  };
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after">("before");

  // Filtering hides the neighbours a drop lands between, so reordering is only
  // offered on the full, unfiltered list.
  const canReorder = Boolean(onReorderItem) && itemQuery.trim() === "";

  const endDrag = (): void => {
    setDraggingItemId(null);
    setDragOverItemId(null);
  };

  useEffect(() => {
    setItemQuery("");
  }, [selectedPlanId]);

  const filteredItems = useMemo(() => {
    const needle = itemQuery.trim().toLowerCase();
    return openPlanItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => {
        if (!needle) return true;
        return (
          item.reference.toLowerCase().includes(needle) ||
          item.translation.toLowerCase().includes(needle)
        );
      });
  }, [itemQuery, openPlanItems]);

  // ── Multi-select: ⌘/Shift-click, ⌘A, Delete ─────────────────────────────
  const itemIds = useMemo(() => filteredItems.map(({ item }) => item.id), [filteredItems]);
  const itemSelect = useMultiSelect<string>(itemIds);
  const removePickedItems = (): void => {
    const ids = itemIds.filter((id) => itemSelect.selected.has(id));
    if (ids.length === 0 || !onRemoveItems) return;
    if (ids.length > 1 && !window.confirm(`Remove ${ids.length} items from this playlist?`)) return;
    onRemoveItems(ids);
    itemSelect.clear();
  };

  return (
    <aside
      data-playlist-sidebar=""
      className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden bg-surface-secondary"
      style={{ width }}
    >
      {/* Library first, playlists under it — the same two-section rail the
          Lyrics page uses, so "where does this list come from" reads the same
          on both pages. A library owns kept passages; a playlist orders them. */}
      <div className="shrink-0 px-1 py-1.5">
        <LibrarySection
          kind="scripture"
          // One thing lit at a time: while search results fill the page, the
          // library filter is not what is on screen.
          activeLibraryId={viewingSearch ? "" : activeLibraryId}
          counts={libraryCounts(passageLibrary, passages)}
          onSelect={setActiveLibraryId}
          extraRows={
            <button
              type="button"
              aria-current={viewingSearch}
              disabled={searchResultCount === 0}
              onClick={onSelectSearch}
              className={cn(
                "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40",
                viewingSearch
                  ? "row-selected"
                  : "text-zinc-400 hover:bg-surface-tertiary hover:text-zinc-200",
              )}
            >
              <Search size={13} className="shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Search results</span>
              <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">{searchResultCount}</span>
            </button>
          }
        />

        {visiblePassages.length > 0 && (
          <div
            className="mt-1.5 max-h-40 overflow-y-auto pt-1.5 outline-none"
            tabIndex={-1}
            onKeyDown={listShortcuts({
              selectAll: passageSelect.selectAll,
              remove: removePickedPassages,
              hasSelection: passageSelect.selected.size > 0,
            })}
          >
            {visiblePassages.map((passage) => (
              <div
                key={passage.id}
                draggable
                onDragStart={(event) => startLibraryItemDrag(event, passage.id, passage.reference, "scripture")}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                  passageSelect.isSelected(passage.id)
                    ? PICKED_ROW
                    : "text-zinc-400 hover:bg-surface-tertiary hover:text-zinc-200",
                )}
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left"
                  onClick={(event) => {
                    const gesture = selectGesture(event);
                    if (gesture) passageSelect.pick(passage.id, gesture);
                    else onOpenPassage(passage);
                  }}
                  title={`Open ${passage.reference}`}
                >
                  {passage.reference}
                  <span className="ml-1.5 text-[10px] uppercase text-zinc-600">{passage.translation}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${passage.reference} from saved passages`}
                  className="grid size-5 shrink-0 place-items-center rounded text-zinc-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
                  onClick={() => void runPassagesCommand({ action: "remove", passageId: passage.id })}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        {passageSelect.selected.size > 0 && (
          <PickedBar
            count={passageSelect.selected.size}
            noun="passage"
            onRemove={removePickedPassages}
            onClear={passageSelect.clear}
          />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-3 pb-1 pt-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
          Playlists
        </h2>
        {/* Both ways a playlist arrives: from sermon notes, or a shared .kairo file. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="ml-auto grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-surface-elevated hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              aria-label="Import"
              title="Import"
              disabled={importingNotes}
            >
              {importingNotes ? <Loader size={12} className="animate-spin" /> : <Download size={12} />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuItem onSelect={onImportNotes}>
              <FileText size={13} />
              Import sermon notes…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void importKairo()}>
              <Download size={13} />
              Import .kairo playlist…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-surface-elevated hover:text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          onClick={onCreate}
          disabled={creatingPlaylist}
          aria-label="New playlist"
          title="New playlist"
        >
          {creatingPlaylist ? <Loader size={13} className="animate-spin" /> : <Plus size={13} />}
        </button>
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ scrollbarGutter: "stable" }}
      >
        <div className="py-1">
          {plans.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-xs font-medium text-slate-400">No playlists yet</p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                Create a playlist, search for scripture, then choose Add to playlist.
              </p>
            </div>
          )}

          {plans.map((plan) => (
            <div
              key={plan.id}
              className={cn(
                "group/plan mx-1 rounded-md",
                selectedPlanId === plan.id ? "row-selected" : "hover:bg-surface-tertiary",
              )}
            >
              {renamingPlanId === plan.id ? (
                <div className="space-y-2 p-2">
                  <Input
                    autoFocus
                    className="h-8 text-sm"
                    value={renameDraft}
                    onChange={(event) => onRenameDraftChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        onSaveRename();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelRename();
                      }
                    }}
                    aria-label="Playlist name"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-surface-elevated px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-600"
                      onClick={onSaveRename}
                    >
                      <Check size={12} />
                      Save
                    </button>
                    <button
                      type="button"
                      className="rounded-md px-2 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-surface-tertiary hover:text-white"
                      onClick={onCancelRename}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : pendingDeletePlanId === plan.id ? (
                <div
                  className="flex items-center gap-1.5 p-2"
                  role="group"
                  aria-label={`Confirm deleting ${plan.title}`}
                >
                  <button
                    className="flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold text-slate-400 hover:bg-surface-tertiary hover:text-white"
                    onClick={onCancelDelete}
                  >
                    Cancel
                  </button>
                  <button
                    className="flex-1 rounded-md bg-tint-red px-2 py-1.5 text-[11px] font-semibold text-red-300 hover:bg-tint-red"
                    onClick={() => onConfirmDelete(plan.id)}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-0.5 pr-1">
                  <button
                    type="button"
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px]",
                      selectedPlanId === plan.id ? "text-white" : "text-slate-300",
                    )}
                    onClick={() => onOpenPlan(plan)}
                  >
                    <FileText
                      size={13}
                      className={cn("shrink-0", selectedPlanId === plan.id ? "text-white" : "text-slate-500")}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">{plan.title}</span>
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-500 group-hover/plan:hidden">
                      {plan.items.length}
                    </span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-surface-elevated hover:text-white group-hover/plan:flex data-[state=open]:flex"
                        aria-label={`Playlist options for ${plan.title}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      className="w-36"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <DropdownMenuGroup>
                        <DropdownMenuItem onSelect={() => onStartRename(plan)}>
                          <Pencil size={13} />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportKairo({ kind: 'playlist', planId: plan.id })}>
                          <Upload size={13} />
                          Export…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onRequestDelete(plan.id)}
                        >
                          <Trash2 size={13} />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          ))}
        </div>

        {showItems && (
          <div className="mt-2">
            <div className="flex items-center justify-between px-3 pb-1 pt-2">
              <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">Items</h3>
              <span className="text-[10px] tabular-nums text-zinc-500">
                {filteredItems.length === openPlanItems.length
                  ? openPlanItems.length
                  : `${filteredItems.length}/${openPlanItems.length}`}
              </span>
            </div>

            {openPlanItems.length > 8 && (
              <div className="px-2 pb-1.5">
                <label className="relative block">
                  <Search
                    size={12}
                    className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-500"
                    aria-hidden="true"
                  />
                  <Input
                    value={itemQuery}
                    onChange={(event) => setItemQuery(event.target.value)}
                    placeholder="Filter items…"
                    className="h-8 pl-7 text-xs"
                    aria-label="Filter playlist items"
                  />
                </label>
              </div>
            )}

            {openPlanItems.length === 0 ? (
              <div className="px-3 pb-4 pt-1 text-center">
                <BookOpen
                  size={14}
                  className="mx-auto text-slate-600"
                  aria-hidden="true"
                />
                <p className="mt-2 text-[11px] text-slate-500">
                  No scriptures yet. Search and add verses.
                </p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-3 pb-4 pt-1 text-center">
                <p className="text-[11px] text-slate-500">
                  No items match “{itemQuery.trim()}”
                </p>
              </div>
            ) : (
              <div
                className="px-1 pb-2 outline-none"
                tabIndex={-1}
                onKeyDown={listShortcuts({
                  selectAll: itemSelect.selectAll,
                  remove: removePickedItems,
                  hasSelection: itemSelect.selected.size > 0 && Boolean(onRemoveItems),
                })}
              >
                {filteredItems.map(({ item, index }) => (
                  <button
                    key={item.id}
                    type="button"
                    draggable={canReorder}
                    className={cn(
                      "group relative flex w-full items-center gap-1 rounded-md px-1.5 py-1.5 text-left",
                      !item.available && "opacity-55",
                      itemSelect.isSelected(item.id)
                        ? PICKED_ROW
                        : activeItemId === item.id
                          ? "row-selected"
                          : "text-slate-300 hover:bg-surface-tertiary",
                      draggingItemId === item.id && "opacity-40",
                      dragOverItemId === item.id &&
                        (dropPosition === "before"
                          ? "before:absolute before:inset-x-2 before:top-0 before:h-px before:bg-teal-400"
                          : "after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-teal-400"),
                    )}
                    onClick={(event) => {
                      const gesture = selectGesture(event);
                      if (gesture) itemSelect.pick(item.id, gesture);
                      else onSelectItem(item.id);
                    }}
                    aria-current={activeItemId === item.id ? "true" : undefined}
                    title={item.error ?? (canReorder && openPlanItems.length > 1 ? "Drag to reorder" : undefined)}
                    onDragStart={(event) => {
                      if (!canReorder) return;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                      setDraggingItemId(item.id);
                    }}
                    onDragOver={(event) => {
                      if (!canReorder || !draggingItemId) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      const bounds = event.currentTarget.getBoundingClientRect();
                      setDropPosition(
                        event.clientY < bounds.top + bounds.height / 2
                          ? "before"
                          : "after",
                      );
                      setDragOverItemId(item.id);
                    }}
                    onDragLeave={() => {
                      setDragOverItemId((current) =>
                        current === item.id ? null : current,
                      );
                    }}
                    onDrop={(event) => {
                      if (!canReorder) return;
                      event.preventDefault();
                      const draggedId =
                        event.dataTransfer.getData("text/plain") || draggingItemId;
                      if (draggedId && draggedId !== item.id) {
                        onReorderItem?.(draggedId, item.id, dropPosition);
                      }
                      endDrag();
                    }}
                    onDragEnd={endDrag}
                  >
                    <GripVertical
                      size={12}
                      aria-hidden="true"
                      className={cn(
                        "shrink-0 text-slate-600 transition-opacity",
                        canReorder
                          ? "cursor-grab opacity-0 group-hover:opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="w-4 shrink-0 text-[10px] tabular-nums text-zinc-500">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {item.reference}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[10px] uppercase",
                        item.available ? "text-zinc-500" : "text-zinc-600 line-through",
                      )}
                    >
                      {item.translation}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {itemSelect.selected.size > 0 && onRemoveItems && (
              <PickedBar
                count={itemSelect.selected.size}
                noun="item"
                onRemove={removePickedItems}
                onClear={itemSelect.clear}
              />
            )}
          </div>
        )}
      </div>

      {showAddTarget && plans.length > 0 && (
        <div className="shrink-0 px-3 py-3">
          <label className="flex flex-col gap-1.5 text-[11px] text-slate-500">
            Add searched verses to
            <select
              className="input w-full py-1.5 text-xs"
              value={selectedPlanId ?? ""}
              onChange={(event) => onSelectedPlanChange(event.target.value)}
              aria-label="Saved playlist for searched scriptures"
            >
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </aside>
  );
}

/** Compact bar under a sidebar list while rows are picked. */
function PickedBar({
  count,
  noun,
  onRemove,
  onClear,
}: {
  count: number;
  noun: string;
  onRemove: () => void;
  onClear: () => void;
}): React.ReactElement {
  return (
    <div className="mx-2 my-1.5 flex items-center gap-2 rounded-lg bg-surface-elevated px-2.5 py-1.5 text-[11px]">
      <span className="min-w-0 flex-1 truncate text-zinc-300">
        {count} {noun}{count === 1 ? "" : "s"} selected
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="rounded px-1.5 py-0.5 font-medium text-rose-300 hover:bg-tint-rose"
        title="Remove (Delete)"
      >
        Remove
      </button>
      <button type="button" onClick={onClear} className="rounded px-1.5 py-0.5 text-zinc-400 hover:bg-surface-tertiary hover:text-white" title="Clear (Esc)">
        Clear
      </button>
    </div>
  );
}
