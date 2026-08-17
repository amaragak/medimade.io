import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { CLAUDE_HAIKU_45_MODEL_ID } from "./anthropic-pricing";
import { normalizeBgAudioCategory, type BgAudioCategory } from "./background-audio-keys";
import { coerceSoundSubcategory } from "./sound-taxonomy";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const secrets = new SecretsManagerClient({});
let cachedClaudeKey: string | undefined;

export type SoundCategorySuggestion = {
  id: string;
  category: BgAudioCategory;
  subcategory: string;
  name: string;
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

function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 80);
}

/** Drop "Binaural" from ambience / drums / noise titles. Music may keep it. */
function stripBinauralUnlessMusic(name: string, category: BgAudioCategory): string {
  if (category === "music") return name;
  return name
    .replace(/\bbinaural\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

const CATEGORY_TITLE_SKIP: Record<BgAudioCategory, string[]> = {
  music: ["music"],
  ambience: ["ambience", "ambient"],
  drums: ["drum", "drums"],
  noise: ["noise"],
};

const SUBCATEGORY_TITLE_SKIP: Record<string, string[]> = {
  "pads-drones": ["pad", "pads", "drone", "drones"],
  instruments: ["instrument", "instruments"],
  melodic: ["melodic", "melody"],
  voices: ["voice", "voices", "vocal", "vocals"],
  nature: ["nature"],
  spaces: ["space", "spaces"],
  "lo-fi-beats": ["beat", "beats", "lofi", "lo-fi"],
  shamanic: ["shamanic", "shaman"],
};

/** Drop category/subcategory words from titles unless they are all that remains. */
function stripRedundantTaxonomyWords(
  name: string,
  category: BgAudioCategory,
  subcategory: string,
): string {
  const skip = new Set(
    [...(CATEGORY_TITLE_SKIP[category] ?? []), ...(SUBCATEGORY_TITLE_SKIP[subcategory] ?? [])].map(
      (w) => w.toLowerCase(),
    ),
  );
  if (skip.size === 0) return name;
  const words = name.split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !skip.has(w.replace(/[^a-z0-9-]+/gi, "").toLowerCase()));
  const next = kept.join(" ").trim();
  if (!next || next.length < 3) return name;
  return next;
}

/**
 * Suggest mixer category, subcategory, and a short human-readable title from filenames.
 */
export async function suggestSoundCategories(
  items: Array<{ id: string; filename: string }>,
): Promise<Map<string, { category: BgAudioCategory; subcategory: string; name: string }>> {
  const out = new Map<string, { category: BgAudioCategory; subcategory: string; name: string }>();
  if (items.length === 0) return out;

  const apiKey = await getClaudeApiKey();
  const system = [
    "You classify meditation background audio stems from Splice sample packs and filenames.",
    "Use only the filename / relative path (BPM, key, pack folders, descriptive tokens).",
    "Pick exactly one category: music, ambience, drums, noise.",
    "The vast majority of Splice beds, loops, pads, keys, guitars, drones, and atmospheres are music.",
    "music subcategories — pick exactly one of: pads-drones, instruments, melodic, voices (choirs, chants, vocal beds).",
    "ambience = environmental / spatial recordings, not musical beds. Subcategories — pick exactly one of: nature (wildlife, beach, weather, forest, rain, ocean), spaces (rooms, cities, cafes, interiors, crowds).",
    "drums is its own category, not a music subcategory. Subcategories — pick exactly one of: lo-fi-beats (lo-fi / hip-hop beats), shamanic (ritual, frame drums, taiko, tribal), other (everything else).",
    "noise = white/pink/brown noise, static, fan, hiss used as a noise bed — not musical texture. Subcategory must be empty.",
    "Never invent other subcategory strings. Use only the ids listed above.",
    "Also pick a short human-readable name (Title Case, 2–5 words) from the distinctive filename tokens only. No file extension, no BPM, no musical key, no pack IDs or hashes.",
    "Do not repeat the category or subcategory in the name. The UI already shows those. Example: Crystal Bowl, not Crystal Bowl Drone, when subcategory is pads-drones. Soft Rain, not Soft Rain Nature. Only keep Pad/Drone/Nature/etc if no other distinctive words remain.",
    "Do not include the word Binaural in the name when category is ambience, drums, or noise.",
    "Return ONLY a JSON array of {\"id\",\"category\",\"subcategory\",\"name\"} using the same id strings you were given. For noise, set subcategory to an empty string.",
  ].join(" ");

  const user = `Classify these files:\n${JSON.stringify(items, null, 2)}`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 8192,
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
    const id = typeof rec.id === "string" ? rec.id : typeof rec.path === "string" ? rec.path : "";
    const category =
      typeof rec.category === "string"
        ? normalizeBgAudioCategory(rec.category) ?? "music"
        : "music";
    const subcategory = coerceSoundSubcategory(
      category,
      typeof rec.subcategory === "string" ? rec.subcategory : "",
    );
    const name = stripRedundantTaxonomyWords(
      stripBinauralUnlessMusic(
        typeof rec.name === "string" ? normalizeDisplayName(rec.name) : "",
        category,
      ),
      category,
      subcategory,
    );
    if (!id) continue;
    out.set(id, {
      category,
      subcategory,
      name: name || "Untitled",
    });
  }
  return out;
}
