import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { CLAUDE_HAIKU_45_MODEL_ID } from "./anthropic-pricing";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const secrets = new SecretsManagerClient({});
let cachedClaudeKey: string | undefined;

/** Below this length we treat the day description as missing and regenerate. */
export const PROGRAM_DAY_DESCRIPTION_MIN_CHARS = 100;

async function getClaudeApiKey(): Promise<string> {
  if (cachedClaudeKey) return cachedClaudeKey;
  const arn = process.env.CLAUDE_SECRET_ARN;
  if (!arn) throw new Error("CLAUDE_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Claude API key secret is empty");
  cachedClaudeKey = s;
  return cachedClaudeKey;
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

/**
 * ~50-word shelf blurb for a program meditation, derived from the one-shot prompt.
 */
export async function generateProgramDayDescription(params: {
  prompt: string;
  title?: string;
  programTitle?: string;
}): Promise<string> {
  const prompt = params.prompt.trim();
  if (!prompt) throw new Error("prompt is required");

  const apiKey = await getClaudeApiKey();
  const system = [
    "You write short listener-facing descriptions for guided meditations in a multi-lesson program.",
    "Return exactly one JSON object: {\"description\":\"...\"}. No markdown fences.",
    "The description should be about 50 words (roughly 40–60), warm, concrete, and spoiler-light — what the listener will experience, not how it was made.",
    "Do not start with \"This meditation\" or \"In this session\". No emoji.",
  ].join(" ");

  const user = [
    params.programTitle?.trim()
      ? `Program title: ${params.programTitle.trim()}`
      : null,
    params.title?.trim() ? `Lesson title: ${params.title.trim()}` : null,
    "One-shot creation prompt:",
    prompt.slice(0, 4000),
    "",
    'Return: {"description":"~50 words"}',
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 300,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Claude describe failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (data.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text!)
    .join("\n")
    .trim();
  const parsed = extractJsonObject(text);
  const description =
    typeof parsed.description === "string" ? parsed.description.trim() : "";
  if (description.length < 40) {
    throw new Error("Description from model was too short");
  }
  return description.slice(0, 600);
}

export function needsProgramDayDescription(description: string | null | undefined): boolean {
  return (description ?? "").trim().length < PROGRAM_DAY_DESCRIPTION_MIN_CHARS;
}
