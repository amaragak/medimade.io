/**
 * Ideate hierarchy — projects (PlanDream), subtasks, todos, resistance entries.
 * Persisted locally until a backend exists.
 */

import type { DreamState, PlanDream } from "@/lib/plan-dreams";

export type { DreamState, PlanDream };

export type SubtaskStatus = "not_started" | "in_progress" | "done";

export type ResistanceLevel = "project" | "subtask" | "todo";

export type ResistanceCategory =
  | "fear_of_judgement"
  | "unclear_next_step"
  | "no_time"
  | "not_in_the_mood"
  | "other";

export type IdeateSubtask = {
  id: string;
  projectId: string;
  title: string;
  dreamText: string;
  resistanceText: string;
  visionText: string;
  usedFullFlow: boolean;
  status: SubtaskStatus;
  completedAt: string | null;
  completedManually: boolean;
  createdAt: string;
  updatedAt: string;
  dreamReflectReply: string;
  obstacleExploreReply: string;
  visionBuildReply: string;
};

export type IdeateTodo = {
  id: string;
  subtaskId: string;
  title: string;
  isChecked: boolean;
  checkedAt: string | null;
  stalledNudgeShownAt: string | null;
  order: number;
  viewCount: number;
  wasUnchecked: boolean;
};

export type ResistanceEntry = {
  id: string;
  level: ResistanceLevel;
  projectId: string;
  subtaskId: string | null;
  todoId: string | null;
  text: string;
  category: ResistanceCategory | null;
  createdAt: string;
};

export type IdeateStoreV2 = {
  v: 2;
  dreams: PlanDream[];
  subtasks: IdeateSubtask[];
  todos: IdeateTodo[];
  resistanceEntries: ResistanceEntry[];
};

const LS_KEY = "mm_plan_dreams_v1";

function safeIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

