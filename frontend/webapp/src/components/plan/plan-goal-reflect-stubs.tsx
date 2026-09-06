"use client";

/**
 * Surfaced journal + meditation context for a life area.
 * Guest demos show curated sample links; personal areas stay empty until
 * real matching exists.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isDemoIdeateDream } from "@/lib/ideate-demo-seed";
import type { PlanDream } from "@/lib/plan-dreams";

function formatStubDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

const DEMO_CONTEXT: Record<
  string,
  {
    journal: { id: string; date: string; title: string; href: string }[];
    meditations: {
      id: string;
      title: string;
      type: string;
      date: string;
    }[];
  }
> = {
  "demo-ideate-mornings": {
    journal: [
      {
        id: "demo-j-morning",
        date: "2026-08-02T20:00:00.000Z",
        title: "A quieter morning",
        href: "/journal/my",
      },
      {
        id: "demo-j-quiet",
        date: "2026-07-19T09:15:00.000Z",
        title: "Quiet for twenty minutes",
        href: "/journal/my",
      },
    ],
    meditations: [
      {
        id: "demo-m1",
        title: "Soft morning light",
        type: "Visualisation",
        date: "2026-08-11T14:00:00.000Z",
      },
      {
        id: "demo-m2",
        title: "Phone stays in the hall",
        type: "Manifestation",
        date: "2026-07-22T16:30:00.000Z",
      },
    ],
  },
  "demo-ideate-project": {
    journal: [
      {
        id: "demo-j-resist",
        date: "2026-07-28T21:00:00.000Z",
        title: "What I keep putting off",
        href: "/journal/my",
      },
    ],
    meditations: [
      {
        id: "demo-m3",
        title: "Fifteen minutes only",
        type: "Focus",
        date: "2026-07-30T16:00:00.000Z",
      },
    ],
  },
  "demo-ideate-body": {
    journal: [
      {
        id: "demo-j-grat",
        date: "2026-07-15T07:00:00.000Z",
        title: "Three things",
        href: "/journal/my/gratitudes",
      },
    ],
    meditations: [
      {
        id: "demo-m4",
        title: "Shoulders down before work",
        type: "Body scan",
        date: "2026-07-04T10:00:00.000Z",
      },
    ],
  },
};

type Props = {
  dream: PlanDream;
};

/** Unified surfaced-context panel — journal + meditations side by side. */
export function PlanSurfacedContextPanel({ dream }: Props) {
  const demo = isDemoIdeateDream(dream);
  const pack = DEMO_CONTEXT[dream.id];
  const journal = pack?.journal ?? [];
  const meditations = pack?.meditations ?? [];

  if (!demo) {
    return (
      <section className="mt-12 rounded-[14px] bg-[#F5F1E7] px-8 py-7 dark:bg-accent-soft/20">
        <p className="text-sm leading-relaxed text-muted">
          Related journal pages and meditations will show up here as you write
          and create — nothing linked to this life area yet.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12 rounded-[14px] bg-[#F5F1E7] px-8 py-7 dark:bg-accent-soft/20">
      <div className="grid gap-8 md:grid-cols-2 md:gap-10">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-widest text-[#8A7566]">
            From your journal
          </h2>
          {journal.length === 0 ? (
            <p className="mt-3 text-sm italic text-[#A39C8C]">Nothing linked yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {journal.map((e) => (
                <li key={e.id}>
                  <Link
                    href={e.href}
                    className="flex items-baseline justify-between gap-3 rounded-lg bg-card px-3 py-2.5 transition-opacity hover:opacity-80"
                  >
                    <span className="min-w-0 truncate text-sm font-medium text-[#1E2530] dark:text-foreground">
                      {e.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {formatStubDate(e.date)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-sm font-medium uppercase tracking-widest text-[#8A7566]">
            Meditations from this area
          </h2>
          {meditations.length === 0 ? (
            <p className="mt-3 text-sm italic text-[#A39C8C]">None yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {meditations.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg bg-card px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[#1E2530] dark:text-foreground">
                      {m.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {m.type} · {formatStubDate(m.date)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled
                    title="Sample — play not wired"
                    className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-[#E5DFD0] text-muted opacity-60 dark:border-border"
                    aria-label={`${m.title} (sample)`}
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
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
