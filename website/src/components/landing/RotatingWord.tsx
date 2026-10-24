"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A word in the hero headline that cycles through `words`. Each word slides up
 * into place while the slot eases to its width, so the rest of the line follows
 * instead of leaving a gap. With reduced motion it stays on the first word.
 */

type Props = { words: string[]; interval?: number; delay?: number };

export function RotatingWord({ words, interval = 3000, delay = 2300 }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const measure = (): void =>
      setWidths(wordRefs.current.map((el) => el?.getBoundingClientRect().width ?? 0));
    measure();
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    const start = window.setTimeout(() => {
      timer = window.setInterval(() => {
        setIndex((i) => {
          setPrevious(i);
          return (i + 1) % words.length;
        });
      }, interval);
    }, delay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
    };
  }, [words.length, interval, delay]);

  const width = widths[index];

  return (
    <span className="landing-hero-rotate" style={width ? { width } : undefined}>
      <span className="landing-hero-rotate-measure">{words[0]}</span>
      <span className="landing-hero-rotate-window">
        {words.map((word, i) => (
          <span
            key={word}
            ref={(el) => {
              wordRefs.current[i] = el;
            }}
            className="landing-hero-rotate-word"
            data-state={i === index ? "in" : i === previous ? "out" : "idle"}
          >
            {word}
          </span>
        ))}
      </span>
    </span>
  );
}
