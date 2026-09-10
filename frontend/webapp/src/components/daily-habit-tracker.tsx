"use client";

import { useEffect, useState } from "react";
import {
  DAILY_HABITS_CHANGED_EVENT,
  computeLocalDailyStatus,
  formatHabitDateLabel,
  localDateKey,
  setLocalManualCheck,
  type DailyHabitPillar,
  type DailyStatus,
} from "@/lib/daily-habits";
import {
  fetchDashboardDailyStatus,
  putDashboardDailyManualCheck,
} from "@/lib/medimade-api";
import { isMedimadeSessionActive } from "@/lib/auth-session";
import {
  loadJournalStoreRaw,
  withoutDemoJournalEntries,
} from "@/lib/journal-storage";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import { subscribeIdeateCloud } from "@/lib/ideate-cloud";

const ITEMS: {
  pillar: DailyHabitPillar;
  name: string;
  help: string;
}[] = [
  {
    pillar: "gratitude",
    name: "Add a gratitude",
    help: "Write one thing you're grateful for in Journal → Gratitudes",
  },
  {
    pillar: "meditation",
    name: "Do a meditation",
    help: "Listen to any meditation in your library — or create a new one",
  },
  {
    pillar: "lifeArea",
    name: "Make progress on a life area",
    help: "Complete any task or subtask in Ideate, or add a thought",
  },
];

function emptyStatus(): DailyStatus {
  return {
    gratitude: false,
    meditation: false,
    lifeArea: false,
    streak: 0,
    fullStreak: 0,
    partialStreak: 0,
    fullStreakRecord: 0,
    partialStreakRecord: 0,
  };
}

function localStatusNow(): DailyStatus {
  const entries = withoutDemoJournalEntries(loadJournalStoreRaw()).entries;
  const ideate = loadIdeateStore();
  return computeLocalDailyStatus(entries, ideate, localDateKey());
}

function StreakDots({
  streak,
  todayComplete,
}: {
  streak: number;
  todayComplete: boolean;
}) {
  const filled = Math.min(Math.max(0, streak), 7);
  // Fill left → right; glow the newest filled day when today counts.
  return (
    <div className="mt-2 flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => {
        const on = i < filled;
        const glow = on && todayComplete && i === filled - 1;
        return (
          <span
            key={i}
            className={
              on
                ? glow
                  ? "h-2 w-2 rounded-full bg-gold shadow-[0_0_6px_color-mix(in_srgb,var(--gold)_70%,transparent)]"
                  : "h-2 w-2 rounded-full bg-gold/85"
                : "h-2 w-2 rounded-full border border-[color-mix(in_srgb,var(--border)_90%,var(--muted))] bg-transparent"
            }
          />
        );
      })}
    </div>
  );
}

function StreakBlock({
  label,
  days,
  help,
  record,
  showDots,
  todayComplete,
}: {
  label: string;
  days: number;
  help: string;
  record: number;
  showDots?: boolean;
  todayComplete?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="font-display text-[28px] font-normal leading-none text-accent-link sm:text-[32px]">
          {days}
        </span>
        <span className="text-[13px] text-muted">days</span>
      </p>
      <p className="mt-1.5 text-[11px] leading-[1.4] text-muted">{help}</p>
      <p className="mt-1 text-[10px] tabular-nums text-muted/80">
        Record · {record} {record === 1 ? "day" : "days"}
      </p>
      {showDots ? (
        <StreakDots streak={days} todayComplete={Boolean(todayComplete)} />
      ) : null}
    </div>
  );
}

function HabitCheckbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      className={
        checked
          ? "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-gold text-[11px] font-semibold leading-none text-[var(--on-accent,#3D2E10)]"
          : "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--border)_100%,var(--muted))] bg-transparent"
      }
    >
      {checked ? "✓" : null}
    </button>
  );
}

