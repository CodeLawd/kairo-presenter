"use client";

import { useEffect, useRef } from "react";

/**
 * A field of dots behind the pinned thesis. Scrolling sets them drifting —
 * faster the harder you scroll, carried along at different depths — and they
 * coast to a stop when the scroll does. They brighten as the section is read
 * through. Draws only while on screen; with reduced motion the dots hold still.
 */

type Dot = {
  x: number;
  y: number;
  angle: number; // heading of the dot's own drift
  turn: number; // how its heading bends as it moves
  depth: number; // 0..1: how strongly scroll carries it
  r: number;
  alpha: number;
  blue: boolean;
};

const SPACING = 58; // average px between dots
const FRICTION = 0.9; // per frame; how quickly motion dies after the scroll stops
const REST = 0.02; // below this the loop sleeps

export function ThesisDots(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = canvas?.closest("section");
    const ctx = canvas?.getContext("2d");
    if (!canvas || !section || !ctx) return;

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    let speed = 0; // smoothed scroll velocity, px per frame
    let lastY = window.scrollY;
    let frame = 0;
    let visible = false;

    const progress = (): number => {
      const rect = section.getBoundingClientRect();
      const run = rect.height - window.innerHeight;
      return run > 0 ? Math.min(1, Math.max(0, -rect.top / run)) : 0.5;
    };

    const seed = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((width * height) / (SPACING * SPACING));
      dots = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        angle: Math.random() * Math.PI * 2,
        turn: (Math.random() - 0.5) * 0.04,
        depth: 0.15 + Math.random() * 0.85,
        r: 0.6 + Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.4,
        blue: Math.random() < 0.22,
      }));
    };

    const draw = (): void => {
      const glow = 0.45 + 0.55 * progress();
      ctx.clearRect(0, 0, width, height);
      for (const d of dots) {
        ctx.globalAlpha = d.alpha * glow;
        ctx.fillStyle = d.blue ? "#8AB4FF" : "#F6F3EB";
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const step = (): void => {
      const y = window.scrollY;
      speed = speed * FRICTION + (y - lastY) * (1 - FRICTION);
      lastY = y;
      const energy = Math.abs(speed);
      for (const d of dots) {
        d.angle += d.turn * energy;
        d.x += Math.cos(d.angle) * energy * d.depth * 0.9;
        d.y += Math.sin(d.angle) * energy * d.depth * 0.9 - speed * d.depth * 0.6;
        if (d.x < -4) d.x += width + 8;
        else if (d.x > width + 4) d.x -= width + 8;
        if (d.y < -4) d.y += height + 8;
        else if (d.y > height + 4) d.y -= height + 8;
      }
      draw();
      frame = energy > REST && visible ? requestAnimationFrame(step) : 0;
    };

    const wake = (): void => {
      if (!visible) return;
      if (still) {
        draw();
        return;
      }
      // lastY still holds where the last scroll came to rest, so the first frame sees this scroll.
      if (!frame) frame = requestAnimationFrame(step);
    };

    const onResize = (): void => {
      seed();
      draw();
    };

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) {
        lastY = window.scrollY;
        draw();
      }
    });

    seed();
    draw();
    observer.observe(canvas);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return <canvas ref={canvasRef} className="block size-full" aria-hidden="true" />;
}
