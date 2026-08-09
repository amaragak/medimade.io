export const PLAN_CREATE_HANDOFF_KEY = "mm_plan_create_handoff_v1";

/** Shown in chat; full context is in `buildPlanCreateHandoffApiContent`. */
export const PLAN_CREATE_FIRST_MESSAGE =
  "Please help me turn this dream and vision into a gentle visualisation meditation.";

/** First assistant line in the API thread (matches journal → create pattern). */
export const PLAN_CREATE_OPENING_ASSISTANT =
  "What you’re holding matters. Stay close to your words—we’ll shape a visualization you can feel in your body, without forcing the outcome.";

export type PlanCreateHandoffV1 = {
  v: 1;
  goalTitle: string;
  visionText: string;
  dreamText?: string;
  obstacleText?: string;
};

export type PlanResistanceThemeHandoff = {
  category: string;
  sampleText: string;
  level: "project" | "subtask" | "todo";
  occurrences: number;
};

export type PlanCreateHandoffV2 = {
  v: 2;
  goalTitle: string;
  visionText: string;
  dreamText?: string;
  obstacleText?: string;
  project: {
    dreamText: string;
    resistanceText: string;
    visionText: string;
  };
  activeResistanceThemes: PlanResistanceThemeHandoff[];
};

export type PlanCreateHandoff = PlanCreateHandoffV1 | PlanCreateHandoffV2;

export function buildPlanCreateHandoffApiContent(h: PlanCreateHandoff): string {
  const lines: string[] = [
    PLAN_CREATE_FIRST_MESSAGE,
    "",
    `Dream / goal title: ${h.goalTitle.trim() || "Untitled"}`,
    "",
    "Vision (a specific future moment):",
    h.visionText.trim() || "(not written yet)",
  ];
  if (h.dreamText?.trim()) {
    lines.push("", "The dream (free-form):", h.dreamText.trim());
  }
  if (h.obstacleText?.trim()) {
    lines.push("", "What feels in the way:", h.obstacleText.trim());
  }
  if (h.v === 2) {
    lines.push(
      "",
      "Project context (keep levels distinct in the meditation):",
      `— Project dream: ${h.project.dreamText.trim() || "—"}`,
      `— Project resistance: ${h.project.resistanceText.trim() || "—"}`,
      `— Project vision: ${h.project.visionText.trim() || "—"}`,
    );
    if (h.activeResistanceThemes.length) {
      lines.push("", "Recurring resistance themes (recent):");
      for (const t of h.activeResistanceThemes) {
        lines.push(
          `— [${t.level}] ${t.category} (${t.occurrences}×): ${t.sampleText.slice(0, 200)}`,
        );
      }
    }
  }
  return lines.join("\n");
}

export function writePlanCreateHandoff(payload: PlanCreateHandoff) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PLAN_CREATE_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readPlanCreateHandoff(): PlanCreateHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PLAN_CREATE_HANDOFF_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o.v === 2) {
      if (typeof o.goalTitle !== "string") return null;
      if (typeof o.visionText !== "string") return null;
      if (!o.project || typeof o.project !== "object") return null;
      const p = o.project as Record<string, unknown>;
      return {
        v: 2,
        goalTitle: o.goalTitle,
        visionText: o.visionText,
        dreamText: typeof o.dreamText === "string" ? o.dreamText : undefined,
        obstacleText:
          typeof o.obstacleText === "string" ? o.obstacleText : undefined,
        project: {
          dreamText: typeof p.dreamText === "string" ? p.dreamText : "",
          resistanceText:
            typeof p.resistanceText === "string" ? p.resistanceText : "",
          visionText: typeof p.visionText === "string" ? p.visionText : "",
        },
        activeResistanceThemes: Array.isArray(o.activeResistanceThemes)
          ? (o.activeResistanceThemes as PlanResistanceThemeHandoff[])
          : [],
      };
    }
    if (o.v !== 1) return null;
    if (typeof o.goalTitle !== "string" || typeof o.visionText !== "string") return null;
    return {
      v: 1,
      goalTitle: o.goalTitle,
      visionText: o.visionText,
      dreamText: typeof o.dreamText === "string" ? o.dreamText : undefined,
      obstacleText: typeof o.obstacleText === "string" ? o.obstacleText : undefined,
    };
  } catch {
    return null;
  }
}

export function clearPlanCreateHandoff() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PLAN_CREATE_HANDOFF_KEY);
  } catch {
    /* ignore */
  }
}
