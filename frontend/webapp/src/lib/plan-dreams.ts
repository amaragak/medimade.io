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
export type ThoughtSentiment =
  | "bad"
  | "okay"
  | "good"
  | "great";

export const THOUGHT_SENTIMENT_OPTIONS: {
  id: ThoughtSentiment;
  label: string;
}[] = [
  { id: "bad", label: "Bad" },
  { id: "okay", label: "Okay" },
  { id: "good", label: "Good" },
  { id: "great", label: "Great" },
];

export function thoughtSentimentLabel(
  sentiment: ThoughtSentiment | null | undefined,
): string | null {
  if (!sentiment) return null;
  return THOUGHT_SENTIMENT_OPTIONS.find((o) => o.id === sentiment)?.label ?? null;
}

/** Optional type tag on a Thoughts log entry. */
export type ThoughtKind =
  | "win"
  | "hard_blocker"
  | "resistance"
  | "insight"
  | "question"
  | "intention"
  | "progress";

export const THOUGHT_KIND_OPTIONS: {
  id: ThoughtKind;
  label: string;
}[] = [
  { id: "win", label: "Win" },
  { id: "hard_blocker", label: "Hard blocker" },
  { id: "resistance", label: "Resistance" },
  { id: "insight", label: "Insight" },
  { id: "question", label: "Question" },
  { id: "intention", label: "Intention" },
  { id: "progress", label: "Progress" },
];

export function thoughtKindLabel(
  kind: ThoughtKind | null | undefined,
): string | null {
  if (!kind) return null;
  return THOUGHT_KIND_OPTIONS.find((o) => o.id === kind)?.label ?? null;
}

export type DrvTimelineEntry = {
  id: string;
  text: string;
  createdAt: string;
  coachReply: string;
  /** Optional feeling tag for Thoughts log entries. */
  sentiment?: ThoughtSentiment;
  /** Optional type tag (Win, Resistance, …). */
  kind?: ThoughtKind;
};

/** Outer-world progress notes on a life area (feedback loop). */
export type LifeAreaCheckIn = {
  id: string;
  note: string;
  createdAt: string;
};

/** Saved Insights tab synthesis — lives on the dream in ideate cloud. */
export type LifeAreaInsightSectionId =
  | "summary"
  | "working"
  | "not_working"
  | "patterns"
  | "next";

export type LifeAreaInsightSection = {
  id: LifeAreaInsightSectionId;
  label: string;
  body: string;
};

export type LifeAreaInsightEntry = {
  id: string;
  /** Summary / fallback plain text (also used in Past insights list). */
  text: string;
  createdAt: string;
  /** Content fingerprint when this insight was generated (stale detection). */
  fingerprint: string;
  /** Structured breakdown when available. */
  sections?: LifeAreaInsightSection[];
};

export const MAX_LIFE_AREA_INSIGHTS = 40;
export const MAX_INSIGHT_TEXT_CHARS = 8000;

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
  /** Outer check-ins — newest first. */
  checkIns: LifeAreaCheckIn[];
  /**
   * Claude (or manual) insight syntheses for this life area — newest first.
   * Persisted in the ideate cloud store (Dynamo), not device storage.
   */
  insights: LifeAreaInsightEntry[];
  /** @deprecated Unused — card colour is assigned from a fixed palette by creation order. */
  cardColor: string | null;
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
    checkIns: [],
    insights: [],
    cardColor: null,
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

function normalizeSentiment(raw: unknown): ThoughtSentiment | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim().toLowerCase();
  return THOUGHT_SENTIMENT_OPTIONS.some((o) => o.id === id)
    ? (id as ThoughtSentiment)
    : undefined;
}

function normalizeThoughtKind(raw: unknown): ThoughtKind | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim().toLowerCase().replace(/\s+/g, "_");
  return THOUGHT_KIND_OPTIONS.some((o) => o.id === id)
    ? (id as ThoughtKind)
    : undefined;
}

function normalizeTimelineEntry(x: unknown): DrvTimelineEntry | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  const sentiment = normalizeSentiment(o.sentiment);
  const kind = normalizeThoughtKind(o.kind);
  return {
    id: o.id,
    text: o.text,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
    coachReply: typeof o.coachReply === "string" ? o.coachReply : "",
    ...(sentiment ? { sentiment } : {}),
    ...(kind ? { kind } : {}),
  };
}

