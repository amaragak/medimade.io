"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconCampfire,
  IconCloud,
  IconCloudFog,
  IconCloudRain,
  IconCloudStorm,
  IconDroplet,
  IconFlame,
  IconFlower,
  IconHeadphones,
  IconHeartbeat,
  IconLeaf,
  IconMist,
  IconMoon,
  IconMoonStars,
  IconMountain,
  IconMusic,
  IconOm,
  IconRipple,
  IconSnowflake,
  IconSparkles,
  IconStars,
  IconSun,
  IconSunrise,
  IconSunset2,
  IconTrees,
  IconWaveSine,
  IconWaveSquare,
  IconWind,
  IconYoga,
} from "@tabler/icons-react";
import { FACTORY_ICON_OPTIONS } from "@/lib/mixer-factory-presets";

export const FACTORY_ICON_COMPONENTS: Record<string, typeof IconCloudRain> = {
  "cloud-rain": IconCloudRain,
  "cloud-storm": IconCloudStorm,
  "cloud-fog": IconCloudFog,
  cloud: IconCloud,
  wind: IconWind,
  waves: IconWaveSine,
  droplet: IconDroplet,
  snowflake: IconSnowflake,
  flame: IconFlame,
  campfire: IconCampfire,
  moon: IconMoon,
  "moon-stars": IconMoonStars,
  sun: IconSun,
  sunrise: IconSunrise,
  sunset: IconSunset2,
  stars: IconStars,
  sparkles: IconSparkles,
  trees: IconTrees,
  leaf: IconLeaf,
  mountain: IconMountain,
  flower: IconFlower,
  heartbeat: IconHeartbeat,
  music: IconMusic,
  headphones: IconHeadphones,
  "wave-sine": IconWaveSquare,
  om: IconOm,
  yoga: IconYoga,
  mist: IconMist,
  ripple: IconRipple,
};

export function FactoryIcon({
  id,
  size = 18,
}: {
  id: string;
  size?: number;
}) {
  const IconCmp = FACTORY_ICON_COMPONENTS[id] ?? IconTrees;
  return <IconCmp size={size} stroke={1.75} />;
}

export function FactoryIconSelect({
  value,
  onChange,
  iconBg,
  iconColor,
}: {
  value: string;
  onChange: (id: string) => void;
  iconBg: string;
  iconColor: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected =
    FACTORY_ICON_OPTIONS.find((o) => o.id === value) ?? FACTORY_ICON_OPTIONS[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t || rootRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        id="factory-mix-icon"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Icon: ${selected.label}`}
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5 text-[13px]"
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md"
          style={{ backgroundColor: iconBg, color: iconColor }}
          aria-hidden
        >
          <FactoryIcon id={value} size={16} />
        </span>
        <span className="hidden min-w-[4.5rem] text-left sm:inline">
          {selected.label}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          className="absolute right-0 top-full z-[90] mt-1 max-h-72 w-64 overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl"
          role="listbox"
          aria-label="Factory mix icon"
        >
          {FACTORY_ICON_OPTIONS.map((opt) => {
            const active = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={active}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] hover:bg-background ${
                  active ? "font-medium text-foreground" : "text-muted"
                }`}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
              >
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                  style={{ backgroundColor: iconBg, color: iconColor }}
                  aria-hidden
                >
                  <FactoryIcon id={opt.id} size={16} />
                </span>
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
