"use client";

import { useEffect, useState } from "react";
import { IconApple, IconLinux, IconWindows } from "@/components/landing/icons";

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
  /** `hero`: solid white button over blue atmospheric gradient. `full`: solid white button + translucent secondary buttons inside electric blue CTA card. */
  variant?: "hero" | "full";
};

type UAData = {
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string }>;
};

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
        <a
          className="landing-press inline-flex h-12 items-center gap-2.5 rounded-[10px] bg-white px-6 text-[15px] font-medium tracking-[-.01em] text-[#111318] shadow-[0_14px_34px_-10px_rgba(4,12,42,0.45)] hover:bg-[#F4F7FF] [&_svg]:size-4"
          href={href(primary.platform)}
        >
          <SystemIcon system={primary.system} />
          {label}
        </a>

        <div className="mt-4 flex flex-col items-center gap-x-3 gap-y-1 text-[13.5px] text-white/80 sm:flex-row">
          <span>{primary.detail}</span>
          <span aria-hidden="true" className="hidden text-white/40 sm:inline">·</span>
          <span className="inline-flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            {others.map((build) => (
              <a
                key={build.platform}
                href={href(build.platform)}
                className="text-white underline-offset-4 transition-opacity duration-150 hover:opacity-80 hover:underline"
              >
                {build.name}
              </a>
            ))}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-start" id={id}>
      <div className="flex flex-wrap items-center gap-3">
        <a
          className="landing-press inline-flex h-12 items-center gap-2.5 rounded-[10px] bg-white px-6 text-[15px] font-medium tracking-[-.01em] text-[#111318] shadow-[0_12px_28px_-10px_rgba(4,12,42,0.35)] hover:bg-[#F4F7FF] [&_svg]:size-4"
          href={href(primary.platform)}
        >
          <SystemIcon system={primary.system} />
          {label}
        </a>
        {others.map((build) => (
          <a
            key={build.platform}
            className="landing-press inline-flex h-12 items-center gap-2 rounded-[10px] border border-white/25 bg-white/10 px-4 text-[14px] font-medium text-white backdrop-blur-xs hover:bg-white/18 [&_svg]:size-4"
            href={href(build.platform)}
            aria-label={`Download for ${build.name}`}
          >
            <SystemIcon system={build.system} />
            {build.name}
          </a>
        ))}
      </div>
      <p className="mt-4 text-[14px] text-white/75">{primary.detail} · Free native desktop builds</p>
    </div>
  );
}
