"use client";

import { IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react";
import { FactoryIcon } from "@/components/factory-icons";
import type { MixerFactoryPreset } from "@/lib/mixer-factory-presets";

export function FactoryPresetRow({
  preset,
  loaded,
  previewing,
  onLoad,
  onPreview,
}: {
  preset: MixerFactoryPreset;
  loaded: boolean;
  previewing: boolean;
  onLoad: () => void;
  onPreview: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onLoad}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLoad();
        }
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-[10px] border-[0.5px] border-solid p-3 transition-colors ${
        loaded
          ? "border-border border-l-[3px] border-l-accent bg-card text-foreground shadow-sm"
          : "border-border bg-background text-foreground hover:border-accent/40"
      }`}
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
        style={{
          backgroundColor: preset.icon_bg,
          color: preset.icon_color,
        }}
        aria-hidden
      >
        <FactoryIcon id={preset.icon} size={18} />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-sm font-medium leading-snug">
          {preset.name}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted">
          {preset.description || "No description"}
        </span>
      </span>
      <button
        type="button"
        aria-label={
          previewing
            ? `Stop preview of ${preset.name}`
            : `Preview ${preset.name}`
        }
        onClick={(e) => {
          e.stopPropagation();
          onPreview();
        }}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent-soft/50 hover:text-foreground"
      >
        {previewing ? (
          <IconPlayerPause size={16} />
        ) : (
          <IconPlayerPlay size={16} />
        )}
      </button>
    </div>
  );
}
