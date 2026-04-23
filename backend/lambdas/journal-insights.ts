import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CLAUDE_HAIKU_45_MODEL_ID,
  parseAnthropicMessageUsage,
} from "../lib/anthropic-pricing";
import { requireUserJson } from "../lib/medimade-auth-http";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const secrets = new SecretsManagerClient({});
let cachedClaudeKey: string | undefined;

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

type TopicId =
  | "overview"
  | "emotions"
  | "stress"
  | "health"
  | "relationships"
  | "identity"
  | "worldview"
  | "work"
  | "projects"
  | "ideas"
  | "values"
  | "habits"
  | "decisions"
  | "growth";

const TOPICS: Array<{ id: TopicId; label: string; instructions: string }> = [
  {
    id: "overview",
    label: "Overview",
    instructions:
      "A general summary of what the user has been thinking/feeling over time. Emphasize themes, patterns, and change over time.",
  },
  {
    id: "emotions",
    label: "Emotions & mood patterns",
    instructions:
      "Summarize recurring emotions and mood patterns, triggers, and what tends to help or worsen the emotional state over time.",
  },
  {
    id: "stress",
    label: "Stress & coping",
    instructions:
      "Summarize stressors and coping patterns (avoidance vs approach, self-soothing, problem-solving). Highlight what reliably reduces or escalates stress over time.",
  },
  {
    id: "health",
    label: "Health & body",
    instructions:
      "Summarize health/body themes (sleep, energy, illness, movement, somatic tension). Do not diagnose; stick to what the user reports and patterns over time.",
  },
  {
    id: "relationships",
    label: "Relationships",
    instructions:
      "Summarize reflections about relationships (friends, family, partners), attachment patterns, conflict/repair, social needs, and recurring relational themes.",
  },
  {
    id: "identity",
    label: "Identity & self-image",
    instructions:
      "Summarize self-image and identity themes (confidence/self-worth, shame/pride, 'who you are becoming', recurring self-narratives).",
  },
  {
    id: "worldview",
    label: "Worldview / philosophical outlook",
    instructions:
      "Summarize values, beliefs, existential themes, sense-making, moral outlook, spirituality, meaning, and changes in perspective.",
  },
  {
    id: "work",
    label: "Work",
    instructions:
      "Summarize work-related thoughts: stressors, motivation, identity, leadership, boundaries, burnout, satisfaction, and patterns over time.",
  },
  {
    id: "projects",
    label: "Projects",
    instructions:
      "Summarize ongoing projects, goals, planning, progress/blocks, and how the user approaches execution and iteration.",
  },
  {
    id: "ideas",
    label: "Ideas",
    instructions:
      "Summarize recurring ideas, creative threads, hypotheses, questions, and interesting observations. Prefer concrete examples from entries when available.",
  },
  {
    id: "values",
    label: "Values & priorities",
    instructions:
      "Summarize what seems to matter most to the user, tradeoffs they are making, and where actions feel aligned or misaligned with stated values over time.",
  },
  {
    id: "habits",
    label: "Habits & routines",
    instructions:
      "Summarize habit/routine patterns (consistency, friction points, environments/cues). Focus on repeatable dynamics rather than one-off events.",
  },
  {
    id: "decisions",
    label: "Decisions & uncertainty",
    instructions:
      "Summarize major decisions, indecision patterns, uncertainty themes, and how the user weighs risk, regret, or relief over time.",
  },
  {
    id: "growth",
    label: "Growth & learning",
    instructions:
      "Summarize lessons learned, skill-building, perspective shifts, and growth edges. Highlight changes over time and what catalyzes learning.",
  },
];

type JournalEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  contentHtml: string;
};

type JournalInsightsTopic = {
  topicId: TopicId;
  summaryMarkdown: string;
  updatedAt: string;
};

type JournalInsights = {
  ownerId: string;
  topics: JournalInsightsTopic[];
  meta: {
    lastRunAt: string;
    lastProcessedMaxUpdatedAt: string | null;
    model: string;
    usage?: { input_tokens: number; output_tokens: number } | null;
  };
};

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

