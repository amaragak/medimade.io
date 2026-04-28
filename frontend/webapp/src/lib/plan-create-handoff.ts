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

export function buildPlanCreateHandoffApiContent(h: PlanCreateHandoffV1): string {
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
  return lines.join("\n");
}

export function writePlanCreateHandoff(payload: PlanCreateHandoffV1) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PLAN_CREATE_HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function readPlanCreateHandoff(): PlanCreateHandoffV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PLAN_CREATE_HANDOFF_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PlanCreateHandoffV1>;
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
