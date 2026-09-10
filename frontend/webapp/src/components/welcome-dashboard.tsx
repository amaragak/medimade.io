"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import {
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
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
  formatWhen,
} from "@/components/library-meditation-card";
import {
  formatJournalEntryDate,
  isDemoJournalEntry,
  loadJournalStoreRaw,
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

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

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
      className="inline-flex items-center justify-center rounded-xl border border-marketing-ink/20 bg-transparent px-4 py-2.5 text-sm font-semibold text-marketing-ink transition-colors hover:bg-marketing-ink/[0.04]"
    >
      {children}
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
                className="flex cursor-pointer items-start justify-between gap-4 py-3 transition-colors hover:bg-marketing-ink/[0.03]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-marketing-ink/80">
                    {row.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-marketing-muted">
                    {row.meta}
                  </span>
                </span>
                <span className="shrink-0 pt-0.5 text-[12px] tabular-nums text-marketing-muted">
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

function LifeAreaCards({
  dreams,
  creationIndexById,
}: {
  dreams: PlanDream[];
  creationIndexById: Map<string, number>;
}) {
  const preview = dreams.slice(0, 4);
  return (
    <ul className="grid grid-cols-2 gap-[10px] sm:grid-cols-4">
      {preview.map((d) => {
        const snippet = lifeAreaSnippet(d);
        const bgVars = lifeAreaCardBgVars(creationIndexById.get(d.id) ?? 0);
        const lastInteracted = formatCheckInDate(d.updatedAt || d.createdAt);
        return (
          <li key={d.id} className="min-w-0">
            <Link
              href={`/ideate/goal/${encodeURIComponent(d.id)}`}
              className="life-area-card group relative flex aspect-square cursor-pointer flex-col rounded-[4px] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.08)] transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-[0_16px_40px_rgba(0,0,0,0.16),0_4px_12px_rgba(0,0,0,0.1)] dark:shadow-[0_8px_24px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.3)] dark:hover:shadow-[0_16px_40px_rgba(0,0,0,0.55),0_4px_12px_rgba(0,0,0,0.35)] sm:p-5"
              style={bgVars}
            >
              <h3 className="shrink-0 pr-1 font-display text-lg font-medium leading-snug tracking-tight text-[#1E2530] dark:text-[#F4F0E8] sm:text-xl">
                {d.title.trim() || "Untitled"}
              </h3>
              <p
                className={`mt-1.5 line-clamp-3 min-h-0 flex-1 font-sans text-[13px] leading-relaxed text-[rgba(60,35,15,0.6)] dark:text-[#A8B0BC] ${
                  snippet ? "" : "italic"
                }`}
              >
                {snippet ?? "Nothing written yet"}
              </p>
              <p className="mt-auto shrink-0 pt-2 pr-9 font-sans text-[10px] leading-snug text-[rgba(60,35,15,0.4)] dark:text-[#A8B0BC]/70">
                Last interacted on {lastInteracted}
              </p>
              <span
                aria-hidden
                className="pointer-events-none absolute bottom-3 right-3 inline-flex h-8 w-8 translate-x-1 items-center justify-center rounded-full border border-[#1E2530] bg-transparent text-[#1E2530] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 max-md:hidden dark:border-[#F4F0E8] dark:text-[#F4F0E8]"
              >
                <IconArrowRight size={14} stroke={2} />
              </span>
            </Link>
          </li>
        );
      })}
      {dreams.length === 0 ? (
        <li className="min-w-0">
          <Link
            href="/ideate/my?new=1"
            aria-label="Add new life area"
            className="group flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-[4px] border-2 border-dashed bg-transparent transition-[border-color] duration-200"
            style={{ borderColor: "rgba(180,140,80,0.35)" }}
          >
            <span
              className="font-sans font-light leading-none text-[rgba(180,140,80,0.45)]"
              style={{ fontSize: "32px" }}
              aria-hidden
            >
              +
            </span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

function DashboardBand({
  bandClass,
  eyebrow,
  stat,
  actions,
  aside,
}: {
  bandClass: string;
  eyebrow: string;
  stat: string;
  actions: ReactNode;
  aside: ReactNode;
}) {
  return (
    <section className={`w-full ${bandClass}`}>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 sm:px-6 md:grid-cols-2 md:items-start md:gap-10 md:px-7">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-marketing-eyebrow">
            {eyebrow}
          </p>
          <h2 className="mt-2 font-display text-[26px] font-normal leading-snug tracking-tight text-marketing-ink">
            {stat}
          </h2>
          <div className="mt-5 flex flex-wrap gap-2">{actions}</div>
        </div>
        <div className="min-w-0">{aside}</div>
      </div>
    </section>
  );
}

function IdeateDashboardBand({
  stat,
  actions,
  dreams,
  creationIndexById,
}: {
  stat: string;
  actions: ReactNode;
  dreams: PlanDream[];
  creationIndexById: Map<string, number>;
}) {
  return (
    <section className="w-full bg-marketing-band-ideate">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-marketing-eyebrow">
              Ideate
            </p>
            <h2 className="mt-2 font-display text-[26px] font-normal leading-snug tracking-tight text-marketing-ink">
              {stat}
            </h2>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>
        </div>
        <div className="mt-5">
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
    const apply = (entries: JournalEntry[]) => {
      const real = entries.filter((e) => !isDemoJournalEntry(e));
      const sorted = [...real].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt).getTime() -
          new Date(a.updatedAt || a.createdAt).getTime(),
      );
      setJournalEntries(sorted);
    };
    apply(withoutDemoJournalEntries(loadJournalStoreRaw()).entries);
    void fetchJournalStoreRemote()
      .then((remote) => {
        if (remote?.entries) apply(remote.entries);
      })
      .catch(() => {
        /* keep local */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const items = await listLibraryMeditations();
        const visible = items.filter(
          (x) => x.catalogued && x.archived !== true && x.isDraft !== true,
        );
        visible.sort((a, b) =>
          (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
        );
        if (!cancelled) setMeditations(visible);
      } catch {
        if (!cancelled) setMeditations([]);
      } finally {
        if (!cancelled) setLibraryReady(true);
      }
    })();
    return () => {
      cancelled = true;
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

  const meditateRecent: RecentRow[] = meditations.slice(0, 3).map((m, i) => ({
    key: m.sk || m.id || `m-${i}`,
    href: "/meditate/library/creations",
    title: m.title?.trim() || "Untitled",
    meta: [m.meditationStyle?.trim(), m.speakerName?.trim()]
      .filter(Boolean)
      .join(" · ") || "Personalised practice",
    trailing:
      formatDuration(m.durationSeconds) !== "—"
        ? formatDuration(m.durationSeconds)
        : formatWhen(m.createdAt),
  }));

  const journalRecent: RecentRow[] = journalEntries.slice(0, 3).map((e) => ({
    key: e.id,
    href: `/journal/my/${encodeURIComponent(e.id)}`,
    title: e.title.trim() || "Untitled entry",
    meta: "Journal entry",
    trailing: formatJournalEntryDate(e.updatedAt || e.createdAt),
  }));

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
          actions={
            <>
              <NavPrimary href="/meditate/create">Create new</NavPrimary>
              <NavGhost href="/meditate/library/creations">Library</NavGhost>
              <NavGhost href="/meditate/library/programs">Programs</NavGhost>
              <NavGhost href="/meditate/library/community">Community</NavGhost>
              <NavGhost href="/meditate/sounds">Sounds</NavGhost>
            </>
          }
          aside={<RecentColumn rows={meditateRecent} />}
        />
        <DashboardBand
          bandClass="bg-marketing-band-d"
          eyebrow="Journal"
          stat={journalStat}
          actions={
            <>
              <NavPrimary href="/journal/my?new=1">New entry</NavPrimary>
              <NavGhost href="/journal/my">Entries</NavGhost>
              <NavGhost href="/journal/my/gratitudes">Gratitudes</NavGhost>
              <NavGhost href="/journal/my/insights">Insights</NavGhost>
            </>
          }
          aside={<RecentColumn rows={journalRecent} />}
        />
        <IdeateDashboardBand
          stat={ideateStat}
          actions={
            <>
              <NavPrimary href="/ideate/my?new=1">Add a life area</NavPrimary>
              <NavGhost href="/ideate/my">Overview</NavGhost>
              <NavGhost href="/ideate/my/vision-board">Vision board</NavGhost>
            </>
          }
          dreams={dreams}
          creationIndexById={creationIndexById}
        />
        <DashboardBand
          bandClass="bg-marketing-band-a"
          eyebrow="Focus"
          stat="Sit with one task at a time."
          actions={<NavPrimary href="/focus">Open Focus</NavPrimary>}
          aside={<RecentColumn rows={[]} />}
        />
      </div>
    </div>
  );
}
