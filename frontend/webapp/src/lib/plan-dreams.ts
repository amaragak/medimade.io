/**
 * Plan / Dreams planner — persisted locally until a backend exists.
 */

import {
  loadIdeateStore,
  saveIdeateStore,
} from "@/lib/plan-ideate-store";

export type DreamState =
  | "germinating"
  | "exploring"
  | "visualising"
  | "in_motion"
  | "released";

/** Append-only reflection entries for Dream / Resistance / Vision. */
export type DrvTimelineEntry = {
  id: string;
  text: string;
  createdAt: string;
  coachReply: string;
};

export type PlanDream = {
  id: string;
  title: string;
  state: DreamState;
  createdAt: string;
  /** Last local edit — used for quiet “Last touched …” momentum. */
  updatedAt: string;
  /** Optional seed from “Add a dream” modal */
  firstThought: string;
  dreamText: string;
  obstacleText: string;
  visionText: string;
  dreamReflectReply: string;
  obstacleExploreReply: string;
  visionBuildReply: string;
  /**
   * Running thoughts — append-only log, independent of the main answer fields
   * (dreamText / obstacleText / visionText).
   */
  dreamEntries: DrvTimelineEntry[];
  obstacleEntries: DrvTimelineEntry[];
  visionEntries: DrvTimelineEntry[];
  /** Free-text scratchpad — not part of DRV. */
  looseNotes: string;
  /** Guest sample — device-only; stripped after sign-in. */
  demo?: boolean;
  meditationsGenerated: number;
  /** Set when user manually marks project complete */
  completedAt: string | null;
};

export type PlanDreamsStoreV1 = {
  v: 1;
  dreams: PlanDream[];
};

export const PLAN_DREAMS_LS_KEY = "mm_plan_dreams_v1";
const LEGACY_PLAN_V1_KEY = "mm_plan_v1";

