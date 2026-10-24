"use client";

import { useEffect, useState } from "react";

/**
 * A word in the hero headline that cycles through `words`. Each word slides up
 * into a slot sized for the widest word, keeping the headline stable.
 * With reduced motion it stays on the first word.
 */

type Props = { words: string[]; interval?: number; delay?: number };

export function RotatingWord({ words, interval = 3000, delay = 2300 }: Props): React.ReactElement {
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
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

  return (
    <span className="landing-hero-rotate">
      {words.map((word) => (
        <span key={word} className="landing-hero-rotate-measure" aria-hidden="true">{word}</span>
      ))}
      <span className="landing-hero-rotate-window">
        {words.map((word, i) => (
          <span
            key={word}
            aria-hidden={i !== index}
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
