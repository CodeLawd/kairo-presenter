"use client";

import { useEffect, useRef } from "react";

/**
 * Rubber-band overscroll at the foot of the page: keep scrolling past the end
 * and the page lifts while a blurred aurora rises from below; let go and it
 * springs back. Works with the page root marked `data-stretchy-page`, and
 * stays out of the way with reduced motion.
 */

const MAX = 240; // px the aurora can reach
const LIFT = 0.45; // how far the page rides up, as a share of the stretch
const COLUMNS = 9;
const STIFFNESS = 380;
const DAMPING = 32;
const RELEASE_MS = 140; // a pause in wheel input this long counts as letting go
const BLEED = 24; // px the columns run past the bottom edge, so the blur has no seam

export function StretchyFooter(): React.ReactElement {
  const auroraRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const aurora = auroraRef.current;
    const page = document.querySelector<HTMLElement>("[data-stretchy-page]");
    if (!aurora || !page) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const columns = [...aurora.children] as HTMLElement[];
    const mid = (COLUMNS - 1) / 2;
    // Tallest in the middle, falling away to the edges.
    const shape = columns.map((_, i) => 0.5 + 0.5 * Math.cos(((i - mid) / mid) * (Math.PI / 2)) ** 2);

    let pull = 0; // overscroll distance from input
    let held = false; // input is still pulling
    let x = 0; // current stretch, px
    let v = 0;
    let frame = 0;
    let last = 0;
    let releaseTimer = 0;
    let touchY: number | null = null;

    const atBottom = (): boolean =>
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;

    const render = (now: number): void => {
      const on = x > 0.5;
      page.style.transform = on ? `translate3d(0, ${(-x * LIFT).toFixed(1)}px, 0)` : "";
      aurora.style.opacity = on ? "1" : "0";
      columns.forEach((col, i) => {
        const wobble = 1 + 0.07 * Math.sin(now / 260 + i * 1.3);
        col.style.height = on ? `${(x * shape[i] * wobble + BLEED).toFixed(1)}px` : "0px";
      });
    };

    const tick = (now: number): void => {
      const dt = last ? Math.min(0.032, (now - last) / 1000) : 1 / 60;
      last = now;
      if (held) {
        x += (MAX * (1 - Math.exp(-pull / MAX)) - x) * 0.3;
        v = 0;
      } else {
        v += (-STIFFNESS * x - DAMPING * v) * dt;
        x = Math.max(0, x + v * dt);
      }
      render(now);
      if (held || x > 0.5 || Math.abs(v) > 5) {
        frame = requestAnimationFrame(tick);
      } else {
        x = 0;
        v = 0;
        last = 0;
        frame = 0;
        render(now);
      }
    };

    const start = (): void => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const release = (): void => {
      held = false;
      pull = 0;
      start();
    };

    const onWheel = (e: WheelEvent): void => {
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (delta > 0 && atBottom()) {
        held = true;
        pull += delta;
        start();
        window.clearTimeout(releaseTimer);
        releaseTimer = window.setTimeout(release, RELEASE_MS);
      } else if (held && delta < 0) {
        window.clearTimeout(releaseTimer);
        release();
      }
    };
    const onTouchStart = (e: TouchEvent): void => {
      touchY = e.touches[0]?.clientY ?? null;
    };
    const onTouchMove = (e: TouchEvent): void => {
      const y = e.touches[0]?.clientY;
      if (touchY === null || y === undefined || !atBottom()) return;
      const dy = touchY - y;
      if (dy > 0) {
        held = true;
        pull = dy;
        start();
      }
    };
    const onTouchEnd = (): void => {
      touchY = null;
      if (held) release();
    };

    window.addEventListener("wheel", onWheel, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer);
      page.style.transform = "";
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  return (
    <div
      ref={auroraRef}
      className="landing-aurora pointer-events-none fixed inset-x-0 z-50 flex items-end opacity-0"
      aria-hidden="true"
    >
      {Array.from({ length: COLUMNS }, (_, i) => (
        <span className="landing-aurora-column" key={i} />
      ))}
    </div>
  );
}