/** Three-column daily habit row for the signed-in home dashboard. */
export function DailyHabitTracker() {
  const [status, setStatus] = useState<DailyStatus>(emptyStatus);
  const [dateLabel, setDateLabel] = useState("");
  const dateKey = localDateKey();

  useEffect(() => {
    setDateLabel(formatHabitDateLabel(new Date()));
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyLocal = () => {
      if (cancelled) return;
      setStatus(localStatusNow());
    };

    const refresh = () => {
      applyLocal();
      if (!isMedimadeSessionActive()) return;
      void fetchDashboardDailyStatus({ dateKey })
        .then((remote) => {
          if (cancelled) return;
          const local = localStatusNow();
          // OR flags; take the higher streak figures so undeployed API
          // (missing partial fields → 0) cannot wipe a correct local count.
          setStatus({
            gratitude: remote.gratitude || local.gratitude,
            meditation: remote.meditation || local.meditation,
            lifeArea: remote.lifeArea || local.lifeArea,
            streak: Math.max(remote.fullStreak, local.fullStreak),
            fullStreak: Math.max(remote.fullStreak, local.fullStreak),
            partialStreak: Math.max(remote.partialStreak, local.partialStreak),
            fullStreakRecord: Math.max(
              remote.fullStreakRecord,
              local.fullStreakRecord,
            ),
            partialStreakRecord: Math.max(
              remote.partialStreakRecord,
              local.partialStreakRecord,
            ),
          });
        })
        .catch(() => {
          /* keep local */
        });
    };

    refresh();
    const unsubIdeate = subscribeIdeateCloud(refresh);
    window.addEventListener(DAILY_HABITS_CHANGED_EVENT, refresh);
    window.addEventListener("medimade-session-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      unsubIdeate();
      window.removeEventListener(DAILY_HABITS_CHANGED_EVENT, refresh);
      window.removeEventListener("medimade-session-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [dateKey]);

  const doneCount = ITEMS.filter((item) => status[item.pillar]).length;
  const todayComplete = doneCount === 3;
  const todayPartial = doneCount >= 1;

  const toggle = (pillar: DailyHabitPillar) => {
    const next = !status[pillar];
    setLocalManualCheck(pillar, next, dateKey);
    // Recompute streaks immediately so today counts as soon as a daily is done.
    setStatus(localStatusNow());
    if (isMedimadeSessionActive()) {
      void putDashboardDailyManualCheck({
        dateKey,
        pillar,
        checked: next,
      })
        .then(() =>
          fetchDashboardDailyStatus({ dateKey }).then((remote) => {
            const local = localStatusNow();
            setStatus({
              gratitude: remote.gratitude || local.gratitude,
              meditation: remote.meditation || local.meditation,
              lifeArea: remote.lifeArea || local.lifeArea,
              streak: Math.max(remote.fullStreak, local.fullStreak),
              fullStreak: Math.max(remote.fullStreak, local.fullStreak),
              partialStreak: Math.max(remote.partialStreak, local.partialStreak),
              fullStreakRecord: Math.max(
                remote.fullStreakRecord,
                local.fullStreakRecord,
              ),
              partialStreakRecord: Math.max(
                remote.partialStreakRecord,
                local.partialStreakRecord,
              ),
              [pillar]: next || remote[pillar] || local[pillar],
            });
          }),
        )
        .catch(() => {
          setStatus(localStatusNow());
        });
    }
  };

  return (
    <div
      className="w-full border-y border-border"
      style={{ borderTopWidth: 0.5, borderBottomWidth: 0.5 }}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-5 sm:flex-row sm:items-start sm:gap-8">
        <div className="flex w-full shrink-0 gap-6 sm:w-auto sm:gap-8">
          <div className="min-w-0 flex-1 sm:w-[148px] sm:flex-none">
            <StreakBlock
              label="Full streak"
              days={status.fullStreak}
              help="Consecutive days you did all your dailies"
              record={status.fullStreakRecord}
              showDots
              todayComplete={todayComplete}
            />
          </div>
          <div className="min-w-0 flex-1 sm:w-[148px] sm:flex-none">
            <StreakBlock
              label="Partial streak"
              days={status.partialStreak}
              help="Consecutive days you did at least one of your dailies"
              record={status.partialStreakRecord}
              showDots
              todayComplete={todayPartial}
            />
          </div>
        </div>

        {/* Today */}
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            Today
          </p>
          <ul className="mt-2 space-y-3">
            {ITEMS.map((item) => {
              const checked = status[item.pillar];
              return (
                <li key={item.pillar} className="flex items-start gap-2.5">
                  <span className="pt-0.5">
                    <HabitCheckbox
                      checked={checked}
                      onToggle={() => toggle(item.pillar)}
                      label={item.name}
                    />
                  </span>
                  <span className="min-w-0">
                    <span
                      className={
                        checked
                          ? "block text-[13px] font-medium text-muted line-through"
                          : "block text-[13px] font-medium text-foreground"
                      }
                    >
                      {item.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-[1.4] text-muted">
                      {item.help}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Date summary */}
        <div className="shrink-0 text-left sm:w-[120px] sm:text-right">
          <p className="text-[13px] text-muted">{dateLabel}</p>
          <p className="mt-1 text-[12px] italic text-muted">
            {doneCount} of 3 done
          </p>
        </div>
      </div>
    </div>
  );
}