function normalizeTimeline(raw: unknown): DrvTimelineEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeTimelineEntry)
    .filter((e): e is DrvTimelineEntry => Boolean(e))
    .slice(0, 100);
}

function normalizeCheckIn(x: unknown): LifeAreaCheckIn | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.note !== "string") return null;
  const note = o.note.trim().slice(0, 280);
  if (!note) return null;
  return {
    id: o.id,
    note,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
  };
}

function normalizeCheckIns(raw: unknown): LifeAreaCheckIn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeCheckIn)
    .filter((e): e is LifeAreaCheckIn => Boolean(e))
    .slice(0, 40);
}

const INSIGHT_SECTION_IDS: LifeAreaInsightSectionId[] = [
  "summary",
  "working",
  "not_working",
  "patterns",
  "next",
];

function normalizeInsightSection(x: unknown): LifeAreaInsightSection | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.label !== "string") return null;
  if (typeof o.body !== "string") return null;
  const id = o.id.trim() as LifeAreaInsightSectionId;
  if (!INSIGHT_SECTION_IDS.includes(id)) return null;
  const body = o.body.trim().slice(0, 2000);
  if (!body) return null;
  return {
    id,
    label: o.label.trim().slice(0, 80) || id,
    body,
  };
}

function normalizeInsight(x: unknown): LifeAreaInsightEntry | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  const text = o.text.trim().slice(0, MAX_INSIGHT_TEXT_CHARS);
  if (!text) return null;
  const sections = Array.isArray(o.sections)
    ? o.sections
        .map(normalizeInsightSection)
        .filter((s): s is LifeAreaInsightSection => Boolean(s))
        .slice(0, 8)
    : undefined;
  return {
    id: o.id,
    text,
    createdAt: typeof o.createdAt === "string" ? o.createdAt : safeIso(),
    fingerprint: typeof o.fingerprint === "string" ? o.fingerprint : "",
    ...(sections && sections.length ? { sections } : {}),
  };
}

function normalizeInsights(raw: unknown): LifeAreaInsightEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeInsight)
    .filter((e): e is LifeAreaInsightEntry => Boolean(e))
    .slice(0, MAX_LIFE_AREA_INSIGHTS);
}

export function normalizeLifeAreaInsights(raw: unknown): LifeAreaInsightEntry[] {
  return normalizeInsights(raw);
}

export function prependLifeAreaInsight(
  dream: PlanDream,
  input: {
    text: string;
    fingerprint: string;
    sections?: LifeAreaInsightSection[];
  },
): PlanDream {
  const trimmed = input.text.trim().slice(0, MAX_INSIGHT_TEXT_CHARS);
  if (!trimmed) return dream;
  const sections = (input.sections ?? [])
    .map((s) => normalizeInsightSection(s))
    .filter((s): s is LifeAreaInsightSection => Boolean(s))
    .slice(0, 8);
  const entry: LifeAreaInsightEntry = {
    id: newDreamId().replace(/^dream_/, "insight_"),
    text: trimmed,
    createdAt: safeIso(),
    fingerprint: input.fingerprint,
    ...(sections.length ? { sections } : {}),
  };
  return {
    ...dream,
    updatedAt: entry.createdAt,
    insights: [entry, ...(dream.insights ?? [])].slice(0, MAX_LIFE_AREA_INSIGHTS),
  };
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
      checkIns: normalizeCheckIns(d.checkIns),
      insights: normalizeInsights(d.insights),
      cardColor:
        typeof d.cardColor === "string" && d.cardColor.trim()
          ? d.cardColor.trim()
          : null,
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

export function addLifeAreaCheckIn(
  dream: PlanDream,
  note: string,
): PlanDream {
  const trimmed = note.trim().slice(0, 280);
  if (!trimmed) return dream;
  const now = safeIso();
  const entry: LifeAreaCheckIn = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `checkin_${(crypto as any).randomUUID()}`
        : `checkin_${Date.now().toString(16)}`,
    note: trimmed,
    createdAt: now,
  };
  return {
    ...dream,
    checkIns: [entry, ...(dream.checkIns ?? [])].slice(0, 40),
    updatedAt: now,
  };
}

export function latestLifeAreaCheckIn(
  dream: PlanDream,
): LifeAreaCheckIn | null {
  return dream.checkIns?.[0] ?? null;
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
        checkIns: [],
        insights: [],
        cardColor: null,
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