export function newDreamId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return `dream_${(crypto as any).randomUUID()}`;
  }
  return `dream_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function safeIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

export function createPlanDream(input: {
  title: string;
  firstThought?: string;
  dreamText?: string;
  obstacleText?: string;
  visionText?: string;
}): PlanDream {
  const first = (input.firstThought ?? "").trim();
  const dreamText = (input.dreamText ?? first).trim();
  const title = (input.title ?? "").trim() || "Untitled";
  const now = safeIso();
  return {
    id: newDreamId(),
    title,
    state: "germinating",
    createdAt: now,
    updatedAt: now,
    firstThought: first || dreamText,
    dreamText,
    obstacleText: (input.obstacleText ?? "").trim(),
    visionText: (input.visionText ?? "").trim(),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [],
    obstacleEntries: [],
    visionEntries: [],
    looseNotes: "",
    meditationsGenerated: 0,
    completedAt: null,
  };
}

export function upsertPlanDream(
  store: PlanDreamsStoreV1,
  dream: PlanDream,
): PlanDreamsStoreV1 {
  const i = store.dreams.findIndex((d) => d.id === dream.id);
  const dreams =
    i === -1
      ? [...store.dreams, dream]
      : store.dreams.map((d, j) => (j === i ? dream : d));
  return { v: 1, dreams };
}

export function loadPlanDreamsStore(): PlanDreamsStoreV1 {
  if (typeof window === "undefined") return { v: 1, dreams: [] };
  const v2 = loadIdeateStore();
  return { v: 1, dreams: v2.dreams };
}

function normalizeTimelineEntry(x: unknown): DrvTimelineEntry | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  return {
    id: o.id,
    text: o.text,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
    coachReply: typeof o.coachReply === "string" ? o.coachReply : "",
  };
}

function normalizeTimeline(raw: unknown): DrvTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeTimelineEntry)
    .filter((e): e is DrvTimelineEntry => Boolean(e))
    .slice(0, 100);
}

function normalizeDreams(raw: unknown[]): PlanDream[] {
  const out: PlanDream[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const d = x as Record<string, unknown>;
    if (typeof d.id !== "string" || typeof d.title !== "string") continue;
    const state = normalizeState(d.state);
    const createdAt = typeof d.createdAt === "string" ? d.createdAt : safeIso();
    out.push({
      id: d.id,
      title: d.title,
      state,
      createdAt,
      updatedAt: typeof d.updatedAt === "string" ? d.updatedAt : createdAt,
      firstThought: typeof d.firstThought === "string" ? d.firstThought : "",
      dreamText: typeof d.dreamText === "string" ? d.dreamText : "",
      obstacleText: typeof d.obstacleText === "string" ? d.obstacleText : "",
      visionText: typeof d.visionText === "string" ? d.visionText : "",
      dreamReflectReply:
        typeof d.dreamReflectReply === "string" ? d.dreamReflectReply : "",
      obstacleExploreReply:
        typeof d.obstacleExploreReply === "string" ? d.obstacleExploreReply : "",
      visionBuildReply:
        typeof d.visionBuildReply === "string" ? d.visionBuildReply : "",
      dreamEntries: normalizeTimeline(d.dreamEntries),
      obstacleEntries: normalizeTimeline(d.obstacleEntries),
      visionEntries: normalizeTimeline(d.visionEntries),
      looseNotes: typeof d.looseNotes === "string" ? d.looseNotes : "",
      meditationsGenerated:
        typeof d.meditationsGenerated === "number" &&
        Number.isFinite(d.meditationsGenerated)
          ? Math.max(0, Math.floor(d.meditationsGenerated))
          : 0,
      completedAt: typeof d.completedAt === "string" ? d.completedAt : null,
      ...(d.demo === true ? { demo: true as const } : {}),
    });
  }
  return out;
}

function normalizeState(x: unknown): DreamState {
  if (
    x === "germinating" ||
    x === "exploring" ||
    x === "visualising" ||
    x === "in_motion" ||
    x === "released"
  ) {
    return x;
  }
  return "germinating";
}

function migrateLegacyPlanIfNeeded(): PlanDreamsStoreV1 {
  try {
    const leg = window.localStorage.getItem(LEGACY_PLAN_V1_KEY);
    if (!leg) return { v: 1, dreams: [] };
    const parsed = JSON.parse(leg) as { v?: number; goals?: unknown[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.goals)) return { v: 1, dreams: [] };
    const dreams: PlanDream[] = [];
    for (const g of parsed.goals) {
      if (!g || typeof g !== "object") continue;
      const o = g as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof o.title !== "string") continue;
      const title = o.title.trim() || "Untitled";
      const desc = typeof o.description === "string" ? o.description : "";
      dreams.push({
        id: `migrated_${o.id}`,
        title,
        state: "germinating",
        createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
        updatedAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
        firstThought: "",
        dreamText: desc ? `${title}\n\n${desc}` : title,
        obstacleText: "",
        visionText: "",
        dreamReflectReply: "",
        obstacleExploreReply: "",
        visionBuildReply: "",
        dreamEntries: [],
        obstacleEntries: [],
        visionEntries: [],
        looseNotes: "",
        meditationsGenerated: 0,
        completedAt: null,
      });
    }
    if (dreams.length) {
      const next: PlanDreamsStoreV1 = { v: 1, dreams };
      window.localStorage.setItem(PLAN_DREAMS_LS_KEY, JSON.stringify(next));
    }
    return { v: 1, dreams };
  } catch {
    return { v: 1, dreams: [] };
  }
}

export function savePlanDreamsStore(store: PlanDreamsStoreV1) {
  if (typeof window === "undefined") return;
  try {
    const current = loadIdeateStore();
    saveIdeateStore({ ...current, dreams: store.dreams.slice(0, 200) });
  } catch {
    /* ignore */
  }
}

export function dreamExcerpt(d: PlanDream): string {
  const raw = (d.dreamText || d.firstThought || "").trim();
  if (!raw) return "—";
  const one = raw.replace(/\s+/g, " ").trim();
  return one.length > 120 ? `${one.slice(0, 117)}…` : one;
}

export const DREAM_STATE_LABEL: Record<DreamState, string> = {
  germinating: "Germinating",
  exploring: "Exploring",
  visualising: "Visualising",
  in_motion: "In motion",
  released: "Released",
};

export const DREAM_STATE_ORDER: DreamState[] = [
  "germinating",
  "exploring",
  "visualising",
  "in_motion",
  "released",
];
