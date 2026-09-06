import { useCallback } from "react";
import { useAppStore } from "@/stores/useAppStore";
import { resizeOperatorPanel } from "@shared/operator-layout";

export interface LiveRailWidth {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * Width + drag/keyboard resize handling for the shared live output rail.
 *
 * The width lives in the app store (persisted to localStorage on every change)
 * rather than in component state: Operator stays mounted while hidden, so a
 * per-screen state would only pick up a new width on remount and Operator would
 * keep showing the width it had at app start.
 */
export function useLiveRailWidth(): LiveRailWidth {
  const width = useAppStore((state) => state.liveRailWidth);
  const setWidth = useAppStore((state) => state.setLiveRailWidth);

  const onResizeStart = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>): void => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = width;

      const handlePointerMove = (pointerEvent: PointerEvent): void => {
        setWidth(
          resizeOperatorPanel("right", startWidth, pointerEvent.clientX - startX),
        );
      };
      const handlePointerUp = (): void => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [setWidth, width],
  );

  const onResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>): void => {
      const delta =
        event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
      if (delta === 0) return;
      setWidth(resizeOperatorPanel("right", width, delta));
    },
    [setWidth, width],
  );

  return { width, onResizeStart, onResizeKeyDown };
}
