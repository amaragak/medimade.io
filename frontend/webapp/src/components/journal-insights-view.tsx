"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchJournalInsightsRemote,
  getMedimadeApiBase,
  getMedimadeSessionJwt,
  runJournalInsightsRemote,
  type JournalInsights,
  type JournalInsightsTopicId,
} from "@/lib/medimade-api";
import { ChatMarkdown } from "@/components/chat-markdown";

const TOPIC_ORDER: Array<{ id: JournalInsightsTopicId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "emotions", label: "Emotions & mood patterns" },
  { id: "stress", label: "Stress & coping" },
  { id: "health", label: "Health & body" },
  { id: "relationships", label: "Relationships" },
  { id: "identity", label: "Identity & self-image" },
  { id: "worldview", label: "Worldview" },
  { id: "work", label: "Work" },
  { id: "projects", label: "Projects" },
  { id: "ideas", label: "Ideas" },
  { id: "values", label: "Values & priorities" },
  { id: "habits", label: "Habits & routines" },
  { id: "decisions", label: "Decisions & uncertainty" },
  { id: "growth", label: "Growth & learning" },
];

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

export function JournalInsightsView() {
  const [insights, setInsights] = useState<JournalInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiEnabled = Boolean(getMedimadeApiBase());

  const load = useCallback(async () => {
    if (!apiEnabled) return;
    if (!getMedimadeSessionJwt()) return;
    setLoading(true);
    setError(null);
    try {
      const got = await fetchJournalInsightsRemote();
      setInsights(got);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load insights");
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

  const refresh = useCallback(async () => {
    if (!apiEnabled) return;
    if (!getMedimadeSessionJwt()) return;
    setRefreshing(true);
    setError(null);
    try {
      const got = await runJournalInsightsRemote({ mode: "regenerate" });
      setInsights(got);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refresh insights");
    } finally {
      setRefreshing(false);
    }
  }, [apiEnabled]);

  const topicsById = useMemo(() => {
    const map = new Map<JournalInsightsTopicId, { summaryMarkdown: string; updatedAt: string }>();
    for (const t of insights?.topics ?? []) {
      map.set(t.topicId, { summaryMarkdown: t.summaryMarkdown, updatedAt: t.updatedAt });
    }
    return map;
  }, [insights]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6 sm:px-6">
      <div className="mb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div>
            <h1 className="font-display text-3xl font-medium tracking-tight">
              Journal insights
            </h1>
            <p className="mt-2 text-muted">
              Rolling summaries by topic from your journal entries. Use Refresh to
              update insights from new entries.
            </p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={!apiEnabled || !getMedimadeSessionJwt() || refreshing}
            className="shrink-0 cursor-pointer rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 dark:text-deep"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-card p-4 text-sm">
          {!apiEnabled ? (
            <p className="text-muted">
              Set <code className="rounded bg-background px-1 py-0.5">NEXT_PUBLIC_MEDIMADE_API_URL</code>{" "}
              to enable cloud journal + insights.
            </p>
          ) : !getMedimadeSessionJwt() ? (
            <p className="text-muted">
              Sign in to load cloud insights for your journal.{" "}
              <Link
                href="/login"
                className="cursor-pointer font-medium text-accent underline-offset-2 hover:underline"
              >
                Sign in
              </Link>
            </p>
          ) : loading ? (
            <p className="text-muted">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Last run
                </div>
                <div className="mt-1 text-foreground">
                  {formatTs(insights?.meta.lastRunAt)}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Processed through
                </div>
                <div className="mt-1 text-foreground">
                  {formatTs(insights?.meta.lastProcessedMaxUpdatedAt ?? null)}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Model
                </div>
                <div className="mt-1 text-foreground">
                  {insights?.meta.model ?? "—"}
                </div>
              </div>
            </div>
          )}
          {error ? (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">
        {TOPIC_ORDER.map((t) => {
          const row = topicsById.get(t.id);
          const md = row?.summaryMarkdown?.trim() ?? "";
          return (
            <section
              key={t.id}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                <h2 className="text-base font-semibold text-foreground">{t.label}</h2>
                <div className="text-xs text-muted">
                  Updated {formatTs(row?.updatedAt)}
                </div>
              </div>
              <div className="mt-3 text-sm leading-relaxed text-foreground">
                {md ? (
                  <ChatMarkdown text={md} />
                ) : (
                  <p className="text-muted">
                    No summary yet. Click Refresh to generate.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

