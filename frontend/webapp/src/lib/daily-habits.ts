/**
 * Daily habit tracker — local play events, manual checks, and status helpers.
 * Server truth lives at GET /dashboard/daily-status; this mirrors for offline/guest.
 */

import {
  isGratitudeEntry,
  localDateKey,
  localDateKeyFromIso,
} from "@/lib/journal-storage";
import type { JournalEntry } from "@/lib/journal-storage";
import type { IdeateStoreV2 } from "@/lib/plan-ideate-store";
import type { PlanDream } from "@/lib/plan-dreams";

export { localDateKey };

export type DailyHabitPillar = "gratitude" | "meditation" | "lifeArea";

export type DailyStatus = {
  gratitude: boolean;
  meditation: boolean;
  lifeArea: boolean;
  streak: number;
};

export type DailyManualChecks = Partial<Record<DailyHabitPillar, boolean>>;

type PlayDayRecord = {
  playStartedAt?: string;
  playProgress60At?: string;
  meditationId?: string;
};

type PlayEventsStore = Record<string, PlayDayRecord>;
type ManualStore = Record<string, DailyManualChecks>;

const PLAY_LS_KEY = "mm_daily_play_events_v1";
const MANUAL_LS_KEY = "mm_daily_manual_v1";

export const DAILY_HABITS_CHANGED_EVENT = "medimade-daily-habits-changed";

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function notifyHabitsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DAILY_HABITS_CHANGED_EVENT));
}

export function loadLocalPlayDay(dateKey = localDateKey()): PlayDayRecord {
  return readJson<PlayEventsStore>(PLAY_LS_KEY, {})[dateKey] ?? {};
}

export function hasLocalMeditationProgress(dateKey = localDateKey()): boolean {
  return Boolean(loadLocalPlayDay(dateKey).playProgress60At);
}

export function recordLocalPlayStarted(opts: {
  meditationId: string;
  at?: string;
  dateKey?: string;
}): void {
  const dateKey = opts.dateKey ?? localDateKey();
  const store = readJson<PlayEventsStore>(PLAY_LS_KEY, {});
  const prev = store[dateKey] ?? {};
  if (prev.playStartedAt) {
    store[dateKey] = {
      ...prev,
      meditationId: opts.meditationId || prev.meditationId,
    };
  } else {
    store[dateKey] = {
      ...prev,
      playStartedAt: opts.at ?? new Date().toISOString(),
      meditationId: opts.meditationId,
    };
  }
  writeJson(PLAY_LS_KEY, store);
  notifyHabitsChanged();
}

export function recordLocalPlayProgress60(opts: {
  meditationId: string;
  at?: string;
  dateKey?: string;
}): void {
  const dateKey = opts.dateKey ?? localDateKey();
  const store = readJson<PlayEventsStore>(PLAY_LS_KEY, {});
  const prev = store[dateKey] ?? {};
  if (prev.playProgress60At) return;
  store[dateKey] = {
    ...prev,
    playStartedAt: prev.playStartedAt ?? opts.at ?? new Date().toISOString(),
    playProgress60At: opts.at ?? new Date().toISOString(),
    meditationId: opts.meditationId || prev.meditationId,
  };
  writeJson(PLAY_LS_KEY, store);
  notifyHabitsChanged();
}

export function loadLocalManualChecks(dateKey = localDateKey()): DailyManualChecks {
  return readJson<ManualStore>(MANUAL_LS_KEY, {})[dateKey] ?? {};
}

export function setLocalManualCheck(
  pillar: DailyHabitPillar,
  checked: boolean,
  dateKey = localDateKey(),
): void {
  const store = readJson<ManualStore>(MANUAL_LS_KEY, {});
  const day = { ...(store[dateKey] ?? {}) };
  if (checked) day[pillar] = true;
  else delete day[pillar];
  store[dateKey] = day;
  writeJson(MANUAL_LS_KEY, store);
  notifyHabitsChanged();
}

export function gratitudeDoneForDate(
  entries: JournalEntry[],
  dateKey: string,
): boolean {
  return entries.some(
    (e) => isGratitudeEntry(e) && localDateKeyFromIso(e.createdAt) === dateKey,
  );
}

function dreamThoughtsToday(dream: PlanDream, dateKey: string): boolean {
  const lists = [dream.dreamEntries, dream.obstacleEntries, dream.visionEntries];
  for (const list of lists) {
    for (const entry of list ?? []) {
      if (entry?.createdAt && localDateKeyFromIso(entry.createdAt) === dateKey) {
        return true;
      }
    }
  }
  return false;
}

export function lifeAreaDoneForDate(
  store: IdeateStoreV2,
  dateKey: string,
): boolean {
  for (const todo of store.todos ?? []) {
    if (todo.isChecked && todo.checkedAt && localDateKeyFromIso(todo.checkedAt) === dateKey) {
      return true;
    }
  }
  for (const sub of store.subtasks ?? []) {
    if (sub.completedAt && localDateKeyFromIso(sub.completedAt) === dateKey) {
      return true;
    }
  }
  for (const dream of store.dreams ?? []) {
    if (dreamThoughtsToday(dream, dateKey)) return true;
  }
  return false;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  return localDateKey(dt);
}

function dayComplete(
  entries: JournalEntry[],
  ideate: IdeateStoreV2,
  dateKey: string,
  playStore: PlayEventsStore,
  manualStore: ManualStore,
): boolean {
  const manual = manualStore[dateKey] ?? {};
  const gratitude =
    Boolean(manual.gratitude) || gratitudeDoneForDate(entries, dateKey);
  const meditation =
    Boolean(manual.meditation) || Boolean(playStore[dateKey]?.playProgress60At);
  const lifeArea =
    Boolean(manual.lifeArea) || lifeAreaDoneForDate(ideate, dateKey);
  return gratitude && meditation && lifeArea;
}

/** Consecutive complete days ending yesterday if today incomplete, else including today. */
export function computeLocalStreak(
  entries: JournalEntry[],
  ideate: IdeateStoreV2,
  todayKey = localDateKey(),
): number {
  const playStore = readJson<PlayEventsStore>(PLAY_LS_KEY, {});
  const manualStore = readJson<ManualStore>(MANUAL_LS_KEY, {});
  let cursor = todayKey;
  if (!dayComplete(entries, ideate, cursor, playStore, manualStore)) {
    cursor = shiftDateKey(todayKey, -1);
  }
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (!dayComplete(entries, ideate, cursor, playStore, manualStore)) break;
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

export function computeLocalDailyStatus(
  entries: JournalEntry[],
  ideate: IdeateStoreV2,
  dateKey = localDateKey(),
): DailyStatus {
  const manual = loadLocalManualChecks(dateKey);
  return {
    gratitude: Boolean(manual.gratitude) || gratitudeDoneForDate(entries, dateKey),
    meditation:
      Boolean(manual.meditation) || hasLocalMeditationProgress(dateKey),
    lifeArea: Boolean(manual.lifeArea) || lifeAreaDoneForDate(ideate, dateKey),
    streak: computeLocalStreak(entries, ideate, dateKey),
  };
}

export function formatHabitDateLabel(d = new Date()): string {
  const weekday = d.toLocaleDateString(undefined, { weekday: "short" });
  const day = d.getDate();
  const month = d.toLocaleDateString(undefined, { month: "short" });
  return `${weekday} ${day} ${month}`;
}
