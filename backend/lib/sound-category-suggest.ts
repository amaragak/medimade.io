import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { CLAUDE_HAIKU_45_MODEL_ID } from "./anthropic-pricing";
import { isBgAudioCategory, type BgAudioCategory } from "./background-audio-keys";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const secrets = new SecretsManagerClient({});
let cachedClaudeKey: string | undefined;

export type SoundCategorySuggestion = {
  path: string;
  category: BgAudioCategory;
  subcategory: string;
};

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

function extractJsonArray(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("No JSON array in model output");
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

function normalizeSubcategory(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Suggest mixer category + subcategory from Splice pack paths / filenames.
 * Default is music unless the name clearly indicates nature, drums, or noise.
 */
export async function suggestSoundCategories(
  paths: string[],
): Promise<Map<string, { category: BgAudioCategory; subcategory: string }>> {
  const out = new Map<string, { category: BgAudioCategory; subcategory: string }>();
  if (paths.length === 0) return out;

  const apiKey = await getClaudeApiKey();
  const system = [
    "You classify meditation background audio stems from Splice sample packs.",
    "Use only the relative path and Splice-style filename (BPM, key, pack folders, descriptive tokens).",
    "Pick exactly one category: music, nature, drums, noise.",
    "The vast majority of Splice beds, loops, pads, keys, guitars, drones, and atmospheres are music.",
    "nature = rain, ocean, wind, birds, forest, fire, water, insects — environmental recordings.",
    "drums = drum loops, percussion, kicks, hats, shakers, taiko, hand drums used as rhythm beds.",
    "noise = white/pink/brown noise, static, fan, hiss used as a noise bed — not musical texture.",
    "Also pick a short subcategory slug (lowercase, hyphens): e.g. ambient, pad, piano, guitar, drone, lofi, cinematic, strings, bells, rain, ocean, birds, forest, kick, percussion, white-noise.",
    "Return ONLY a JSON array of {\"path\",\"category\",\"subcategory\"} with the same path strings you were given.",
  ].join(" ");

  const user = `Classify these files:\n${JSON.stringify(paths, null, 2)}`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude classify failed: ${detail.slice(0, 800)}`);
  }
  const body = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = (body.content ?? [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text!)
    .join("\n");
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return out;
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const path = typeof rec.path === "string" ? rec.path : "";
    const category =
      typeof rec.category === "string" && isBgAudioCategory(rec.category)
        ? rec.category
        : "music";
    const subcategory =
      typeof rec.subcategory === "string" ? normalizeSubcategory(rec.subcategory) : "";
    if (!path) continue;
    out.set(path, { category, subcategory: subcategory || "uncategorized" });
  }
  return out;
}
