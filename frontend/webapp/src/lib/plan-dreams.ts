/**
 * Plan / Dreams planner — persisted locally until a backend exists.
 */

export type DreamState =
  | "germinating"
  | "exploring"
  | "visualising"
  | "in_motion"
  | "released";

export type PlanDream = {
  id: string;
  title: string;
  state: DreamState;
  createdAt: string;
  /** Optional seed from “Add a dream” modal */
  firstThought: string;
  dreamText: string;
  obstacleText: string;
  visionText: string;
  dreamReflectReply: string;
  obstacleExploreReply: string;
  visionBuildReply: string;
  meditationsGenerated: number;
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
}): PlanDream {
  const first = (input.firstThought ?? "").trim();
  const title = (input.title ?? "").trim() || "Untitled";
  return {
    id: newDreamId(),
    title,
    state: "germinating",
    createdAt: safeIso(),
    firstThought: first,
    dreamText: first,
    obstacleText: "",
    visionText: "",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    meditationsGenerated: 0,
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
  try {
    const raw = window.localStorage.getItem(PLAN_DREAMS_LS_KEY);
    if (!raw) {
      return migrateLegacyPlanIfNeeded();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return { v: 1, dreams: [] };
    const o = parsed as Partial<PlanDreamsStoreV1>;
    if (o.v !== 1 || !Array.isArray(o.dreams)) return { v: 1, dreams: [] };
    return { v: 1, dreams: normalizeDreams(o.dreams) };
  } catch {
    return { v: 1, dreams: [] };
  }
}

function normalizeDreams(raw: unknown[]): PlanDream[] {
  const out: PlanDream[] = [];
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const d = x as Record<string, unknown>;
    if (typeof d.id !== "string" || typeof d.title !== "string") continue;
    const state = normalizeState(d.state);
    out.push({
      id: d.id,
      title: d.title,
      state,
      createdAt: typeof d.createdAt === "string" ? d.createdAt : safeIso(),
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
      meditationsGenerated:
        typeof d.meditationsGenerated === "number" && Number.isFinite(d.meditationsGenerated)
          ? Math.max(0, Math.floor(d.meditationsGenerated))
          : 0,
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
        firstThought: "",
        dreamText: desc ? `${title}\n\n${desc}` : title,
        obstacleText: "",
        visionText: "",
        dreamReflectReply: "",
        obstacleExploreReply: "",
        visionBuildReply: "",
        meditationsGenerated: 0,
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
    window.localStorage.setItem(
      PLAN_DREAMS_LS_KEY,
      JSON.stringify({ v: 1, dreams: store.dreams.slice(0, 200) }),
    );
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
