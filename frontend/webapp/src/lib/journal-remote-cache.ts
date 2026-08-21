/**
 * In-memory session cache for journal remote reads.
 * Avoids re-hitting the API when Insights remounts or the user returns
 * to /journal within the same tab session.
 */

import type {
  JournalInsights,
  JournalWeeklyLetterSummary,
  JournalWeeklyReflection,
} from "@/lib/medimade-api";

type CacheBox<T> = { value: T; at: number };

const TTL_MS = 5 * 60 * 1000;

let insightsBox: CacheBox<JournalInsights | null> | null = null;
let lettersBox: CacheBox<{
  letters: JournalWeeklyLetterSummary[];
  currentWeekKey: string;
}> | null = null;
const weeklyBox = new Map<
  string,
  CacheBox<{
    reflection: JournalWeeklyReflection | null;
    weekKey: string;
    weekStart: string;
    weekEnd: string;
    empty?: boolean;
  }>
>();

/** Once true, JournalView can skip another full remote store pull this session. */
let journalStorePulledThisSession = false;

function fresh<T>(box: CacheBox<T> | null | undefined): T | undefined {
  if (!box) return undefined;
  if (Date.now() - box.at > TTL_MS) return undefined;
  return box.value;
}

export function getCachedJournalInsights(): JournalInsights | null | undefined {
  return fresh(insightsBox);
}

export function setCachedJournalInsights(value: JournalInsights | null): void {
  insightsBox = { value, at: Date.now() };
}

export function invalidateCachedJournalInsights(): void {
  insightsBox = null;
}

export function getCachedWeeklyLetters():
  | { letters: JournalWeeklyLetterSummary[]; currentWeekKey: string }
  | undefined {
  return fresh(lettersBox);
}

export function setCachedWeeklyLetters(value: {
  letters: JournalWeeklyLetterSummary[];
  currentWeekKey: string;
}): void {
  lettersBox = { value, at: Date.now() };
}

export function invalidateCachedWeeklyLetters(): void {
  lettersBox = null;
}

export function getCachedWeeklyReflection(weekKey: string):
  | {
      reflection: JournalWeeklyReflection | null;
      weekKey: string;
      weekStart: string;
      weekEnd: string;
      empty?: boolean;
    }
  | undefined {
  return fresh(weeklyBox.get(weekKey || "__current__"));
}

export function setCachedWeeklyReflection(
  weekKey: string,
  value: {
    reflection: JournalWeeklyReflection | null;
    weekKey: string;
    weekStart: string;
    weekEnd: string;
    empty?: boolean;
  },
): void {
  weeklyBox.set(weekKey || "__current__", { value, at: Date.now() });
}

export function invalidateCachedWeeklyReflection(weekKey?: string): void {
  if (weekKey) {
    weeklyBox.delete(weekKey);
    weeklyBox.delete("__current__");
    return;
  }
  weeklyBox.clear();
}

export function wasJournalStorePulledThisSession(): boolean {
  return journalStorePulledThisSession;
}

export function markJournalStorePulledThisSession(): void {
  journalStorePulledThisSession = true;
}

export function clearJournalRemoteSessionCache(): void {
  insightsBox = null;
  lettersBox = null;
  weeklyBox.clear();
  journalStorePulledThisSession = false;
}