export function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return `${prefix}_${(crypto as any).randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeDream(d: PlanDream): PlanDream {
  return {
    ...d,
    completedAt:
      typeof (d as PlanDream & { completedAt?: unknown }).completedAt === "string"
        ? (d as PlanDream & { completedAt: string }).completedAt
        : null,
  };
}

function normalizeSubtask(x: unknown): IdeateSubtask | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.projectId !== "string") return null;
  if (typeof o.title !== "string") return null;
  const status =
    o.status === "not_started" ||
    o.status === "in_progress" ||
    o.status === "done"
      ? o.status
      : "not_started";
  return {
    id: o.id,
    projectId: o.projectId,
    title: o.title,
    dreamText: typeof o.dreamText === "string" ? o.dreamText : "",
    resistanceText: typeof o.resistanceText === "string" ? o.resistanceText : "",
    visionText: typeof o.visionText === "string" ? o.visionText : "",
    usedFullFlow: o.usedFullFlow === true,
    status,
    completedAt: typeof o.completedAt === "string" ? o.completedAt : null,
    completedManually: o.completedManually === true,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
    updatedAt:
      typeof o.updatedAt === "string"
        ? o.updatedAt
        : typeof o.createdAt === "string"
          ? o.createdAt
          : safeIso(),
    dreamReflectReply:
      typeof o.dreamReflectReply === "string" ? o.dreamReflectReply : "",
    obstacleExploreReply:
      typeof o.obstacleExploreReply === "string" ? o.obstacleExploreReply : "",
    visionBuildReply:
      typeof o.visionBuildReply === "string" ? o.visionBuildReply : "",
  };
}

function normalizeTodo(x: unknown): IdeateTodo | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.subtaskId !== "string") return null;
  if (typeof o.title !== "string") return null;
  return {
    id: o.id,
    subtaskId: o.subtaskId,
    title: o.title,
    isChecked: o.isChecked === true,
    checkedAt: typeof o.checkedAt === "string" ? o.checkedAt : null,
    stalledNudgeShownAt:
      typeof o.stalledNudgeShownAt === "string" ? o.stalledNudgeShownAt : null,
    order: typeof o.order === "number" && Number.isFinite(o.order) ? o.order : 0,
    viewCount:
      typeof o.viewCount === "number" && Number.isFinite(o.viewCount)
        ? Math.max(0, o.viewCount)
        : 0,
    wasUnchecked: o.wasUnchecked === true,
  };
}

function normalizeResistance(x: unknown): ResistanceEntry | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.projectId !== "string") return null;
  if (typeof o.text !== "string") return null;
  const level =
    o.level === "project" || o.level === "subtask" || o.level === "todo"
      ? o.level
      : null;
  if (!level) return null;
  const cat = o.category;
  const category =
    cat === "fear_of_judgement" ||
    cat === "unclear_next_step" ||
    cat === "no_time" ||
    cat === "not_in_the_mood" ||
    cat === "other"
      ? cat
      : null;
  return {
    id: o.id,
    level,
    projectId: o.projectId,
    subtaskId: typeof o.subtaskId === "string" ? o.subtaskId : null,
    todoId: typeof o.todoId === "string" ? o.todoId : null,
    text: o.text,
    category,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
  };
}

function migrateV1Raw(raw: string | null): IdeateStoreV2 {
  if (!raw) {
    return { v: 2, dreams: [], subtasks: [], todos: [], resistanceEntries: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return { v: 2, dreams: [], subtasks: [], todos: [], resistanceEntries: [] };
    }
    const o = parsed as Record<string, unknown>;
    if (o.v === 1 && Array.isArray(o.dreams)) {
      return {
        v: 2,
        dreams: (o.dreams as PlanDream[]).map((d) =>
          normalizeDream({ ...d, completedAt: d.completedAt ?? null }),
        ),
        subtasks: [],
        todos: [],
        resistanceEntries: [],
      };
    }
  } catch {
    /* ignore */
  }
  return { v: 2, dreams: [], subtasks: [], todos: [], resistanceEntries: [] };
}

export function loadIdeateStore(): IdeateStoreV2 {
  if (typeof window === "undefined") {
    return { v: 2, dreams: [], subtasks: [], todos: [], resistanceEntries: [] };
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) {
      return migrateV1Raw(null);
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return migrateV1Raw(raw);
    }
    const o = parsed as Record<string, unknown>;
    if (o.v === 2) {
      return {
        v: 2,
        dreams: Array.isArray(o.dreams)
          ? o.dreams
              .map((d) => {
                if (!d || typeof d !== "object") return null;
                const r = d as Record<string, unknown>;
                if (typeof r.id !== "string") return null;
                return normalizeDream(d as PlanDream);
              })
              .filter((d): d is PlanDream => d != null)
          : [],
        subtasks: Array.isArray(o.subtasks)
          ? o.subtasks
              .map(normalizeSubtask)
              .filter((s): s is IdeateSubtask => s != null)
          : [],
        todos: Array.isArray(o.todos)
          ? o.todos.map(normalizeTodo).filter((t): t is IdeateTodo => t != null)
          : [],
        resistanceEntries: Array.isArray(o.resistanceEntries)
          ? o.resistanceEntries
              .map(normalizeResistance)
              .filter((r): r is ResistanceEntry => r != null)
          : [],
      };
    }
    return migrateV1Raw(raw);
  } catch {
    return migrateV1Raw(null);
  }
}

export function saveIdeateStore(store: IdeateStoreV2) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        v: 2,
        dreams: store.dreams.slice(0, 200),
        subtasks: store.subtasks.slice(0, 500),
        todos: store.todos.slice(0, 2000),
        resistanceEntries: store.resistanceEntries.slice(0, 1000),
      }),
    );
  } catch {
    /* ignore */
  }
}

export function upsertDream(store: IdeateStoreV2, dream: PlanDream): IdeateStoreV2 {
  const i = store.dreams.findIndex((d) => d.id === dream.id);
  const dreams =
    i === -1
      ? [...store.dreams, dream]
      : store.dreams.map((d, j) => (j === i ? dream : d));
  return { ...store, dreams };
}

export function upsertSubtask(
  store: IdeateStoreV2,
  subtask: IdeateSubtask,
): IdeateStoreV2 {
  const i = store.subtasks.findIndex((s) => s.id === subtask.id);
  const now = safeIso();
  const row: IdeateSubtask =
    i === -1
      ? { ...subtask, updatedAt: subtask.updatedAt || subtask.createdAt || now }
      : { ...subtask, updatedAt: now };
  const subtasks =
    i === -1
      ? [...store.subtasks, row]
      : store.subtasks.map((s, j) => (j === i ? row : s));
  return { ...store, subtasks };
}

export function deleteSubtask(
  store: IdeateStoreV2,
  subtaskId: string,
): IdeateStoreV2 {
  return {
    ...store,
    subtasks: store.subtasks.filter((s) => s.id !== subtaskId),
    todos: store.todos.filter((t) => t.subtaskId !== subtaskId),
    resistanceEntries: store.resistanceEntries.filter(
      (r) => r.subtaskId !== subtaskId,
    ),
  };
}

export function upsertTodo(store: IdeateStoreV2, todo: IdeateTodo): IdeateStoreV2 {
  const i = store.todos.findIndex((t) => t.id === todo.id);
  const todos =
    i === -1 ? [...store.todos, todo] : store.todos.map((t, j) => (j === i ? todo : t));
  return { ...store, todos };
}

export function deleteTodo(store: IdeateStoreV2, todoId: string): IdeateStoreV2 {
  return {
    ...store,
    todos: store.todos.filter((t) => t.id !== todoId),
    resistanceEntries: store.resistanceEntries.filter((r) => r.todoId !== todoId),
  };
}

export function addResistanceEntry(
  store: IdeateStoreV2,
  entry: Omit<ResistanceEntry, "id" | "createdAt"> & { id?: string },
): IdeateStoreV2 {
  const row: ResistanceEntry = {
    id: entry.id ?? newId("res"),
    createdAt: safeIso(),
    level: entry.level,
    projectId: entry.projectId,
    subtaskId: entry.subtaskId,
    todoId: entry.todoId,
    text: entry.text,
    category: entry.category,
  };
  return {
    ...store,
    resistanceEntries: [...store.resistanceEntries, row],
  };
}

export function createSubtask(projectId: string, title: string): IdeateSubtask {
  const now = safeIso();
  return {
    id: newId("sub"),
    projectId,
    title: title.trim() || "Untitled",
    dreamText: "",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started",
    completedAt: null,
    completedManually: false,
    createdAt: now,
    updatedAt: now,
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
}

export function createTodo(subtaskId: string, title: string, order: number): IdeateTodo {
  return {
    id: newId("todo"),
    subtaskId,
    title: title.trim() || "Untitled step",
    isChecked: false,
    checkedAt: null,
    stalledNudgeShownAt: null,
    order,
    viewCount: 0,
    wasUnchecked: false,
  };
}

export function subtasksForProject(store: IdeateStoreV2, projectId: string): IdeateSubtask[] {
  return store.subtasks.filter((s) => s.projectId === projectId);
}

export type SubtaskSortKey =
  | "created_asc"
  | "created_desc"
  | "updated_desc"
  | "updated_asc"
  | "title_asc";

export function sortSubtasks(
  rows: IdeateSubtask[],
  sort: SubtaskSortKey,
): IdeateSubtask[] {
  const out = [...rows];
  out.sort((a, b) => {
    switch (sort) {
      case "created_desc":
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      case "updated_desc":
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      case "updated_asc":
        return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      case "title_asc":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "created_asc":
      default:
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    }
  });
  return out;
}

export function todosForSubtask(store: IdeateStoreV2, subtaskId: string): IdeateTodo[] {
  return store.todos
    .filter((t) => t.subtaskId === subtaskId)
    .sort((a, b) => a.order - b.order);
}

export function recomputeSubtaskStatus(
  store: IdeateStoreV2,
  subtaskId: string,
): IdeateStoreV2 {
  const subtask = store.subtasks.find((s) => s.id === subtaskId);
  if (!subtask) return store;
  const todos = todosForSubtask(store, subtaskId);
  if (todos.length === 0) {
    if (subtask.status === "done") return store;
    return upsertSubtask(store, { ...subtask, status: "not_started" });
  }
  const allDone = todos.every((t) => t.isChecked);
  const anyChecked = todos.some((t) => t.isChecked);
  if (allDone) {
    if (subtask.status === "done") return store;
    return upsertSubtask(store, {
      ...subtask,
      status: "done",
      completedAt: safeIso(),
      completedManually: false,
    });
  }
  const nextStatus: SubtaskStatus = anyChecked ? "in_progress" : "not_started";
  if (subtask.status === nextStatus && !subtask.completedAt) return store;
  return upsertSubtask(store, {
    ...subtask,
    status: nextStatus,
    completedAt: null,
    completedManually: false,
  });
}

export function allSubtasksDone(store: IdeateStoreV2, projectId: string): boolean {
  const subs = subtasksForProject(store, projectId);
  if (subs.length === 0) return false;
  return subs.every((s) => s.status === "done");
}

export const RESISTANCE_CATEGORY_LABEL: Record<ResistanceCategory, string> = {
  fear_of_judgement: "scared of how it'll turn out",
  unclear_next_step: "not sure how to start",
  no_time: "don't have time",
  not_in_the_mood: "just haven't felt like it",
  other: "something else",
};

export const RESISTANCE_CHIP_OPTIONS: {
  category: ResistanceCategory;
  label: string;
}[] = [
  { category: "unclear_next_step", label: "Not sure how to start" },
  { category: "no_time", label: "Don't have time" },
  { category: "fear_of_judgement", label: "Scared of how it'll turn out" },
  { category: "not_in_the_mood", label: "Just haven't felt like it" },
  { category: "other", label: "Other" },
];

/** Bridge for legacy plan-dreams callers */
export function loadPlanDreamsStoreCompat(): { v: 1; dreams: PlanDream[] } {
  const s = loadIdeateStore();
  return { v: 1, dreams: s.dreams };
}

export function savePlanDreamsStoreCompat(store: { v: 1; dreams: PlanDream[] }) {
  const current = loadIdeateStore();
  saveIdeateStore({ ...current, dreams: store.dreams });
}
