import type { MedimadeChatTurn } from "@/lib/medimade-api";
import { streamPlanCoachReply } from "@/lib/plan-claude";
import type { ResistanceCategory } from "@/lib/plan-ideate-store";

async function collectReply(messages: MedimadeChatTurn[]): Promise<string> {
  return streamPlanCoachReply(messages, () => {});
}

function parseJsonStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  const candidate = jsonMatch ? jsonMatch[0] : trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => (typeof x === "string" ? x.trim() : ""))
      .filter(Boolean);
  } catch {
    return trimmed
      .split("\n")
      .map((l) => l.replace(/^[-*•\d.)]+\s*/, "").trim())
      .filter(Boolean);
  }
}

export type BreakDownMode = "initial" | "specify";

export async function breakDownIntoTodoTitles(input: {
  projectTitle: string;
  subtaskTitle: string;
  contextText: string;
  projectVision?: string;
  /** When set, refines one broad row into more concrete sub-steps. */
  specifyItem?: string;
  mode?: BreakDownMode;
}): Promise<string[]> {
  const specify = input.specifyItem?.trim();
  const mode = specify ? "specify" : (input.mode ?? "initial");

  const userContent =
    mode === "specify" && specify
      ? [
          "One step on their list is still broad. Break it into 3–5 smaller, more concrete actions they could take soon.",
          "Stay in plain, human language — things a person would say out loud, not engineering tasks.",
          "Do not invent technical infrastructure (UI forms, APIs, persistence layers, taxonomies, test plans) unless their words explicitly asked for that.",
          "Return ONLY a JSON array of short strings. No markdown, no prose.",
          "",
          `Project: ${input.projectTitle}`,
          `Piece: ${input.subtaskTitle}`,
          `Broad step to get specific on: ${specify}`,
          "",
          "Background (optional):",
          input.contextText.trim() || "(none)",
        ].join("\n")
      : [
          "Help someone shape a project into a few broad pieces — not a technical build plan.",
          "Return ONLY a JSON array of 3–6 short strings. No markdown, no prose before or after.",
          "",
          "Rules for the first pass:",
          "— Each item is a phase or outcome in plain language (roughly 4–12 words).",
          "— Stay vague enough that they can make it their own; do not prescribe how to build it.",
          "— No implementation detail: avoid UI/API/database/prompt-template/taxonomy/testing/doc tasks unless they explicitly wrote that way.",
          "— Think milestones someone would recognize, not a sprint backlog.",
          "",
          `Project: ${input.projectTitle}`,
          `Piece: ${input.subtaskTitle}`,
          "",
          "What they've written:",
          input.contextText.trim() || "(none yet)",
          ...(input.projectVision?.trim()
            ? [
                "",
                "Project vision (tone only — do not copy verbatim):",
                input.projectVision.trim(),
              ]
            : []),
        ].join("\n");

  const reply = await collectReply([{ role: "user", content: userContent }]);
  return parseJsonStringArray(reply);
}

export async function classifyResistanceText(
  text: string,
): Promise<ResistanceCategory | null> {
  const reply = await collectReply([
    {
      role: "user",
      content: [
        "Classify this resistance note into exactly one category slug.",
        "Reply with ONLY one of: fear_of_judgement | unclear_next_step | no_time | not_in_the_mood | other",
        "",
        text.trim(),
      ].join("\n"),
    },
  ]);
  const slug = reply.trim().toLowerCase().replace(/[^a-z_]/g, "");
  if (
    slug === "fear_of_judgement" ||
    slug === "unclear_next_step" ||
    slug === "no_time" ||
    slug === "not_in_the_mood" ||
    slug === "other"
  ) {
    return slug;
  }
  return "other";
}