function options(): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|br)\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function safeIso(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

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

async function queryAllJournalEntries(
  tableName: string,
  ownerId: string,
): Promise<JournalEntry[]> {
  const out: JournalEntry[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": ownerId },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const it of r.Items ?? []) {
      const sk = it.sk;
      if (typeof sk !== "string" || !sk.startsWith("ENTRY#")) continue;
      const id = typeof it.id === "string" ? it.id : sk.slice("ENTRY#".length);
      const createdAt = safeIso(it.createdAt) ?? null;
      const updatedAt = safeIso(it.updatedAt) ?? null;
      const title = typeof it.title === "string" ? it.title : "";
      const contentHtml = typeof it.contentHtml === "string" ? it.contentHtml : "";
      if (!createdAt || !updatedAt) continue;
      out.push({ id, createdAt, updatedAt, title, contentHtml });
    }
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  out.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return out;
}

type InsightsMetaRow = {
  lastProcessedMaxUpdatedAt: string | null;
  lastRunAt: string | null;
  model?: string;
  usage?: { input_tokens: number; output_tokens: number } | null;
};

type InsightsTopicRow = {
  topicId: TopicId;
  summaryMarkdown: string;
  updatedAt: string;
};

async function loadInsights(
  table: string,
  ownerId: string,
): Promise<{ meta: InsightsMetaRow; topics: Record<TopicId, InsightsTopicRow> }> {
  const metaRes = await ddb.send(
    new GetCommand({ TableName: table, Key: { pk: ownerId, sk: "META" } }),
  );
  const metaItem = (metaRes.Item ?? {}) as Record<string, unknown>;
  const meta: InsightsMetaRow = {
    lastProcessedMaxUpdatedAt: safeIso(metaItem.lastProcessedMaxUpdatedAt) ?? null,
    lastRunAt: safeIso(metaItem.lastRunAt) ?? null,
    model: typeof metaItem.model === "string" ? metaItem.model : undefined,
    usage:
      metaItem.usage &&
      typeof metaItem.usage === "object" &&
      metaItem.usage != null &&
      typeof (metaItem.usage as { input_tokens?: unknown }).input_tokens === "number" &&
      typeof (metaItem.usage as { output_tokens?: unknown }).output_tokens === "number"
        ? (metaItem.usage as { input_tokens: number; output_tokens: number })
        : null,
  };

  const topics: Record<TopicId, InsightsTopicRow> = Object.create(null) as Record<
    TopicId,
    InsightsTopicRow
  >;
  for (const t of TOPICS) {
    const r = await ddb.send(
      new GetCommand({
        TableName: table,
        Key: { pk: ownerId, sk: `TOPIC#${t.id}` },
      }),
    );
    const it = r.Item as Record<string, unknown> | undefined;
    if (!it) continue;
    const summaryMarkdown =
      typeof it.summaryMarkdown === "string" ? it.summaryMarkdown : "";
    const updatedAt = safeIso(it.updatedAt) ?? null;
    if (!updatedAt) continue;
    topics[t.id] = { topicId: t.id, summaryMarkdown, updatedAt };
  }

  return { meta, topics };
}

function entriesDeltaSince(
  entries: JournalEntry[],
  sinceIso: string | null,
): { delta: JournalEntry[]; nextMax: string | null } {
  let nextMax: string | null = sinceIso;
  if (!sinceIso) {
    for (const e of entries) nextMax = maxIso(nextMax, e.updatedAt);
    return { delta: entries, nextMax };
  }
  const sinceMs = new Date(sinceIso).getTime();
  const delta = entries.filter((e) => new Date(e.updatedAt).getTime() > sinceMs);
  for (const e of delta) nextMax = maxIso(nextMax, e.updatedAt);
  return { delta, nextMax };
}

function formatEntriesForModel(entries: JournalEntry[]): string {
  const blocks: string[] = [];
  for (const e of entries) {
    const title = e.title.trim() || "Untitled entry";
    const body = stripHtmlToText(e.contentHtml);
    blocks.push(
      [
        `ENTRY ${e.id}`,
        `Created: ${e.createdAt}`,
        `Updated: ${e.updatedAt}`,
        `Title: ${title}`,
        `Body: ${body || "(empty)"}`,
      ].join("\n"),
    );
  }
  return blocks.join("\n\n---\n\n");
}

function buildSystemPrompt(): string {
  return [
    "You are an insightful, careful journaling analyst.",
    "You will be given the user's existing per-topic rolling summaries and a batch of NEW or UPDATED journal entries since the last run.",
    "Your job: update each topic summary to reflect the new information, focusing on patterns over time and changes.",
    "IMPORTANT: Give greater weight to more recent entries. Older themes may still matter, but recent updates should shape what is emphasized.",
    "You will also be given timestamps (entry created/updated times and the last insights run time). Use them to understand time scales and to describe changes over time accurately.",
    "STYLE: Do NOT append a new paragraph that starts with phrases like 'More recently…' onto the old summary. Each run should produce a freshly worded, cohesive summary that integrates the new information.",
    "If recent entries CONTRADICT or REVISE earlier themes, update the summary accordingly (do not preserve outdated claims just because they were in prior summaries).",
    "LENGTH: Calibrate brevity to available evidence. If there are only a few entries or a short time span, keep each topic summary brief (a few sentences). Only produce longer summaries when there is substantial history.",
    "ANTI-COPYING: The existing summaries are CONTEXT ONLY. Do not copy sentences from them or do a paragraph-by-paragraph continuation. Rewrite each topic summary from scratch in new wording and (ideally) a different structure.",
    "To avoid 'summary 1 + summary 2 + summary 3' behavior, synthesize: merge overlapping points, remove redundancy, and surface the single best integrated view per topic.",
    "Be supportive and non-judgmental. Do not diagnose medical/mental conditions.",
    "Write in second person ('you') and keep it concrete: cite specific themes or examples from entries where possible.",
    "OUTPUT CONTRACT (CRITICAL): Output MUST be valid JSON and MUST match the response schema exactly.",
    "Return ONLY JSON. Do not include any extra commentary, apologies, explanations, code fences, or surrounding text.",
    "Before responding, self-check: (1) it parses as JSON, (2) the top-level has exactly a `topics` array, (3) each item has EXACT keys `topicId` and `summaryMarkdown` (no other keys required), (4) `topicId` values are ONLY from the allowed list provided by the user prompt, and (5) there is one item per allowed topicId (no duplicates).",
    "Do not include any markdown fences. Summary strings may contain markdown (bullet lists ok).",
  ].join(" ");
}

function buildUserPrompt(params: {
  topics: typeof TOPICS;
  existing: Record<TopicId, InsightsTopicRow | undefined>;
  deltaEntries: JournalEntry[];
  lastRunAt: string | null;
  lastProcessedMaxUpdatedAt: string | null;
  journalStats: {
    totalEntries: number;
    deltaEntries: number;
    earliestCreatedAt: string | null;
    latestUpdatedAt: string | null;
  };
}): string {
  const existingJson: Record<string, unknown> = {};
  for (const t of params.topics) {
    existingJson[t.id] = params.existing[t.id]?.summaryMarkdown ?? "";
  }
  const instructions = params.topics.map((t) => ({
    id: t.id,
    label: t.label,
    instructions: t.instructions,
  }));
  const deltaText = formatEntriesForModel(params.deltaEntries);
  const allowedTopicIds = params.topics.map((t) => t.id);
  return [
    "TASK: Update rolling topic summaries from NEW/UPDATED entries.",
    "You MUST use the existing summaries + the new/updated entries, but write a freshly worded cohesive summary for each topic (not an append).",
    "Weight recent entries more heavily than older ones when deciding what to emphasize.",
    "Do not preserve prior phrasing. Treat prior summaries as notes; produce a rewritten synthesis.",
    "",
    "TIME CONTEXT:",
    JSON.stringify(
      {
        lastInsightsRunAt: params.lastRunAt,
        lastProcessedMaxUpdatedAt: params.lastProcessedMaxUpdatedAt,
        deltaEntriesCount: params.deltaEntries.length,
        journalStats: params.journalStats,
      },
      null,
      2,
    ),
    "",
    "ALLOWED TOPIC IDS (MUST use these exact strings, in this exact order, exactly once each):",
    JSON.stringify(allowedTopicIds),
    "",
    "RESPONSE TEMPLATE (copy exactly; fill in summaryMarkdown strings):",
    JSON.stringify(
      {
        topics: allowedTopicIds.map((id) => ({
          topicId: id,
          summaryMarkdown: "",
        })),
      },
      null,
      2,
    ),
    "",
    "LENGTH GUIDELINES (apply per topic):",
    "- If totalEntries <= 3 or time span is short: 2–4 sentences, no long lists.",
    "- If totalEntries is moderate: 4–8 sentences, optionally a short bullet list.",
    "- If there is lots of history: you may be longer, but stay concise and avoid redundancy.",
    "- Prefer a structured synthesis over chronology (avoid 'first..., then..., more recently...').",
    "",
    "TOPICS:",
    JSON.stringify(instructions, null, 2),
    "",
    "EXISTING_SUMMARIES_BY_TOPIC_ID (may be empty strings on first run):",
    JSON.stringify(existingJson, null, 2),
    "",
    "NEW_OR_UPDATED_ENTRIES:",
    deltaText || "(none)",
    "",
  ].join("\n");
}

function normalizeTopicId(raw: string): TopicId | null {
  const t = raw.trim();
  if (!t) return null;
  if (TOPICS.some((x) => x.id === t)) return t as TopicId;
  const norm = t.toLowerCase().replace(/[^a-z]/g, "");
  const aliases: Record<string, TopicId> = {
    overview: "overview",
    emotions: "emotions",
    emotionsmoodpatterns: "emotions",
    mood: "emotions",
    stress: "stress",
    stresscoping: "stress",
    health: "health",
    healthbody: "health",
    body: "health",
    relationships: "relationships",
    relationship: "relationships",
    identity: "identity",
    identityselfimage: "identity",
    selfimage: "identity",
    worldview: "worldview",
    worldviewphilosophicaloutlook: "worldview",
    philosophy: "worldview",
    work: "work",
    projects: "projects",
    project: "projects",
    ideas: "ideas",
    values: "values",
    valuespriorities: "values",
    habits: "habits",
    habitsroutines: "habits",
    routines: "habits",
    decisions: "decisions",
    decisionsuncertainty: "decisions",
    uncertainty: "decisions",
    growth: "growth",
    growthlearning: "growth",
    learning: "growth",
  };
  return aliases[norm] ?? null;
}

function parseInsightsJson(
  text: string,
): Array<{ topicId: TopicId; summaryMarkdown: string }> | null {
  const raw = extractJsonObjectFromText(text) ?? text;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const topicsRaw: unknown =
      Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object"
          ? (parsed as { topics?: unknown }).topics
          : null;
    if (!Array.isArray(topicsRaw)) return null;

    const out: Array<{ topicId: TopicId; summaryMarkdown: string }> = [];
    for (const x of topicsRaw) {
      if (!x || typeof x !== "object") continue;
      const r = x as Record<string, unknown>;
      const idRaw =
        (typeof r.topicId === "string" ? r.topicId : null) ??
        (typeof r.id === "string" ? r.id : null) ??
        (typeof r.topic === "string" ? r.topic : null);
      const topicId = typeof idRaw === "string" ? normalizeTopicId(idRaw) : null;
      const summaryMarkdown =
        typeof r.summaryMarkdown === "string"
          ? r.summaryMarkdown
          : typeof r.summary === "string"
            ? r.summary
            : typeof r.text === "string"
              ? r.text
              : "";
      if (!topicId) continue;
      out.push({ topicId, summaryMarkdown });
    }

    if (!out.length) return null;

    // Ensure all topics exist; fill missing with empty.
    for (const t of TOPICS) {
      if (!out.some((x) => x.topicId === t.id)) {
        out.push({ topicId: t.id, summaryMarkdown: "" });
      }
    }

    // De-dupe, keep last occurrence.
    const byId = new Map<TopicId, string>();
    for (const x of out) byId.set(x.topicId, x.summaryMarkdown);
    return TOPICS.map((t) => ({
      topicId: t.id,
      summaryMarkdown: byId.get(t.id) ?? "",
    }));
  } catch {
    return null;
  }
}

