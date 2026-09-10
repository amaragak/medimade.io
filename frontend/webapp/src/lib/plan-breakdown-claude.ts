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

export type BreakDownDraft = {
  /** Cleaned / split tasks taken from what they wrote — pre-checked. */
  fromYou: string[];
  /** Extra optional ideas that do not overlap with fromYou. */
  suggestions: string[];
};

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function parseBreakDownDraft(raw: string): BreakDownDraft | null {
  const trimmed = raw.trim();
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]) as Record<string, unknown>;
      const fromYou = asStringList(
        parsed.fromYou ?? parsed.from_you ?? parsed.yours ?? parsed.owned,
      );
      const suggestions = asStringList(
        parsed.suggestions ?? parsed.extra ?? parsed.proposed,
      );
      if (fromYou.length > 0 || suggestions.length > 0) {
        return { fromYou, suggestions };
      }
    } catch {
      /* fall through */
    }
  }
  const arr = parseJsonStringArray(raw);
  if (arr.length === 0) return null;
  // Legacy flat array → treat everything as suggestions (caller may still merge).
  return { fromYou: [], suggestions: arr };
}

/** Token overlap used to drop near-duplicate suggestions. */
export function titlesLikelySameTask(a: string, b: string): boolean {
  const stop = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "to",
    "of",
    "for",
    "in",
    "on",
    "with",
    "some",
    "into",
    "my",
    "our",
    "this",
    "that",
    "out",
  ]);
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stop.has(w)),
    );
  const A = tokens(a);
  const B = tokens(b);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  const smaller = Math.min(A.size, B.size);
  // "finishing words" vs "write finalize lyrics" won't share tokens — LLM must
  // avoid that. This catches closer paraphrases like "record vocals" / "recording vocals".
  return shared >= 2 && shared / smaller >= 0.55;
}

export type BreakDownMode = "initial" | "specify";

/**
 * Initial pass: interpret what they wrote (split lists, fix grammar) into
 * `fromYou`, plus non-overlapping optional `suggestions`.
 * Specify pass: return finer actions in `suggestions` only.
 */
export async function breakDownIntoTodoDraft(input: {
  projectTitle: string;
  subtaskTitle: string;
  contextText: string;
  projectVision?: string;
  /** When set, refines one broad row into more concrete sub-steps. */
  specifyItem?: string;
  mode?: BreakDownMode;
}): Promise<BreakDownDraft> {
  const specify = input.specifyItem?.trim();
  const mode = specify ? "specify" : (input.mode ?? "initial");

  const userContent =
    mode === "specify" && specify
      ? [
          "One task on their list is still broad. Break it into 3–5 smaller, more concrete actions they could take soon.",
          "Stay in plain, human language — things a person would say out loud, not engineering tasks.",
          "Do not invent technical infrastructure (UI forms, APIs, persistence layers, taxonomies, test plans) unless their words explicitly asked for that.",
          'Return ONLY JSON: {"suggestions":["..."]} — no markdown, no prose.',
          "",
          `Project: ${input.projectTitle}`,
          `Piece: ${input.subtaskTitle}`,
          `Broad task to get specific on: ${specify}`,
          "",
          "Background (optional):",
          input.contextText.trim() || "(none)",
        ].join("\n")
      : [
          "Help someone turn what they wrote into a clear task list for a life project.",
          'Return ONLY JSON (no markdown, no prose): {"fromYou":["..."],"suggestions":["..."]}',
          "",
          "fromYou — REQUIRED when they listed things to do:",
          "— If they wrote a list (commas, 'and', bullets, numbered lines, or several short clauses), SPLIT each item into its own string.",
          "— Never keep a whole comma-joined list as one fromYou entry.",
          "— Rephrase each item into a short proper-grammar task (imperative or clear noun phrase, ~3–10 words). Fix casing; do not copy run-on fragments verbatim.",
          "— Preserve their intent and order; do not invent fromYou items they did not imply.",
          "— If they wrote one vague sentence with no list, fromYou may be empty or a single cleaned version of that intent.",
          "",
          "suggestions — optional extras only:",
          "— 0–4 additional tasks that help move the piece forward.",
          "— MUST NOT overlap or paraphrase anything in fromYou (e.g. if fromYou has finishing/writing the words/lyrics, do not also suggest 'Write and finalize lyrics').",
          "— Prefer gaps they did not mention (later stages, polish, share) over restating what they already said.",
          "— Plain human language; no UI/API/database/sprint jargon unless they wrote that way.",
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
  const parsed = parseBreakDownDraft(reply) ?? { fromYou: [], suggestions: [] };

  if (mode === "specify") {
    return {
      fromYou: [],
      suggestions:
        parsed.suggestions.length > 0 ? parsed.suggestions : parsed.fromYou,
    };
  }

  // Drop suggestions that clearly restate a fromYou / existing item.
  const owned = [...parsed.fromYou];
  const suggestions = parsed.suggestions.filter(
    (s) => !owned.some((y) => titlesLikelySameTask(s, y)),
  );
  return { fromYou: owned, suggestions };
}

/** @deprecated Prefer breakDownIntoTodoDraft. Flat title list for callers that only need suggestions. */
export async function breakDownIntoTodoTitles(input: {
  projectTitle: string;
  subtaskTitle: string;
  contextText: string;
  projectVision?: string;
  specifyItem?: string;
  mode?: BreakDownMode;
}): Promise<string[]> {
  const draft = await breakDownIntoTodoDraft(input);
  if (input.specifyItem?.trim()) return draft.suggestions;
  return [...draft.fromYou, ...draft.suggestions];
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
