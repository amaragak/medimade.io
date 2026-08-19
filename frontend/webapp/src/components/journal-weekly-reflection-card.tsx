"use client";

import { useCallback, useEffect, useState } from "react";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  fetchJournalWeeklyReflectionRemote,
  getMedimadeApiBase,
  runJournalWeeklyReflectionRemote,
  type JournalWeeklyReflection,
} from "@/lib/medimade-api";

function formatWeekRange(weekStart: string, weekEnd: string): string {
  try {
    const s = new Date(weekStart);
    const e = new Date(weekEnd);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const sy = s.getFullYear();
    const ey = e.getFullYear();
    if (sy === ey) {
      return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
    }
    return `${s.toLocaleDateString(undefined, { ...opts, year: "numeric" })} – ${e.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
  } catch {
    return `${weekStart.slice(0, 10)} – ${weekEnd.slice(0, 10)}`;
  }
}

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return "—";
  }
}

export function JournalWeeklyReflectionCard() {
  const [reflection, setReflection] = useState<JournalWeeklyReflection | null>(null);
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [emptyWeek, setEmptyWeek] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiEnabled = Boolean(getMedimadeApiBase());

  const load = useCallback(async () => {
    if (!apiEnabled) return;
    setLoading(true);
    setError(null);
    try {
      const got = await fetchJournalWeeklyReflectionRemote();
      setReflection(got.reflection);
      setWeekStart(got.weekStart);
      setWeekEnd(got.weekEnd);
      setEmptyWeek(got.empty === true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load weekly reflection");
    } finally {
      setLoading(false);
    }
  }, [apiEnabled]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const on = () => void load();
    window.addEventListener("medimade-session-changed", on);
    return () => window.removeEventListener("medimade-session-changed", on);
  }, [load]);

  const generate = useCallback(
    async (regenerate: boolean) => {
      if (!apiEnabled) return;
      setGenerating(true);
      setError(null);
      try {
        const got = await runJournalWeeklyReflectionRemote({ regenerate });
        setReflection(got.reflection);
        setWeekStart(got.weekStart);
        setWeekEnd(got.weekEnd);
        setEmptyWeek(got.empty === true && !got.reflection);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate weekly reflection");
      } finally {
        setGenerating(false);
      }
    },
    [apiEnabled],
  );

  const weekLabel =
    weekStart && weekEnd ? formatWeekRange(weekStart, weekEnd) : "This week";

  return (
    <section className="mb-8 rounded-2xl border border-accent/25 bg-accent-soft/10 p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-accent-link">
            Weekly reflection
          </p>
          <h2 className="mt-1 font-display text-2xl font-medium tracking-tight text-foreground">
            A gentle letter for {weekLabel.toLowerCase()}
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            An end-of-week note written to you — woven from this week&apos;s journal
            entries and what came up while creating meditations.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void generate(Boolean(reflection))}
            disabled={!apiEnabled || generating}
            className="cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-on-accent shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {generating
              ? "Writing…"
              : reflection
                ? "Rewrite letter"
                : "Write my letter"}
          </button>
        </div>
      </div>

      {!apiEnabled ? (
        <p className="mt-4 text-sm text-muted">
          Set{" "}
          <code className="rounded bg-background px-1 py-0.5">
            NEXT_PUBLIC_MEDIMADE_API_URL
          </code>{" "}
          to enable weekly reflections.
        </p>
      ) : loading ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : emptyWeek && !reflection ? (
        <p className="mt-4 text-sm text-muted">
          Nothing from this week yet — journal a little or create a meditation, then
          come back for your letter.
        </p>
      ) : reflection?.letterMarkdown?.trim() ? (
        <div className="relative mt-5 rounded-2xl border border-accent/20 bg-background/70 px-5 py-5 pl-8 shadow-inner">
          <span
            className="absolute left-3 top-5 select-none text-accent-link/70"
            aria-hidden
          >
            ✦
          </span>
          <div className="font-hand text-[16px] italic leading-relaxed text-foreground/90 [&_p]:mb-4 [&_p:last-child]:mb-0">
            <ChatMarkdown text={reflection.letterMarkdown} />
          </div>
          <p className="mt-4 text-xs text-muted">
            Written {formatTs(reflection.meta.generatedAt)}
            {reflection.meta.journalEntryCount || reflection.meta.meditationChatCount
              ? ` · ${reflection.meta.journalEntryCount} journal ${reflection.meta.journalEntryCount === 1 ? "entry" : "entries"}, ${reflection.meta.meditationChatCount} meditation ${reflection.meta.meditationChatCount === 1 ? "chat" : "chats"}`
              : ""}
          </p>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">
          No letter yet for this week. Tap &ldquo;Write my letter&rdquo; when you&apos;re
          ready.
        </p>
      )}

      {error ? (
        <p className="mt-3 text-sm text-danger">{error}</p>
      ) : null}
    </section>
  );
}