/**
 * Claude sometimes wraps JSON in extra text. This extracts the first balanced JSON object.
 * It is intentionally conservative: it only returns something if we can find a full `{...}` block.
 */
function extractJsonObjectFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // Fast path
  if (t.startsWith("{") && t.endsWith("}")) return t;

  const start = t.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < t.length; i += 1) {
    const ch = t[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = t.slice(start, i + 1).trim();
        return candidate.startsWith("{") && candidate.endsWith("}") ? candidate : null;
      }
      if (depth < 0) return null;
    }
  }
  return null;
}

async function callClaudeForInsights(params: {
  apiKey: string;
  system: string;
  user: string;
}): Promise<{ jsonText: string; usage: { input_tokens: number; output_tokens: number } | null }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 1800,
      temperature: 0.2,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const slice = text.slice(0, 600);
    throw new Error(`Anthropic request failed (${res.status}): ${slice}`);
  }
  const usage = parseAnthropicMessageUsage(text);
  // Anthropic response shape: { content: [{type:"text", text:"..."}], ... }
  try {
    const o = JSON.parse(text) as { content?: Array<{ type?: string; text?: string }> };
    const block = Array.isArray(o.content) ? o.content.find((b) => b?.type === "text") : undefined;
    const outText = typeof block?.text === "string" ? block.text.trim() : "";
    if (!outText) throw new Error("Empty Claude response");
    return { jsonText: outText, usage };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid Anthropic JSON";
    throw new Error(msg);
  }
}

