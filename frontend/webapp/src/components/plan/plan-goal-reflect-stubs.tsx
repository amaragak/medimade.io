"use client";

/**
 * Surfaced journal + meditation context for a life area.
 * Only real soft-matched links — never demo stubs.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PlanDream } from "@/lib/plan-dreams";
import {
  fetchLinkedMeditationsForLifeArea,
  journalEntriesLinkedToLifeArea,
  type LinkedJournalHit,
  type LinkedMeditationHit,
} from "@/lib/plan-life-area-links";

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

type Props = {
  dream: PlanDream;
};

const sidebarCardClass =
  "rounded-2xl border border-border bg-card p-4 shadow-sm";

export function PlanReflectSidebarJournal({ dream }: Props) {
  const [journal, setJournal] = useState<LinkedJournalHit[]>([]);

  useEffect(() => {
    setJournal(journalEntriesLinkedToLifeArea(dream));
  }, [dream]);

  if (journal.length === 0) return null;

  return (
    <div className={sidebarCardClass}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        From your journal
      </h2>
      <ul className="mt-3">
        {journal.map((e) => (
          <li
            key={e.id}
            className="border-b border-border/80 last:border-b-0"
          >
            <Link
              href={e.href}
              className="flex items-baseline justify-between gap-3 py-2.5 transition-opacity hover:opacity-80"
            >
              <span className="min-w-0 truncate text-sm font-medium text-[#1E2530] dark:text-foreground">
                {e.title}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {formatShortDate(e.date)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PlanReflectSidebarMeditations({ dream }: Props) {
  const [meditations, setMeditations] = useState<LinkedMeditationHit[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchLinkedMeditationsForLifeArea(dream).then((hits) => {
      if (!cancelled) setMeditations(hits);
    });
    return () => {
      cancelled = true;
    };
  }, [dream]);

  if (meditations.length === 0) return null;

  return (
    <div className={sidebarCardClass}>
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Meditations
      </h2>
      <ul className="mt-3">
        {meditations.map((m) => (
          <li
            key={m.id}
            className="flex items-baseline justify-between gap-3 border-b border-border/80 py-2.5 last:border-b-0"
          >
            <Link
              href={m.href}
              className="min-w-0 truncate text-sm font-medium text-[#1E2530] transition-opacity hover:opacity-80 dark:text-foreground"
            >
              {m.title}
            </Link>
            <span className="shrink-0 text-xs text-muted">
              {formatShortDate(m.date)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function lifeAreaActivityStats(dream: PlanDream): {
  lastCheckIn: string;
  thoughtsThisMonth: number;
  meditationCount: number;
  daysAgoLabel: string;
} {
  const thoughts = [
    ...(dream.dreamEntries ?? []),
    ...(dream.obstacleEntries ?? []),
    ...(dream.visionEntries ?? []),
  ];
  const now = new Date();
  const thoughtsThisMonth = thoughts.filter((e) => {
    const d = new Date(e.createdAt);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  }).length;

  const lastCheckInIso = dream.checkIns?.[0]?.createdAt;
  const meditationCount = dream.meditationsGenerated ?? 0;

  let daysAgoLabel = "recently";
  try {
    const raw = dream.updatedAt || dream.createdAt;
    const then = new Date(raw).getTime();
    if (!Number.isNaN(then)) {
      const days = Math.max(
        0,
        Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)),
      );
      if (days === 0) daysAgoLabel = "today";
      else if (days === 1) daysAgoLabel = "1 day ago";
      else daysAgoLabel = `${days} days ago`;
    }
  } catch {
    /* keep recently */
  }

  return {
    lastCheckIn: lastCheckInIso ? formatShortDate(lastCheckInIso) : "—",
    thoughtsThisMonth,
    meditationCount,
    daysAgoLabel,
  };
}

/** @deprecated Prefer lifeAreaActivityStats; kept for card sidebar. */
export function lifeAreaActivityRows(
  dream: PlanDream,
): { label: string; value: string }[] {
  const s = lifeAreaActivityStats(dream);
  return [
    { label: "Last check-in", value: s.lastCheckIn },
    { label: "Thoughts this month", value: String(s.thoughtsThisMonth) },
    { label: "Meditations", value: String(s.meditationCount) },
  ];
}

/** Single-line muted meta for the life-area header — no card chrome. */
export function PlanLifeAreaHeaderSummary({ dream }: Props) {
  const s = lifeAreaActivityStats(dream);
  return (
    <p className="whitespace-nowrap text-[12px] leading-snug text-muted sm:text-[13px]">
      Last check-in {s.lastCheckIn}
      <span aria-hidden="true"> · </span>
      {s.thoughtsThisMonth} thoughts
      <span aria-hidden="true"> · </span>
      {s.meditationCount} meditations
      <span aria-hidden="true"> · </span>
      {s.daysAgoLabel}
    </p>
  );
}

export function PlanReflectSidebarActivity({ dream }: Props) {
  const rows = lifeAreaActivityRows(dream);

  return (
    <div className={sidebarCardClass}>
      <ul>
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-baseline justify-between gap-3 border-b border-border/80 py-2 last:border-b-0"
          >
            <span className="text-[12px] text-muted">{row.label}</span>
            <span className="text-[12px] text-[#8A8272] dark:text-muted">
              {row.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** @deprecated Prefer sidebar cards; kept for any leftover imports. */
export function PlanSurfacedContextPanel({ dream }: Props) {
  return (
    <div className="mt-10 space-y-4">
      <PlanReflectSidebarJournal dream={dream} />
      <PlanReflectSidebarMeditations dream={dream} />
    </div>
  );
}

type ScratchpadProps = {
  value: string;
  onChange: (next: string) => void;
};

/** Autosaves via parent `onChange` → dream.looseNotes persistence. */
export function PlanLooseNotesScratchpad({ value, onChange }: ScratchpadProps) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  function handleChange(next: string) {
    setLocal(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onChange(next), 400);
  }

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <section className="mt-12 border-t border-border/80 pt-8">
      <h2 className="font-display text-xl font-medium text-[#1E2530] dark:text-foreground">
        Anything else on your mind about this?
      </h2>
      <p className="mt-1 text-sm text-muted">
        Loose notes — no need to fit Dream, Resistance, or Vision.
      </p>
      <textarea
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        rows={5}
        placeholder="Fragments, reminders, things that don’t belong above…"
        className="mt-4 w-full resize-y rounded-[12px] border border-[#E5DFD0] bg-card px-5 py-[18px] text-sm leading-relaxed text-[#1E2530] outline-none ring-accent/25 focus:ring-2 dark:border-border dark:text-foreground"
      />
    </section>
  );
}

export function formatLastTouched(
  iso: string | undefined,
  fallbackIso: string,
): string {
  const raw = iso || fallbackIso;
  try {
    const then = new Date(raw).getTime();
    if (Number.isNaN(then)) return "Last touched recently";
    const days = Math.max(
      0,
      Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)),
    );
    if (days === 0) return "Last touched today";
    if (days === 1) return "Last touched yesterday";
    return `Last touched ${days} days ago`;
  } catch {
    return "Last touched recently";
  }
}
