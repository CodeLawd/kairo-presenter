"use client";

import { useEffect, useState } from "react";
import { IconApple, IconLinux, IconWindows } from "@/components/landing/icons";
import { Stagger } from "@/components/landing/Stagger";

/**
 * Download blocks: one large button for the visitor's system and a line saying
 * exactly which build it is. The hero adds a link down the page; the full block
 * lists every other build beneath it.
 * Renders the Apple silicon build on the server and swaps after mount, so the
 * page stays static.
 */

export type HeroBuild = {
  name: string;
  system: string;
  detail: string;
  format?: string;
  platform: string;
};

type Props = {
  builds: HeroBuild[];
  id?: string;
  /** `hero`: the visitor's build and a link down the page. `full`: every build. */
  variant?: "hero" | "full";
};

type UAData = {
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string }>;
};

/**
 * Which Mac build to offer. Chromium browsers report the CPU architecture
 * outright; elsewhere an Intel or AMD graphics renderer gives an Intel Mac
 * away. Anything unclear gets Apple silicon, which every Mac since 2020 uses.
 */
async function detectMacPlatform(): Promise<string> {
  const uaData = (navigator as Navigator & { userAgentData?: UAData })
    .userAgentData;
  try {
    const { architecture } =
      (await uaData?.getHighEntropyValues?.(["architecture"])) ?? {};
    if (architecture === "x86") return "mac-x64";
    if (architecture === "arm") return "mac-arm64";
  } catch {
    // Fall through to the renderer check.
  }
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = info
      ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL))
      : "";
    if (/Intel|AMD|Radeon|NVIDIA/i.test(renderer)) return "mac-x64";
  } catch {
    // No WebGL: keep the default.
  }
  return "mac-arm64";
}

async function detectPlatform(): Promise<string | null> {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad/i.test(ua)) return null;
  if (/Windows/i.test(ua)) return "windows-x64";
  if (/Linux|X11/i.test(ua)) return "linux-x64";
  if (/Mac/i.test(ua)) return detectMacPlatform();
  return null;
}

function SystemIcon({ system }: { system: string }): React.ReactElement {
  if (system === "Windows") return <IconWindows />;
  if (system === "Linux") return <IconLinux />;
  return <IconApple />;
}

const href = (platform: string): string =>
  `/download/thanks?platform=${platform}&source=hero`;

export function HeroDownload({ builds, id, variant = "full" }: Props): React.ReactElement {
  const [primaryPlatform, setPrimaryPlatform] = useState(builds[0].platform);

  useEffect(() => {
    let live = true;
    void detectPlatform().then((detected) => {
      if (live && detected) setPrimaryPlatform(detected);
    });
    return () => {
      live = false;
    };
  }, []);

  const primary =
    builds.find((b) => b.platform === primaryPlatform) ?? builds[0];
  const others = builds.filter((b) => b !== primary);

  const label = `Download for ${primary.system === "macOS" ? "Mac" : primary.name}`;

  if (variant === "hero") {
    return (
      <div className="flex flex-col items-center" id={id}>
        <div className="flex flex-wrap items-center justify-center gap-3.5">
          <a
            className="landing-press inline-flex min-h-12 items-center gap-2.5 rounded-full bg-[#F4F0E9] px-7 text-[15px] font-semibold text-[#0A0B10] shadow-[0_14px_36px_-10px_rgba(244,240,233,0.38),inset_0_1px_0_rgba(255,255,255,0.9)] hover:bg-white [&_svg]:size-4"
            href={href(primary.platform)}
          >
            <SystemIcon system={primary.system} />
            {label}
          </a>
          <a
            className="landing-press group inline-flex min-h-12 items-center gap-2 rounded-full border border-white/[.12] bg-white/[.04] px-6 text-[15px] font-medium text-[#ECEEF5] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md hover:border-white/[.22] hover:bg-white/[.08] hover:text-white"
            href="#product"
          >
            See how it works
            <span aria-hidden="true" className="text-[#8AB4FF] transition-transform duration-300 ease-[var(--ease-out)] group-hover:translate-y-0.5">↓</span>
          </a>
        </div>
        <p className="mt-4 text-[13px] text-[#9CA1B5]">
          {primary.detail} ·{" "}
          <a className="text-[#D8DCEB] underline-offset-4 hover:text-white hover:underline" href="#get">
            Other platforms
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center" id={id}>
      <a
        className="landing-press inline-flex min-h-12 items-center gap-2.5 rounded-full bg-[#F4F0E9] px-7 text-[15px] font-semibold text-[#0A0B10] shadow-[0_12px_32px_-10px_rgba(244,240,233,0.32),inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-white [&_svg]:size-4"
        href={href(primary.platform)}
      >
        <SystemIcon system={primary.system} />
        {label}
      </a>
      <p className="mt-3 text-[13px] text-[#9CA1B5]">{primary.detail}</p>
      <Stagger className="mt-10 grid w-full max-w-[740px] grid-cols-1 gap-3.5 min-[561px]:grid-cols-3" aria-label="Other platforms">
        {others.map((build) => (
          <li
            key={build.platform}
            className="overflow-hidden rounded-2xl border border-white/[.09] bg-white/[.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-[border-color,background-color] duration-200 hover:border-white/[.16] hover:bg-white/[.05]"
          >
            <a
              className="landing-press landing-press-soft flex h-full flex-col items-center justify-center gap-1.5 px-5 py-6 text-center [&_svg]:size-5"
              href={href(build.platform)}
              aria-label={`Download for ${build.name}`}
            >
              <span className="text-[#F4F0E9]"><SystemIcon system={build.system} /></span>
              <span className="mt-1.5 text-[15px] font-semibold tracking-[-.01em] text-[#F4F0E9]">{build.name}</span>
              <span className="text-[12.5px] leading-[1.4] text-[#9CA1B5]">{build.detail}</span>
            </a>
          </li>
        ))}
      </Stagger>
    </div>
  );
}
