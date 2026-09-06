import {
  IDEATE_REFLECTION_QUESTION_PRESETS,
  type IdeateReflectionQuestionPreset,
} from "@/lib/ideate-reflection-question-presets";
import { getMedimadeSessionJwt } from "@/lib/auth-session";

/**
 * Per-user Ideate reflection questions (added presets + custom).
 * Signed-in: cloud-first; localStorage is cache. Guests: device only.
 */

export type IdeateReflectionQuestion = {
  id: string;
  text: string;
  description: string;
  answer: string;
  source: "preset" | "custom";
  /** Present when source === "preset" */
  presetId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IdeateReflectionQuestionsStoreV1 = {
  v: 1;
  questions: IdeateReflectionQuestion[];
};

const LS_KEY = "mm_ideate_reflection_questions_v1";

function safeIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return `${prefix}_${(crypto as any).randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeQuestion(x: unknown): IdeateReflectionQuestion | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  const source = o.source === "preset" || o.source === "custom" ? o.source : "custom";
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : safeIso();
  return {
    id: o.id,
    text: o.text,
    description: typeof o.description === "string" ? o.description : "",
    answer: typeof o.answer === "string" ? o.answer : "",
    source,
    presetId: typeof o.presetId === "string" ? o.presetId : null,
    createdAt,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : createdAt,
  };
}

export function loadIdeateReflectionQuestionsStore(): IdeateReflectionQuestionsStoreV1 {
  if (typeof window === "undefined") return { v: 1, questions: [] };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { v: 1, questions: [] };
    const parsed = JSON.parse(raw) as { v?: number; questions?: unknown[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.questions)) {
      return { v: 1, questions: [] };
    }
    return {
      v: 1,
      questions: parsed.questions
        .map(normalizeQuestion)
        .filter((q): q is IdeateReflectionQuestion => Boolean(q))
        .slice(0, 50),
    };
  } catch {
    return { v: 1, questions: [] };
  }
}

/** Write local cache only — does not schedule cloud push. */
export function saveIdeateReflectionQuestionsStoreLocal(
  store: IdeateReflectionQuestionsStoreV1,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        v: 1,
        questions: store.questions.slice(0, 50),
      } satisfies IdeateReflectionQuestionsStoreV1),
    );
  } catch {
    /* ignore */
  }
}

/** Persist cache and schedule cloud PUT when signed in. */
export function saveIdeateReflectionQuestionsStore(
  store: IdeateReflectionQuestionsStoreV1,
) {
  saveIdeateReflectionQuestionsStoreLocal(store);
  if (getMedimadeSessionJwt()) {
    void import("@/lib/ideate-cloud").then((m) => m.scheduleIdeateCloudPush());
  }
}

export function availablePresets(
  store: IdeateReflectionQuestionsStoreV1,
): IdeateReflectionQuestionPreset[] {
  const used = new Set(
    store.questions
      .filter((q) => q.source === "preset" && q.presetId)
      .map((q) => q.presetId as string),
  );
  return IDEATE_REFLECTION_QUESTION_PRESETS.filter((p) => !used.has(p.id));
}

export function addPresetQuestion(
  store: IdeateReflectionQuestionsStoreV1,
  presetId: string,
): IdeateReflectionQuestionsStoreV1 {
  const preset = IDEATE_REFLECTION_QUESTION_PRESETS.find((p) => p.id === presetId);
  if (!preset) return store;
  if (store.questions.some((q) => q.presetId === presetId)) return store;
  const now = safeIso();
  const next: IdeateReflectionQuestion = {
    id: newId("rq"),
    text: preset.text,
    description: preset.description,
    answer: "",
    source: "preset",
    presetId: preset.id,
    createdAt: now,
    updatedAt: now,
  };
  return { v: 1, questions: [...store.questions, next] };
}

export function addCustomQuestion(
  store: IdeateReflectionQuestionsStoreV1,
  text: string,
): IdeateReflectionQuestionsStoreV1 {
  const trimmed = text.trim();
  if (!trimmed) return store;
  const now = safeIso();
  const next: IdeateReflectionQuestion = {
    id: newId("rq"),
    text: trimmed,
    description: "Your question",
    answer: "",
    source: "custom",
    presetId: null,
    createdAt: now,
    updatedAt: now,
  };
  return { v: 1, questions: [...store.questions, next] };
}

export function patchQuestionAnswer(
  store: IdeateReflectionQuestionsStoreV1,
  id: string,
  answer: string,
): IdeateReflectionQuestionsStoreV1 {
  return {
    v: 1,
    questions: store.questions.map((q) =>
      q.id === id
        ? { ...q, answer, updatedAt: safeIso() }
        : q,
    ),
  };
}
