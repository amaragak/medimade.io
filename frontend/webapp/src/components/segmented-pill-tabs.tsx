"use client";

import type { ReactNode } from "react";

export type SegmentedPillTabOption<T extends string = string> = {
  id: T;
  label: ReactNode;
};

type SegmentedPillTabsProps<T extends string> = {
  options: readonly SegmentedPillTabOption<T>[];
  value: T;
  onChange: (id: T) => void;
  "aria-label": string;
  className?: string;
  /** Stretch each tab equally across the control (e.g. mobile library). */
  equalWidth?: boolean;
  disabled?: boolean;
};

/**
 * Shared pill tab control — same chrome as Create › Audio
 * (Soundscapes / Build your own). Active tab uses the primary fill.
 */
export function SegmentedPillTabs<T extends string>({
  options,
  value,
  onChange,
  "aria-label": ariaLabel,
  className = "",
  equalWidth = false,
  disabled = false,
}: SegmentedPillTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full flex-nowrap overflow-hidden rounded-full border border-border bg-background p-0.5 ${
        equalWidth ? "w-full" : "shrink-0"
      } ${className}`}
    >
      {options.map((opt) => {
        const selected = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => {
              if (disabled || opt.id === value) return;
              onChange(opt.id);
            }}
            className={`cursor-pointer rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              equalWidth ? "min-w-0 flex-1" : "shrink-0"
            } ${
              selected
                ? "accent-fill-gradient text-on-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
