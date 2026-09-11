"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Wordmark } from "@/components/brand/Wordmark";
import {
  getSession,
  mintAccessToken,
  type SessionSnapshot,
} from "@/lib/session";
import { btn, btnPrimary, cx, wrap } from "./primitives";

const NAV = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

/**
 * Client-side only for the scroll listener: until the page has moved the header
 * has no background and no bottom hairline, so the hero's gradient passes
 * behind it in one piece. Both fade in on scroll.
 */
export function SiteHeader(): React.ReactElement {
  const [stuck, setStuck] = useState(false);
  // undefined = still probing; null = signed out; otherwise the account.
  const [account, setAccount] = useState<
    SessionSnapshot["user"] | null | undefined
  >(undefined);

  useEffect(() => {
    const onScroll = (): void => setStuck(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // A signed-in visitor returning to the marketing page should see the way
  // back in, not another "Sign in". Minting is side-effect free for a guest
  // (no cookie, immediate 401) and a single rotation for a member — the same
  // cost as opening the dashboard itself.
  useEffect(() => {
    let cancelled = false;
    mintAccessToken()
      .then((token) => getSession(token))
      .then((snapshot) => {
        if (!cancelled) setAccount(snapshot.user);
      })
      .catch(() => {
        if (!cancelled) setAccount(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const initials = account
    ? account.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("") || "?"
    : "";

  return (
    <header
      className={cx(
        "sticky top-0 z-50 border-b transition-colors duration-300",
        // Transparent at the top so the hero field runs up behind the bar
        // unbroken; the scrim and blur only appear once content is under it.
        stuck
          ? "border-line-soft bg-ink/70 backdrop-blur-[14px] backdrop-saturate-150"
          : "border-transparent bg-transparent",
      )}
    >
      <div className={cx(wrap, "flex h-[62px] items-center gap-[26px]")}>
        <Wordmark href="#top" />
        <nav className="hidden gap-[22px] sm:flex" aria-label="Sections">
          {NAV.map((item) => (
            <a
              key={item.href}
              className="text-sm text-dim transition-colors hover:text-paper"
              href={item.href}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <span className="flex-1" />
        {account ? (
          <>
            {/* <Link
              href="/dashboard"
              className="hidden items-center gap-2 text-sm text-dim transition-colors hover:text-paper sm:inline-flex"
            >
              <span
                aria-hidden
                className="grid size-6 place-items-center rounded-full bg-white/[0.08] text-[10px] font-semibold tracking-wide text-paper"
              >
                {initials}
              </span>
              {account.name.split(/\s+/)[0] || "Account"}
            </Link> */}
            <Link
              className={cx(btn, btnPrimary, "px-[17px] py-2 text-[13px]")}
              href="/dashboard"
            >
              Dashboard
            </Link>
          </>
        ) : (
          <>
            <Link
              className="hidden text-sm text-dim transition-colors hover:text-paper sm:block"
              href="/login"
            >
              Sign in
            </Link>
            <a
              className={cx(btn, btnPrimary, "px-[17px] py-2 text-[13px]")}
              href="#get"
            >
              Get early access
            </a>
          </>
        )}
      </div>
    </header>
  );
}
