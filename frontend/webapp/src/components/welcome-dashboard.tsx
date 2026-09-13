"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import {
  ensureMedimadeSession,
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
  isMedimadeSessionActive,
} from "@/lib/auth-session";
import {
  pullIdeateStoreFromCloud,
  subscribeIdeateCloud,
} from "@/lib/ideate-cloud";
import { isDemoIdeateDream } from "@/lib/ideate-demo-seed";
import { lifeAreaCardBgVars } from "@/lib/ideate-life-area-colors";
import {
  formatDuration,
} from "@/components/library-meditation-card";
import { useLibraryPlayer } from "@/components/library-player-provider";
import {
  formatJournalEntryDate,
  isDemoJournalEntry,
  loadJournalStoreRaw,
  stripHtmlToText,
  withoutDemoJournalEntries,
  type JournalEntry,
} from "@/lib/journal-storage";
import {
  fetchJournalStoreRemote,
  listLibraryMeditations,
  type LibraryMeditationItem,
} from "@/lib/medimade-api";
import { dreamExcerpt, type PlanDream } from "@/lib/plan-dreams";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import { DailyHabitTracker } from "@/components/daily-habit-tracker";
import { timeOfDayGreeting } from "@/lib/time-of-day-greeting";

function greetingName(): string {
  const email = getMedimadeSessionEmail()?.trim().toLowerCase() ?? "";
  if (email.startsWith("guest@")) return "Guest";
  const raw = getMedimadeSessionDisplayName()?.trim();
  if (!raw || /^guest$/i.test(raw)) return "Guest";
  return raw.split(/\s+/)[0] || "Guest";
}

function journalEntriesThisMonth(entries: JournalEntry[]): number {
  const now = new Date();
  return entries.filter((e) => {
    const d = new Date(e.createdAt || e.updatedAt);
    return (
      !Number.isNaN(d.getTime()) &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear()
    );
  }).length;
}

function lifeAreaSnippet(d: PlanDream): string | null {
  const raw = (d.dreamText || d.firstThought || d.visionText || "").trim();
  if (!raw) return null;
  const excerpt = dreamExcerpt(d);
  return excerpt === "—" ? null : excerpt;
}

