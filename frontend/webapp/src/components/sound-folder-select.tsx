"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BackgroundAudioItem } from "@/lib/medimade-api";
import {
  categoryLabel,
  inferSoundSubcategory,
  subcategoryLabel,
  subcategoryOptions,
  type SoundCategoryId,
} from "@/lib/sound-taxonomy";

type SoundFolderSelectProps = {
  category: SoundCategoryId;
  items: BackgroundAudioItem[];
  value: string;
  onChange: (key: string) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function SoundFolderSelect({
  category,
  items,
  value,
  onChange,
  disabled,
  compact,
}: SoundFolderSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hoverSub, setHoverSub] = useState<string | null>(null);
  const folders = subcategoryOptions(category);
  const selected = items.find((s) => s.key === value);
  const label = selected?.name || "None";

  const bySub = useMemo(() => {
    const map = new Map<string, BackgroundAudioItem[]>();
    for (const item of items) {
      const sub =
        item.subcategory || inferSoundSubcategory(category, item.key) || (folders[0]?.id ?? "");
      const list = map.get(sub) ?? [];
      list.push(item);
      map.set(sub, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [items, folders]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t || rootRef.current?.contains(t)) return;
      setOpen(false);
      setHoverSub(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const triggerClass = compact
    ? "flex w-full min-w-0 items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-left text-sm disabled:opacity-50"
    : "flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm disabled:opacity-50";

  const menu = (
    <div
      className={`absolute z-[90] rounded-xl border border-border bg-card py-1 shadow-xl ${
        compact
          ? "left-1/2 top-full mt-1 min-w-[13rem] -translate-x-1/2"
          : "left-0 top-full mt-1 min-w-[12rem]"
      }`}
      role="listbox"
    >
      <button
        type="button"
        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-background"
        onClick={() => {
          onChange("");
          setOpen(false);
          setHoverSub(null);
        }}
      >
        None
      </button>
      {folders.length === 0 ? (
        items.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-background ${
              s.key === value ? "font-medium text-foreground" : "text-muted"
            }`}
            onClick={() => {
              onChange(s.key);
              setOpen(false);
            }}
          >
            {s.name}
          </button>
        ))
      ) : (
        folders.map((folder) => {
          const sounds = bySub.get(folder.id) ?? [];
          return (
            <div
              key={folder.id}
              className="relative"
              onMouseEnter={() => setHoverSub(folder.id)}
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-background"
                onClick={() => setHoverSub(folder.id)}
              >
                <span>
                  {folder.label}
                  <span className="ml-1 text-[11px] text-muted">({sounds.length})</span>
                </span>
                <span className="text-muted">›</span>
              </button>
              {hoverSub === folder.id ? (
                <div className="absolute top-0 left-full z-[91] ml-1 max-h-64 min-w-[12rem] overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl">
                  {sounds.length === 0 ? (
                    <div className="px-3 py-1.5 text-sm text-muted">No sounds yet</div>
                  ) : (
                    sounds.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-background ${
                          s.key === value ? "font-medium text-foreground" : ""
                        }`}
                        onClick={() => {
                          onChange(s.key);
                          setOpen(false);
                          setHoverSub(null);
                        }}
                      >
                        {s.name}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div ref={rootRef} className={`relative min-w-0 ${compact ? "w-full" : "flex-1"}`}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${categoryLabel(category)} sound`}
        title={
          selected
            ? `${selected.name}${selected.subcategory ? ` · ${subcategoryLabel(category, selected.subcategory)}` : ""}`
            : "None"
        }
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
          if (open) setHoverSub(null);
        }}
        className={triggerClass}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
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
      {open ? menu : null}
    </div>
  );
}
