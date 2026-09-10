"use client";

/**
 * Insights for a life-area — structured synthesis persists on the dream (ideate cloud).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconRefresh } from "@tabler/icons-react";
import {
  buildLifeAreaInsightSnapshot,
  streamLifeAreaInsight,
  type InsightSignal,
} from "@/lib/plan-insights";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import {
  prependLifeAreaInsight,
  type LifeAreaInsightEntry,
  type LifeAreaInsightSection,
  type LifeAreaInsightSectionId,
  type PlanDream,
} from "@/lib/plan-dreams";

export { insightsContentFingerprint } from "@/lib/plan-insights";

type Props = {
  dream: PlanDream;
  /** Persist insight history onto the dream (cloud-backed ideate store). */
  onPatch: (partial: Partial<PlanDream>) => void;
  /** Bump when ideate store refreshes so signals stay current. */
  storeTick?: number;
  /** Sidebar card vs dedicated Insights tab. */
  variant?: "card" | "page";
};

const SECTION_ORDER: LifeAreaInsightSectionId[] = [
  "working",
  "not_working",
  "patterns",
  "next",
];

function formatInsightDate(iso: string): string {
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

function SignalsStrip({
  signals,
  isPage,
}: {
  signals: InsightSignal[];
  isPage: boolean;
}) {
  if (signals.length === 0) return null;
  return (
    <div
      className={
        isPage
          ? "mt-8 border-t border-border/70 pt-6"
          : "mt-4 border-t border-border/70 pt-3"
      }
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        At a glance
      </h3>
      <ul className={isPage ? "mt-4 grid gap-4 sm:grid-cols-2" : "mt-3 space-y-3"}>
        {signals.map((s) => (
          <li key={s.id}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
              {s.label}
            </p>
            <p
              className={
                isPage
                  ? "mt-1 text-[14px] leading-relaxed text-[#1E2530] dark:text-foreground"
                  : "mt-0.5 text-[13px] leading-relaxed text-foreground"
              }
            >
              {s.detail}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InsightSections({
  sections,
  isPage,
}: {
  sections: LifeAreaInsightSection[];
  isPage: boolean;
}) {
  const body = sections.filter((s) => SECTION_ORDER.includes(s.id));
  if (body.length === 0) return null;

  const ordered = SECTION_ORDER.map((id) =>
    body.find((s) => s.id === id),
  ).filter((s): s is LifeAreaInsightSection => Boolean(s));

  return (
    <div
      className={
        isPage
          ? "mt-8 grid gap-6 border-t border-border/70 pt-6 sm:grid-cols-2"
          : "mt-4 space-y-4 border-t border-border/70 pt-3"
      }
    >
      {ordered.map((s) => (
        <section
          key={s.id}
          className={
            s.id === "next" && isPage ? "sm:col-span-2" : undefined
          }
        >
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {s.label}
          </h3>
          <p
            className={
              isPage
                ? "mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-[#1E2530] dark:text-foreground"
                : "mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground"
            }
          >
            {s.body}
          </p>
        </section>
      ))}
    </div>
  );
}

function PastInsightsList({
  past,
  isPage,
}: {
  past: LifeAreaInsightEntry[];
  isPage: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (past.length === 0) return null;

  return (
    <div
      className={
        isPage
          ? "mt-10 border-t border-border/70 pt-8"
          : "mt-5 border-t border-border/70 pt-4"
      }
    >
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Past insights
      </h3>
      <ul className="mt-3">
        {past.map((entry) => {
          const open = openId === entry.id;
          const preview =
            entry.text.length > 140
              ? `${entry.text.slice(0, 139).trimEnd()}…`
              : entry.text;
          return (
            <li
              key={entry.id}
              className="border-b border-border/80 first:border-t"
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : entry.id)}
                className="flex w-full cursor-pointer items-start gap-4 py-3 text-left"
              >
                <span className="w-24 shrink-0 text-[12px] text-muted">
                  {formatInsightDate(entry.createdAt)}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={
                      isPage
                        ? "block text-[14px] leading-relaxed text-[#8A8272]"
                        : "block text-[13px] leading-relaxed text-[#8A8272]"
                    }
                  >
                    {open ? entry.text : preview}
                  </span>
                  {open && entry.sections && entry.sections.length > 1 ? (
                    <div className="mt-3 space-y-3">
                      {entry.sections
                        .filter((s) => s.id !== "summary")
                        .map((s) => (
                          <div key={s.id}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                              {s.label}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[#8A8272]">
                              {s.body}
                            </p>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PlanInsightsPanel({
  dream,
  onPatch,
  storeTick = 0,
  variant = "card",
}: Props) {
  const snapshot = useMemo(() => {
    void storeTick;
    return buildLifeAreaInsightSnapshot(dream, loadIdeateStore());
  }, [dream, storeTick]);

  const history = dream.insights ?? [];
  const latest = history[0] ?? null;
  const past = history.slice(1);

  const [streamText, setStreamText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const summaryText = loading
    ? streamText
    : latest?.sections?.find((s) => s.id === "summary")?.body ||
      latest?.text ||
      "";
  const sections =
    !loading && latest?.sections?.length ? latest.sections : [];

  const fingerprintAtRefresh = latest?.fingerprint ?? "";
  const isStale =
    Boolean(latest) &&
    fingerprintAtRefresh !== "" &&
    snapshot.fingerprint !== fingerprintAtRefresh;

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setStreamText("");
    try {
      const store = loadIdeateStore();
      const snap = buildLifeAreaInsightSnapshot(dream, store);
      const parsed = await streamLifeAreaInsight(
        dream,
        (chunk) => {
          setStreamText((prev) => prev + chunk);
        },
        store,
      );
      const body = (parsed.text.trim() || snap.emptyHint).trim();
      setStreamText(body);
      const updated = prependLifeAreaInsight(dream, {
        text: body,
        fingerprint: snap.fingerprint,
        sections: parsed.sections,
      });
      onPatch({ insights: updated.insights, updatedAt: updated.updatedAt });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn’t refresh insights.");
    } finally {
      setLoading(false);
    }
  }, [dream, onPatch]);

  useEffect(() => {
    setStreamText("");
    setErr(null);
  }, [dream.id]);

  const isPage = variant === "page";
  const showPlaceholder = !latest && !loading && !summaryText;

  return (
    <aside
      aria-label="Insights"
      className={
        isPage
          ? "select-none"
          : "select-none rounded-2xl border border-border bg-card p-4 shadow-sm"
      }
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          className={
            isPage
              ? "inline-flex items-center gap-2 font-display text-2xl font-medium text-[#1E2530] dark:text-foreground"
              : "inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted"
          }
        >
          Insights
          {isStale ? (
            <span
              className="inline-block size-1.5 shrink-0 rounded-full bg-[#B8703A]/70"
              title="Edited since last refresh"
              aria-hidden
            />
          ) : null}
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh insights"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          <IconRefresh
            className={`size-[16px] ${loading ? "animate-spin" : ""}`}
            stroke={1.75}
            aria-hidden
          />
        </button>
      </div>
      {isStale ? (
        <p className="mt-1 text-[10px] leading-snug text-[#B8A98A]/80">
          Edited since last refresh
        </p>
      ) : null}
      {latest && !loading ? (
        <p className="mt-1 text-[11px] text-muted">
          {formatInsightDate(latest.createdAt)}
        </p>
      ) : null}

      {showPlaceholder ? (
        <p
          className={
            isPage
              ? "mt-6 text-[15px] leading-relaxed text-muted"
              : "mt-2.5 text-[13px] leading-relaxed text-muted"
          }
        >
          {snapshot.canSynthesize
            ? "Refresh for a full read across vision, thoughts, tasks, blockers, and check-ins."
            : snapshot.emptyHint}
        </p>
      ) : (
        <>
          <p
            className={
              isPage
                ? "mt-6 whitespace-pre-wrap font-display text-[20px] italic leading-[1.55] text-[#8A8272]"
                : "mt-2.5 whitespace-pre-wrap text-[13px] italic leading-relaxed text-[#8A8272]"
            }
          >
            {summaryText || (loading ? "Listening…" : "")}
          </p>
          {!loading ? (
            <InsightSections sections={sections} isPage={isPage} />
          ) : null}
        </>
      )}

      {err ? (
        <p className="mt-2 text-sm text-danger">{err}</p>
      ) : null}

      <SignalsStrip signals={snapshot.signals} isPage={isPage} />

      <PastInsightsList past={past} isPage={isPage} />
    </aside>
  );
}