function formatCheckInDate(iso: string | null): string {
  if (!iso) return "—";
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

function NavPrimary({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-xl accent-fill-gradient px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
    >
      {children}
    </Link>
  );
}

function NavGhost({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-marketing-ink/20 bg-transparent px-4 py-2.5 text-sm font-semibold text-marketing-ink transition-colors hover:bg-marketing-ink/[0.04]"
    >
      {children}
      <IconArrowRight size={14} stroke={2} aria-hidden className="shrink-0" />
    </Link>
  );
}

type RecentRow = {
  key: string;
  href: string;
  title: string;
  meta: string;
  trailing: string;
};

function journalEntryExcerpt(e: JournalEntry): string {
  const t = stripHtmlToText(e.contentHtml).trim();
  return t || "Empty entry";
}

function RecentColumn({ rows }: { rows: RecentRow[] }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-marketing-eyebrow">
        Recent
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 border-t border-marketing-ink/10 pt-3 text-[13px] text-marketing-muted">
          Nothing recent yet.
        </p>
      ) : (
        <ul className="mt-1">
          {rows.map((row) => (
            <li
              key={row.key}
              className="border-b border-marketing-ink/10 first:border-t"
            >
              <Link
                href={row.href}
                className="flex cursor-pointer items-center justify-between gap-4 py-3 transition-colors hover:bg-marketing-ink/[0.03]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold text-marketing-ink">
                    {row.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-marketing-muted">
                    {row.meta}
                  </span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[12px] tabular-nums text-marketing-muted">
                  {row.trailing}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentMeditationsColumn({ items }: { items: LibraryMeditationItem[] }) {
  const { playItem, playingS3Key, toggleCurrent, nowPlaying } =
    useLibraryPlayer();

  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-marketing-eyebrow">
        Recent
      </p>
      {items.length === 0 ? (
        <p className="mt-3 border-t border-marketing-ink/10 pt-3 text-[13px] text-marketing-muted">
          Nothing recent yet.
        </p>
      ) : (
        <ul className="mt-1">
          {items.map((m, i) => {
            const key = m.sk || m.id || `m-${i}`;
            const title = m.title?.trim() || "Untitled";
            const meta =
              [m.meditationStyle?.trim(), m.speakerName?.trim()]
                .filter(Boolean)
                .join(" · ") || "Personalised practice";
            const trailing = formatDuration(m.durationSeconds);
            const isActive = Boolean(m.s3Key && nowPlaying?.s3Key === m.s3Key);
            const isPlaying = Boolean(m.s3Key && playingS3Key === m.s3Key);

            return (
              <li
                key={key}
                className="group border-b border-marketing-ink/10 first:border-t"
              >
                <div className="flex items-center gap-3 py-3 transition-colors group-hover:bg-marketing-ink/[0.03]">
                  <Link
                    href="/meditate/library/creations"
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="block truncate text-[13px] font-semibold text-marketing-ink">
                      {title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-marketing-muted">
                      {meta}
                    </span>
                  </Link>
                  <div className="relative flex h-9 min-w-[4.75rem] shrink-0 items-center justify-end">
                    <span
                      className={`whitespace-nowrap pr-1 text-right text-[12px] tabular-nums text-marketing-muted transition-opacity ${
                        isPlaying
                          ? "opacity-0"
                          : "opacity-100 max-md:opacity-0 md:group-hover:opacity-0"
                      }`}
                    >
                      {trailing}
                    </span>
                    <button
                      type="button"
                      aria-label={isPlaying ? "Pause" : `Play ${title}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!m.s3Key) return;
                        if (isActive) toggleCurrent();
                        else playItem(m);
                      }}
                      className={`absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent transition-opacity ${
                        isPlaying
                          ? "opacity-100"
                          : "opacity-100 md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto"
                      }`}
                    >
                      {isPlaying ? (
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                        </svg>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          width="16"
                          height="16"
                          fill="currentColor"
                          aria-hidden
                        >
                          <path d="M8 5v14l11-7L8 5z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LifeAreaCards({
  dreams,
  creationIndexById,
}: {
  dreams: PlanDream[];
  creationIndexById: Map<string, number>;
}) {
  // Caller already sorts by last interacted; keep the three most recent.
  const preview = dreams.slice(0, 3);
  if (dreams.length === 0) {
    return (
      <Link
        href="/ideate/my?new=1"
        aria-label="Add new life area"
        className="flex min-h-[72px] w-full items-center justify-center rounded-[4px] border-2 border-dashed bg-transparent transition-[border-color] duration-200"
        style={{ borderColor: "rgba(180,140,80,0.35)" }}
      >
        <span
          className="font-sans font-light leading-none text-[rgba(180,140,80,0.45)]"
          style={{ fontSize: "28px" }}
          aria-hidden
        >
          +
        </span>
      </Link>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {preview.map((d) => {
        const snippet = lifeAreaSnippet(d);
        const bgVars = lifeAreaCardBgVars(creationIndexById.get(d.id) ?? 0);
        const lastInteracted = formatCheckInDate(d.updatedAt || d.createdAt);
        return (
          <li key={d.id} className="min-w-0">
            <Link
              href={`/ideate/goal/${encodeURIComponent(d.id)}`}
              className="life-area-card group relative flex cursor-pointer items-center gap-4 rounded-[4px] px-4 py-3.5 shadow-[0_4px_14px_rgba(0,0,0,0.08),0_1px_4px_rgba(0,0,0,0.05)] transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_8px_20px_rgba(0,0,0,0.12),0_2px_6px_rgba(0,0,0,0.08)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.35),0_1px_4px_rgba(0,0,0,0.25)] dark:hover:shadow-[0_8px_20px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.3)] sm:px-5"
              style={bgVars}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-base font-medium tracking-tight text-[#1E2530] dark:text-[#F4F0E8] sm:text-lg">
                  {d.title.trim() || "Untitled"}
                </span>
                <span
                  className={`mt-0.5 block truncate font-sans text-[12px] leading-snug text-[rgba(60,35,15,0.6)] dark:text-[#A8B0BC] ${
                    snippet ? "" : "italic"
                  }`}
                >
                  {snippet ?? "Nothing written yet"}
                </span>
              </span>
              <span className="hidden shrink-0 whitespace-nowrap font-sans text-[11px] text-[rgba(60,35,15,0.45)] sm:block dark:text-[#A8B0BC]/70">
                {lastInteracted}
              </span>
              <span
                aria-hidden
                className="inline-flex h-8 w-8 shrink-0 translate-x-1 items-center justify-center rounded-full border border-[#1E2530] bg-transparent text-[#1E2530] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-md:hidden dark:border-[#F4F0E8] dark:text-[#F4F0E8]"
              >
                <IconArrowRight size={14} stroke={2} />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DashboardBand({
  bandClass,
  eyebrow,
  stat,
  nav,
  create,
  aside,
}: {
  bandClass: string;
  eyebrow: string;
  stat: string;
  /** Secondary nav under the stat (e.g. library / journal links). */
  nav?: ReactNode;
  /** Create CTA — flush to the bottom of the column, with top padding. */
  create?: ReactNode;
  aside: ReactNode;
}) {
  return (
    <section className={`w-full ${bandClass}`}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 sm:px-6 md:grid-cols-2 md:items-stretch md:gap-10 md:px-7">
        <div className="flex min-h-0 min-w-0 flex-col">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-marketing-eyebrow">
            {eyebrow}
          </p>
          <h2 className="mt-2 font-display text-[26px] font-normal leading-snug tracking-tight text-marketing-ink">
            {stat}
          </h2>
          {nav ? (
            <div className="mt-5 flex flex-wrap items-center gap-2">{nav}</div>
          ) : null}
          {create ? (
            <div className="mt-5 flex flex-wrap gap-2 md:mt-auto md:pt-5">
              {create}
            </div>
          ) : null}
        </div>
        <div className="min-w-0">{aside}</div>
      </div>
    </section>
  );
}

function IdeateDashboardBand({
  stat,
  nav,
  create,
  dreams,
  creationIndexById,
}: {
  stat: string;
  nav: ReactNode;
  create: ReactNode;
  dreams: PlanDream[];
  creationIndexById: Map<string, number>;
}) {
  return (
    <section className="w-full bg-marketing-band-ideate">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 sm:px-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.55fr)] md:items-stretch md:gap-10 md:px-7">
        <div className="flex min-h-0 min-w-0 flex-col">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-marketing-eyebrow">
            Ideate
          </p>
          <h2 className="mt-2 font-display text-[26px] font-normal leading-snug tracking-tight text-marketing-ink">
            {stat}
          </h2>
          <div className="mt-5 flex flex-wrap items-center gap-2">{nav}</div>
          <div className="mt-5 flex flex-wrap gap-2 md:mt-auto md:pt-5">
            {create}
          </div>
        </div>
        <div className="min-w-0">
          <LifeAreaCards
            dreams={dreams}
            creationIndexById={creationIndexById}
          />
        </div>
      </div>
    </section>
  );
}

/** Signed-in home — welcome + section bands with recent lists. */
export function WelcomeDashboard() {
  const [greeting, setGreeting] = useState("Good morning");
  const [name, setName] = useState("Guest");
  const [dreams, setDreams] = useState<PlanDream[]>([]);
  const [dreamsByCreated, setDreamsByCreated] = useState<PlanDream[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [meditations, setMeditations] = useState<LibraryMeditationItem[]>([]);
  const [libraryReady, setLibraryReady] = useState(false);

  useEffect(() => {
    setGreeting(timeOfDayGreeting());
    setName(greetingName());
  }, []);

  useEffect(() => {
    const syncLifeAreas = () => {
      const next = loadIdeateStore().dreams.filter((d) => !isDemoIdeateDream(d));
      const byUpdated = [...next].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime(),
      );
      const byCreated = [...next].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setDreams(byUpdated);
      setDreamsByCreated(byCreated);
    };
    syncLifeAreas();
    const unsub = subscribeIdeateCloud(syncLifeAreas);
    if (isMedimadeSessionActive()) {
      void pullIdeateStoreFromCloud().finally(syncLifeAreas);
    }
    window.addEventListener("medimade-session-changed", syncLifeAreas);
    return () => {
      unsub();
      window.removeEventListener("medimade-session-changed", syncLifeAreas);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();

    const applyJournal = (entries: JournalEntry[]) => {
      const real = entries.filter((e) => !isDemoJournalEntry(e));
      const sorted = [...real].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime(),
      );
      if (!cancelled) setJournalEntries(sorted);
    };

    const refreshJournal = () => {
      applyJournal(withoutDemoJournalEntries(loadJournalStoreRaw()).entries);
      if (!isMedimadeSessionActive() || !getMedimadeSessionJwt()) return;
      void fetchJournalStoreRemote()
        .then((remote) => {
          if (remote?.entries) applyJournal(remote.entries);
        })
        .catch(() => {
          /* keep local */
        });
    };

    const scheduleLibraryRetry = () => {
      const t = setTimeout(() => {
        timers.delete(t);
        void refreshLibrary({ isRetry: true });
      }, 400);
      timers.add(t);
    };

    const refreshLibrary = async (opts?: { isRetry?: boolean }) => {
      if (!isMedimadeSessionActive()) {
        if (!cancelled) {
          setMeditations([]);
          setLibraryReady(true);
        }
        return;
      }
      try {
        await ensureMedimadeSession();
        if (cancelled) return;
        if (!getMedimadeSessionJwt()) {
          if (!opts?.isRetry) scheduleLibraryRetry();
          else if (!cancelled) setLibraryReady(true);
          return;
        }
        const items = await listLibraryMeditations();
        if (cancelled) return;
        const visible = items.filter(
          (x) => x.catalogued && x.archived !== true && x.isDraft !== true,
        );
        visible.sort((a, b) =>
          (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
        );
        setMeditations(visible);
        setLibraryReady(true);
      } catch {
        if (cancelled) return;
        if (!opts?.isRetry) {
          scheduleLibraryRetry();
          return;
        }
        setMeditations([]);
        setLibraryReady(true);
      }
    };

    refreshJournal();
    void refreshLibrary();

    const onSession = () => {
      refreshJournal();
      void refreshLibrary();
    };
    window.addEventListener("medimade-session-changed", onSession);
    return () => {
      cancelled = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      window.removeEventListener("medimade-session-changed", onSession);
    };
  }, []);

  const creationIndexById = useMemo(() => {
    const m = new Map<string, number>();
    dreamsByCreated.forEach((d, i) => m.set(d.id, i));
    return m;
  }, [dreamsByCreated]);

  const monthJournalCount = journalEntriesThisMonth(journalEntries);

  const meditateStat = !libraryReady
    ? "Loading your library…"
    : meditations.length === 0
      ? "No meditations in your library yet."
      : meditations.length === 1
        ? "1 meditation in your library."
        : `${meditations.length} meditations in your library.`;

  const journalStat =
    journalEntries.length === 0
      ? "No entries this month."
      : monthJournalCount === 0
        ? `${journalEntries.length} ${journalEntries.length === 1 ? "entry" : "entries"} in your journal.`
        : monthJournalCount === 1
          ? "1 entry this month."
          : `${monthJournalCount} entries this month.`;

  const ideateStat =
    dreams.length === 0
      ? "No life areas yet."
      : dreams.length === 1
        ? "1 life area you’re tending."
        : `${dreams.length} life areas you’re tending.`;

  const journalRecent: RecentRow[] = journalEntries.slice(0, 3).map((e) => ({
    key: e.id,
    href: `/journal/my/${encodeURIComponent(e.id)}`,
    title: e.title.trim() || "Untitled entry",
    meta: journalEntryExcerpt(e),
    trailing: formatJournalEntryDate(e.updatedAt || e.createdAt),
  }));

  const recentMeditations = meditations.slice(0, 3);

  return (
    <div className="w-full pb-12">
      <header className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 sm:pt-8">
        <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
          {greeting}, {name}.
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          Pick up where you left off — or start something new.
        </p>
      </header>

      <div className="mt-6">
        <DailyHabitTracker />
      </div>

      <div className="mt-8">
        <DashboardBand
          bandClass="bg-marketing-band-c"
          eyebrow="Meditate"
          stat={meditateStat}
          nav={
            <>
              <NavGhost href="/meditate/library/creations">
                My Creations
              </NavGhost>
              <NavGhost href="/meditate/library/programs">Programs</NavGhost>
              <NavGhost href="/meditate/library/community">Community</NavGhost>
            </>
          }
          create={<NavPrimary href="/meditate/create">+ Create new</NavPrimary>}
          aside={<RecentMeditationsColumn items={recentMeditations} />}
        />
        <DashboardBand
          bandClass="bg-marketing-band-d"
          eyebrow="Journal"
          stat={journalStat}
          nav={
            <>
              <NavGhost href="/journal/my">Entries</NavGhost>
              <NavGhost href="/journal/my/gratitudes">Gratitudes</NavGhost>
              <NavGhost href="/journal/my/insights">Insights</NavGhost>
            </>
          }
          create={
            <NavPrimary href="/journal/my?new=1">+ New entry</NavPrimary>
          }
          aside={<RecentColumn rows={journalRecent} />}
        />
        <IdeateDashboardBand
          stat={ideateStat}
          nav={
            <>
              <NavGhost href="/ideate/my">Overview</NavGhost>
              <NavGhost href="/ideate/my/vision-board">Vision board</NavGhost>
            </>
          }
          create={
            <NavPrimary href="/ideate/my?new=1">+ Add a life area</NavPrimary>
          }
          dreams={dreams}
          creationIndexById={creationIndexById}
        />
        <DashboardBand
          bandClass="bg-marketing-band-a"
          eyebrow="Focus"
          stat="Sit with one task at a time."
          nav={<NavPrimary href="/focus">Open Focus</NavPrimary>}
          aside={<RecentColumn rows={[]} />}
        />
      </div>
    </div>
  );
}
