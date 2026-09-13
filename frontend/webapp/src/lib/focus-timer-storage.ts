/** Local persistence for the logged-in Focus timer page. */

export const FOCUS_TASK_STORAGE_KEY = "mm_focus_task_v1";
export const FOCUS_TASKS_LIST_STORAGE_KEY = "mm_focus_tasks_list_v1";
export const FOCUS_SESSIONS_TODAY_KEY = "mm_focus_sessions_today_v1";

export type FocusIdeateKind = "subtask" | "todo";

export type FocusTaskItem = {
  id: string;
  text: string;
  done: boolean;
  /** Life area title badge when imported from Ideate. */
  lifeAreaId?: string | null;
  lifeAreaTitle?: string | null;
  /** Ideate entity linked for “Mark as done in Ideate”. */
  ideateKind?: FocusIdeateKind | null;
  ideateId?: string | null;
};

type SessionsToday = {
  date: string; // YYYY-MM-DD local
  count: number;
};

function todayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readFocusTask(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(FOCUS_TASK_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeFocusTask(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FOCUS_TASK_STORAGE_KEY, value);
  } catch {
    /* quota / private */
  }
}

function parseFocusTaskItem(raw: unknown): FocusTaskItem | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || typeof t.text !== "string") return null;
  if (typeof t.done !== "boolean") return null;
  const ideateKind =
    t.ideateKind === "subtask" || t.ideateKind === "todo" ? t.ideateKind : null;
  return {
    id: t.id,
    text: t.text,
    done: t.done,
    lifeAreaId: typeof t.lifeAreaId === "string" ? t.lifeAreaId : null,
    lifeAreaTitle: typeof t.lifeAreaTitle === "string" ? t.lifeAreaTitle : null,
    ideateKind,
    ideateId: typeof t.ideateId === "string" ? t.ideateId : null,
  };
}

export function readFocusTasksList(): FocusTaskItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FOCUS_TASKS_LIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseFocusTaskItem)
      .filter((t): t is FocusTaskItem => Boolean(t));
  } catch {
    return [];
  }
}

export function writeFocusTasksList(tasks: FocusTaskItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      FOCUS_TASKS_LIST_STORAGE_KEY,
      JSON.stringify(tasks),
    );
  } catch {
    /* */
  }
}

export function readSessionsCompletedToday(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(FOCUS_SESSIONS_TODAY_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as SessionsToday;
    if (!parsed || parsed.date !== todayKey()) return 0;
    return Math.max(0, Math.min(12, Number(parsed.count) || 0));
  } catch {
    return 0;
  }
}

export function writeSessionsCompletedToday(count: number): void {
  if (typeof window === "undefined") return;
  try {
    const payload: SessionsToday = {
      date: todayKey(),
      count: Math.max(0, Math.min(12, count)),
    };
    window.localStorage.setItem(
      FOCUS_SESSIONS_TODAY_KEY,
      JSON.stringify(payload),
    );
  } catch {
    /* */
  }
}
