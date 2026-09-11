"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  options: readonly number[];
  onChange: (mins: number) => void;
  disabled?: boolean;
};

/**
 * Styled length picker (same trigger/menu chrome as mixer selects).
 * Menu opens upward so it clears the create-flow bottom bar.
 */
export function MeditationLengthSelect({
  value,
  options,
  onChange,
  disabled,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t || rootRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        Length
      </span>
      <div ref={rootRef} className={`relative ${open ? "z-40" : ""}`}>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Target meditation length"
          title="Target spoken length. If you change this after generating a script in chat, audio will regenerate the script to match."
          onClick={() => {
            if (disabled) return;
            setOpen((v) => !v);
          }}
          className="flex min-w-[6.25rem] cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left text-sm font-semibold text-foreground shadow-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{value} min</span>
          <svg
            viewBox="0 0 24 24"
            className={`h-4 w-4 shrink-0 text-muted transition-transform ${
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
            role="listbox"
            className="absolute bottom-full left-1/2 z-[90] mb-1.5 min-w-full -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-xl"
          >
            {options.map((mins) => (
              <button
                key={mins}
                type="button"
                role="option"
                aria-selected={mins === value}
                className={`block w-full px-3.5 py-2.5 text-left text-sm hover:bg-background ${
                  mins === value
                    ? "font-semibold text-foreground"
                    : "text-muted"
                }`}
                onClick={() => {
                  onChange(mins);
                  setOpen(false);
                }}
              >
                {mins} min
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
