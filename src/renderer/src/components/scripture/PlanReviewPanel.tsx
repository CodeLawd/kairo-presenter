import { GripVertical, Loader } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SermonPlan } from "@shared/ipc";

export interface PlanReviewPanelProps {
  activePlan: SermonPlan;
  draggingItemId: string | null;
  dragOverItemId: string | null;
  dropPosition: "before" | "after";
  savingReview: boolean;
  onFinishReview: () => void;
  onDraggingItemIdChange: (id: string | null) => void;
  onDragOverItemIdChange: (id: string | null) => void;
  onDropPositionChange: (position: "before" | "after") => void;
  onReorder: (
    draggedId: string,
    targetId: string,
    position: "before" | "after",
  ) => void;
}

export function PlanReviewPanel({
  activePlan,
  draggingItemId,
  dragOverItemId,
  dropPosition,
  savingReview,
  onFinishReview,
  onDraggingItemIdChange,
  onDragOverItemIdChange,
  onDropPositionChange,
  onReorder,
}: PlanReviewPanelProps): React.ReactElement {
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-white">{activePlan.title}</h2>
          <p className="text-xs text-slate-500">
            Drag from the handle to reorder, then finish reviewing
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {activePlan.items.filter((item) => item.available).length}/
            {activePlan.items.length} ready
          </span>
          <button
            className="btn-secondary flex items-center gap-1.5 px-3 py-2 text-xs"
            onClick={onFinishReview}
            disabled={savingReview}
          >
            {savingReview && (
              <Loader size={12} className="animate-spin" aria-hidden="true" />
            )}
            {savingReview ? "Saving…" : "Done reviewing"}
          </button>
        </div>
      </div>
      <div className="divide-y divide-surface-border/60 overflow-hidden rounded-lg border border-surface-border/60">
        {activePlan.items.map((item, index) => (
          <div
            key={item.id}
            className={cn(
              "relative flex items-center gap-3 bg-surface-secondary/30 px-3 py-2.5 transition-all duration-150",
              draggingItemId &&
                draggingItemId !== item.id &&
                dragOverItemId === item.id &&
                "bg-teal-500/[0.06]",
              draggingItemId === item.id && "opacity-40",
            )}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              onDragOverItemIdChange(item.id);
              onDropPositionChange(
                event.clientY < bounds.top + bounds.height / 2
                  ? "before"
                  : "after",
              );
            }}
            onDrop={(event) => {
              event.preventDefault();
              const draggedId =
                event.dataTransfer.getData("text/plain") || draggingItemId;
              if (draggedId) onReorder(draggedId, item.id, dropPosition);
              onDraggingItemIdChange(null);
              onDragOverItemIdChange(null);
            }}
          >
            {draggingItemId &&
              draggingItemId !== item.id &&
              dragOverItemId === item.id && (
                <>
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.55)]",
                      dropPosition === "before" ? "-top-px" : "-bottom-px",
                    )}
                  />
                  <span className="sr-only">
                    {dropPosition === "before"
                      ? "Drop before this verse"
                      : "Drop after this verse"}
                  </span>
                </>
              )}
            <button
              type="button"
              className="-ml-1 flex h-7 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-slate-500 hover:bg-surface-tertiary hover:text-slate-300 active:cursor-grabbing"
              draggable
              onDragStart={(event) => {
                onDraggingItemIdChange(item.id);
                onDragOverItemIdChange(null);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }}
              onDragEnd={() => {
                onDraggingItemIdChange(null);
                onDragOverItemIdChange(null);
              }}
              aria-label={`Drag ${item.reference} to reorder`}
              title="Drag to reorder"
            >
              <GripVertical size={15} aria-hidden="true" />
            </button>
            <span className="w-5 font-mono text-[10px] text-slate-500">
              {index + 1}
            </span>
            <span className="flex-1 text-sm font-medium text-white">
              {item.reference}
            </span>
            <span className="w-12 text-xs font-semibold text-teal-400">
              {item.translation}
            </span>
            <span
              className={cn(
                "w-28 text-right text-xs",
                item.available ? "text-emerald-400" : "text-yellow-400",
              )}
            >
              {item.available ? "Ready" : "Needs access"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
