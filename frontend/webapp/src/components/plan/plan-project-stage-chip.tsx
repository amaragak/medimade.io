"use client";

import { useEffect, useRef, useState } from "react";
import {
  DREAM_STATE_LABEL,
  DREAM_STATE_ORDER,
  type DreamState,
} from "@/lib/plan-dreams";

type Props = {
  state: DreamState;
  onChange: (next: DreamState) => void;
};

export function PlanProjectStageChip({ state, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(next: DreamState) {
    setOpen(false);
    if (next !== state) onChange(next);
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer rounded-full border border-accent/25 bg-accent-soft/15 px-2.5 py-1 text-xs font-medium text-accent-link transition-colors hover:border-accent/40 hover:bg-accent-soft/25"
      >
        {DREAM_STATE_LABEL[state]}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 min-w-[10rem] rounded-xl border border-border bg-card py-1 shadow-lg"
        >
          {DREAM_STATE_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              onClick={() => pick(id)}
              className={`block w-full cursor-pointer px-3 py-2 text-left text-sm transition-colors hover:bg-accent-soft/30 ${
                id === state ? "font-semibold text-foreground" : "text-muted"
              }`}
            >
              {DREAM_STATE_LABEL[id]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
