"use client";

import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from "react";

/**
 * A group whose items arrive one after another once it's on screen, each a beat
 * (80ms) behind the last, like Apple's product-page card rows. Plays once.
 * Items are visible without JavaScript (the hidden start state is gated on
 * `scripting: enabled` in landing.css), and reduced motion shows them at once.
 */
export function Stagger({
  as: Tag = "ul",
  className,
  children,
  ...rest
}: {
  as?: "ul" | "ol" | "div";
  className?: string;
  children: React.ReactNode;
} & React.AriaAttributes): React.ReactElement {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { rootMargin: "0px 0px -4% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  let i = 0;
  const items = Children.map(children, (child) =>
    isValidElement<{ style?: React.CSSProperties }>(child)
      ? cloneElement(child, { style: { ...child.props.style, "--i": i++ } as React.CSSProperties })
      : child,
  );

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`landing-stagger ${className ?? ""}`}
      data-shown={shown}
      {...rest}
    >
      {items}
    </Tag>
  );
}