async function saveInsights(params: {
  table: string;
  ownerId: string;
  topics: Array<{ topicId: TopicId; summaryMarkdown: string }>;
  lastProcessedMaxUpdatedAt: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number } | null;
}): Promise<void> {
  const now = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: params.table,
      Item: {
        pk: params.ownerId,
        sk: "META",
        lastRunAt: now,
        lastProcessedMaxUpdatedAt: params.lastProcessedMaxUpdatedAt,
        model: params.model,
        usage: params.usage,
      },
    }),
  );
  for (const t of params.topics) {
    await ddb.send(
      new PutCommand({
        TableName: params.table,
        Item: {
          pk: params.ownerId,
          sk: `TOPIC#${t.topicId}`,
          topicId: t.topicId,
          updatedAt: now,
          summaryMarkdown: t.summaryMarkdown,
        },
      }),
    );
  }
}

function snippet(s: string, n: number): string {
  const t = s ?? "";
  if (t.length <= n) return t;
  return t.slice(0, n);
}

function tailSnippet(s: string, n: number): string {
  const t = s ?? "";
  if (t.length <= n) return t;
  return t.slice(-n);
}

function buildResponse(ownerId: string, meta: InsightsMetaRow, topics: Record<TopicId, InsightsTopicRow>): JournalInsights {
  const topicArr: JournalInsightsTopic[] = TOPICS.map((t) => ({
    topicId: t.id,
    summaryMarkdown: topics[t.id]?.summaryMarkdown ?? "",
    updatedAt: topics[t.id]?.updatedAt ?? (meta.lastRunAt ?? new Date().toISOString()),
  }));
  return {
    ownerId,
    topics: topicArr,
    meta: {
      lastRunAt: meta.lastRunAt ?? new Date().toISOString(),
      lastProcessedMaxUpdatedAt: meta.lastProcessedMaxUpdatedAt ?? null,
      model: meta.model ?? CLAUDE_HAIKU_45_MODEL_ID,
      usage: meta.usage ?? null,
    },
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();

  const journalTable = process.env.JOURNAL_TABLE_NAME?.trim();
  const insightsTable = process.env.JOURNAL_INSIGHTS_TABLE_NAME?.trim();
  if (!journalTable || !insightsTable) {
    return json(500, { error: "Journal tables are not configured" });
  }

  const auth = await requireUserJson(event);
  if ("statusCode" in auth) return auth;
  const ownerId = (auth as { sub: string }).sub;

  if (method === "GET") {
    try {
      const loaded = await loadInsights(insightsTable, ownerId);
      return json(200, { insights: buildResponse(ownerId, loaded.meta, loaded.topics) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Read failed";
      return json(500, { error: msg });
    }
  }

  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let mode: "update" | "regenerate" = "update";
  try {
    const bodyRaw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
      : (event.body ?? "");
    const parsed = JSON.parse(bodyRaw || "{}") as { mode?: unknown };
    if (parsed.mode === "regenerate") mode = "regenerate";
  } catch {
    /* ignore */
  }

  try {
    const loaded = await loadInsights(insightsTable, ownerId);
    const entries = await queryAllJournalEntries(journalTable, ownerId);
    const { delta, nextMax } =
      mode === "regenerate"
        ? entriesDeltaSince(entries, null)
        : entriesDeltaSince(entries, loaded.meta.lastProcessedMaxUpdatedAt ?? null);

    // If no deltas, just return current.
    if (!delta.length) {
      return json(200, { insights: buildResponse(ownerId, loaded.meta, loaded.topics) });
    }

    // Keep request bounded: if first run has lots of history, summarize most recent.
    const maxDelta = 80;
    const deltaBounded = delta.length > maxDelta ? delta.slice(-maxDelta) : delta;

    const earliestCreatedAt =
      entries.length > 0 ? entries[0].createdAt : null;
    let latestUpdatedAt: string | null = null;
    for (const e of entries) {
      latestUpdatedAt = maxIso(latestUpdatedAt, e.updatedAt);
    }

    const apiKey = await getClaudeApiKey();
    const system = buildSystemPrompt();
    const user = buildUserPrompt({
      topics: TOPICS,
      existing:
        mode === "regenerate"
          ? ({} as Record<TopicId, InsightsTopicRow | undefined>)
          : (loaded.topics as unknown as Record<TopicId, InsightsTopicRow | undefined>),
      deltaEntries: deltaBounded,
      lastRunAt: mode === "regenerate" ? null : (loaded.meta.lastRunAt ?? null),
      lastProcessedMaxUpdatedAt:
        mode === "regenerate" ? null : (loaded.meta.lastProcessedMaxUpdatedAt ?? null),
      journalStats: {
        totalEntries: entries.length,
        deltaEntries: deltaBounded.length,
        earliestCreatedAt,
        latestUpdatedAt,
      },
    });
    const { jsonText, usage } = await callClaudeForInsights({ apiKey, system, user });
    const parsed = parseInsightsJson(jsonText);
    if (!parsed) {
      const extracted = extractJsonObjectFromText(jsonText);
      return json(502, {
        error: "Claude returned invalid insights JSON",
        debug: {
          mode,
          textLength: jsonText.length,
          extractedObjectFound: Boolean(extracted),
          extractedLength: extracted ? extracted.length : 0,
          head: snippet(jsonText, 500),
          tail: tailSnippet(jsonText, 500),
          extractedHead: extracted ? snippet(extracted, 500) : "",
          extractedTail: extracted ? tailSnippet(extracted, 500) : "",
        },
      });
    }

    await saveInsights({
      table: insightsTable,
      ownerId,
      topics: parsed,
      lastProcessedMaxUpdatedAt: nextMax,
      model: CLAUDE_HAIKU_45_MODEL_ID,
      usage,
    });

    const refreshed = await loadInsights(insightsTable, ownerId);
    return json(200, { insights: buildResponse(ownerId, refreshed.meta, refreshed.topics) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Insights run failed";
    return json(500, { error: msg });
  }
}

