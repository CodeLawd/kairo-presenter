"use client";

import { useEffect, useState } from "react";
import { IconApple, IconLinux, IconWindows } from "@/components/landing/icons";

/**
 * The hero's download block: one large button for the visitor's system, a line
 * saying exactly which build it is, then labelled buttons for every other build.
 * Renders the Apple silicon build on the server and swaps after mount, so the
 * page stays static.
 */

export type HeroBuild = {
  name: string;
  system: string;
  detail: string;
  platform: string;
};

type Props = { builds: HeroBuild[]; id?: string };

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

export function HeroDownload({ builds, id }: Props): React.ReactElement {
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

  return (
    <div className="mt-8" id={id}>
      <a
        className="inline-flex min-h-11 items-center gap-2.5 rounded-lg bg-[#F4F0E9] px-5 text-sm font-semibold text-[#11120D] transition-[background,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#E9E5DE] motion-reduce:transform-none motion-reduce:transition-none [&_svg]:size-4"
        href={href(primary.platform)}
      >
        <SystemIcon system={primary.system} />
        Download for {primary.system === "macOS" ? "Mac" : primary.name}
      </a>
      <p className="mt-2.5 text-xs text-[#B9B2A9]">{primary.detail}</p>
      <p className="mt-6 text-xs text-[#B9B2A9]">Other versions</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {others.map((build) => (
          <li key={build.platform}>
            <a
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-medium text-[#F4F0E9] transition-colors duration-200 hover:border-white/40 hover:bg-white/10 [&_svg]:size-4"
              href={href(build.platform)}
              aria-label={`Download for ${build.name}`}
            >
              <SystemIcon system={build.system} />
              {build.name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
