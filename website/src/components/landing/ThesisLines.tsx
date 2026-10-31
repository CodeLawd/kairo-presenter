"use client";

import { useEffect, useRef } from "react";

/**
 * A hyperspace starfield behind the pinned thesis: coloured streaks radiate
 * from the centre, and scrolling drives the warp — down pulls them inward, up
 * throws them outward, harder the faster you scroll — easing back to a slow
 * drift when the scroll stops. Draws only while on screen; with reduced motion
 * the field holds still. Ported from 23rd.dev's Radiant Lines.
 */

type Star = {
  x: number;
  y: number;
  z: number;
  pz: number; // depth one frame back, for the streak's tail
  color: string;
};

const COLORS = ["#FF6B4A", "#2DD4BF", "#FBBF24", "#60A5FA", "#F472B6", "#A3E635", "#94A3B8"];
const STAR_COUNT = 420;
const DEPTH = 1000;
// Spring that eases the warp speed toward its target.
const STIFFNESS = 70;
const DAMPING = 32;
const MASS = 0.5;
const TRAVEL_PER_SEC = 2.4 * 60;
const TRAIL_DT = 1 / 60; // streaks drawn as a 60fps step so they keep a tail at any fps
const IDLE = 0.22;

const pick = (): string => COLORS[Math.floor(Math.random() * COLORS.length)];

export function ThesisLines(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stars: Star[] = Array.from({ length: STAR_COUNT }, (_, i) => {
      const z = Math.random() * DEPTH;
      return {
        x: (Math.random() - 0.5) * DEPTH,
        y: (Math.random() - 0.5) * DEPTH,
        z,
        pz: z,
        color: COLORS[i % COLORS.length],
      };
    });
    let width = 0;
    let height = 0;
    let speed = IDLE;
    let speedVel = 0;
    let target = IDLE;
    let dir = -1;
    let lastY = window.scrollY;
    let lastScrollT = performance.now();
    let lastFrame = performance.now();
    let frame = 0;
    let visible = false;

    const resize = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const warpTo = (velocity: number): void => {
      if (Math.abs(velocity) > 2) dir = velocity > 0 ? 1 : -1;
      target = IDLE + Math.min(8, Math.abs(velocity) / 80);
    };

    const draw = (dt: number): void => {
      if (performance.now() - lastScrollT > 40) warpTo(0);
      const accel = (STIFFNESS * (target - speed) - DAMPING * speedVel) / MASS;
      speedVel += accel * dt;
      speed += speedVel * dt;

      const warp = still ? 0 : speed;
      const travel = warp * TRAVEL_PER_SEC;
      const cx = width / 2;
      const cy = height / 2;
      const focal = Math.max(width, height) * 0.5;

      ctx.clearRect(0, 0, width, height);
      ctx.lineCap = "round";
      for (const s of stars) {
        s.z -= dir * travel * dt;
        if (s.z <= 1 || s.z >= DEPTH) {
          s.z = s.pz = s.z <= 1 ? DEPTH : 1.5;
          s.x = (Math.random() - 0.5) * DEPTH;
          s.y = (Math.random() - 0.5) * DEPTH;
          s.color = pick();
        } else {
          s.pz = Math.min(DEPTH, Math.max(1.01, s.z + dir * travel * TRAIL_DT));
        }

        const k = focal / s.z;
        const x = cx + s.x * k;
        const y = cy + s.y * k;
        const pk = focal / s.pz;
        const px = cx + s.x * pk;
        const py = cy + s.y * pk;
        if (
          (x < -50 && px < -50) ||
          (x > width + 50 && px > width + 50) ||
          (y < -50 && py < -50) ||
          (y > height + 50 && py > height + 50)
        ) {
          continue;
        }

        const near = 1 - s.z / DEPTH;
        const lineW = Math.max(0.8, near * (1.8 + warp * 0.12));
        ctx.globalAlpha = 0.35 + near * 0.65;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = lineW;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.stroke();
        if (near > 0.45) {
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(x, y, lineW * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    const step = (now: number): void => {
      const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
      lastFrame = now;
      draw(dt);
      frame = visible && !still && document.visibilityState !== "hidden" ? requestAnimationFrame(step) : 0;
    };

    const wake = (): void => {
      if (frame || !visible) return;
      if (still) {
        draw(0);
        return;
      }
      lastFrame = performance.now();
      frame = requestAnimationFrame(step);
    };

    const onScroll = (): void => {
      const now = performance.now();
      const y = window.scrollY;
      const dt = now - lastScrollT;
      if (!still && dt > 0) warpTo(((y - lastY) / dt) * 1000);
      lastY = y;
      lastScrollT = now;
    };

    const onResize = (): void => {
      resize();
      draw(0);
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        lastY = window.scrollY;
        lastScrollT = performance.now();
        wake();
      }
    });

    resize();
    draw(0);
    observer.observe(canvas);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", wake);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  return <canvas ref={canvasRef} className="block size-full" aria-hidden="true" />;
}
