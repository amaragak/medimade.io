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

function SampleButtons({
  sounds,
  value,
  onPick,
}: {
  sounds: BackgroundAudioItem[];
  value: string;
  onPick: (key: string) => void;
}) {
  if (sounds.length === 0) {
    return <div className="px-3 py-1.5 text-sm text-muted">No sounds yet</div>;
  }
  return (
    <>
      {sounds.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-background ${
            s.key === value ? "font-medium text-foreground" : "text-muted"
          }`}
          onClick={() => onPick(s.key)}
        >
          {s.name}
        </button>
      ))}
    </>
  );
}

export function SoundFolderSelect({
  category,
  items,
  value,
  onChange,
  disabled,
  compact,
}: SoundFolderSelectProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const mobileSamplesRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeSub, setActiveSub] = useState<string | null>(null);
  const folders = subcategoryOptions(category);
  const selected = items.find((s) => s.key === value);
  const label = selected?.name || "None";

  const bySub = useMemo(() => {
    const map = new Map<string, BackgroundAudioItem[]>();
    for (const item of items) {
      const sub =
        item.subcategory ||
        inferSoundSubcategory(category, item.key) ||
        (folders[0]?.id ?? "");
      const list = map.get(sub) ?? [];
      list.push(item);
      map.set(sub, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [items, folders, category]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t || rootRef.current?.contains(t)) return;
      setOpen(false);
      setActiveSub(null);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  useEffect(() => {
    if (!open || !activeSub) return;
    if (typeof window === "undefined") return;
    // Nested sample panel is mobile-only (< sm / 640px)
    if (window.matchMedia("(min-width: 640px)").matches) return;
    const el = mobileSamplesRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open, activeSub]);

  function pickSound(key: string) {
    onChange(key);
    setOpen(false);
    setActiveSub(null);
  }

  function pickNone() {
    onChange("");
    setOpen(false);
    setActiveSub(null);
  }

  function toggleFolder(folderId: string) {
    setActiveSub((cur) => (cur === folderId ? null : folderId));
  }

  const triggerClass = compact
    ? "flex w-full min-w-0 items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-left text-sm disabled:opacity-50"
    : "flex min-w-0 flex-1 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2.5 text-left text-sm disabled:opacity-50";

  const menu = (
    <div
      className={`absolute z-[90] max-h-72 overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl ${
        compact
          ? "left-0 right-0 top-full mt-1 sm:left-1/2 sm:right-auto sm:min-w-[13rem] sm:-translate-x-1/2"
          : "left-0 top-full mt-1 min-w-[12rem]"
      }`}
      role="listbox"
    >
      <button
        type="button"
        className="block w-full px-3 py-1.5 text-left text-sm hover:bg-background"
        onClick={pickNone}
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
            onClick={() => pickSound(s.key)}
          >
            {s.name}
          </button>
        ))
      ) : (
        folders.map((folder) => {
          const sounds = bySub.get(folder.id) ?? [];
          const isActive = activeSub === folder.id;
          return (
            <div
              key={folder.id}
              className="relative"
              onMouseEnter={() => {
                if (typeof window === "undefined") return;
                if (window.matchMedia("(min-width: 640px)").matches) {
                  setActiveSub(folder.id);
                }
              }}
            >
              <button
                type="button"
                aria-expanded={isActive}
                className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-background ${
                  isActive ? "bg-background font-medium text-foreground" : ""
                }`}
                onClick={() => toggleFolder(folder.id)}
              >
                <span>
                  {folder.label}
                  <span className="ml-1 text-[11px] text-muted">
                    ({sounds.length})
                  </span>
                </span>
                <span className="text-muted sm:hidden" aria-hidden>
                  {isActive ? "▾" : "›"}
                </span>
                <span className="hidden text-muted sm:inline" aria-hidden>
                  ›
                </span>
              </button>
              {/* Mobile: accordion samples directly under folder */}
              {isActive ? (
                <div
                  ref={mobileSamplesRef}
                  tabIndex={-1}
                  role="group"
                  aria-label={`${folder.label} samples`}
                  className="border-t border-border/60 bg-background/40 pb-1 pl-2 outline-none sm:hidden"
                >
                  <SampleButtons
                    sounds={sounds}
                    value={value}
                    onPick={pickSound}
                  />
                </div>
              ) : null}
              {/* Tablet+: side flyout */}
              {isActive ? (
                <div className="absolute top-0 left-full z-[91] ml-1 hidden max-h-64 min-w-[12rem] overflow-auto rounded-xl border border-border bg-card py-1 shadow-xl sm:block">
                  <SampleButtons
                    sounds={sounds}
                    value={value}
                    onPick={pickSound}
                  />
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={`relative min-w-0 ${compact ? "w-full" : "flex-1"} ${
        open ? "z-30" : ""
      }`}
    >
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
          if (open) setActiveSub(null);
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
