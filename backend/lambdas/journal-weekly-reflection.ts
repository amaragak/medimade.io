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
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  CLAUDE_HAIKU_45_MODEL_ID,
  parseAnthropicMessageUsage,
} from "../lib/anthropic-pricing";
import { optionalUserJson } from "../lib/medimade-auth-http";
import {
  LEGACY_MEDITATION_PARTITION_PK,
  meditationGlobalUserPk,
  meditationUserPk,
} from "../lib/meditation-user-pk";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const secrets = new SecretsManagerClient({});
let cachedClaudeKey: string | undefined;

const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

type JournalEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  contentHtml: string;
};

type WeeklyReflection = {
  ownerId: string;
  weekKey: string;
  weekStart: string;
  weekEnd: string;
  letterMarkdown: string;
  meta: {
    generatedAt: string;
    model: string;
    journalEntryCount: number;
    meditationChatCount: number;
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

function inRange(iso: string, start: string, end: string): boolean {
  const t = new Date(iso).getTime();
  return t >= new Date(start).getTime() && t <= new Date(end).getTime();
}

/** Monday-start week; `weekKey` is the Monday calendar date (YYYY-MM-DD). */
function weekBoundsFromDate(d = new Date()): {
  weekKey: string;
  weekStart: string;
  weekEnd: string;
} {
  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = local.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(local);
  monday.setDate(local.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const weekKey = monday.toISOString().slice(0, 10);
  return { weekKey, weekStart: monday.toISOString(), weekEnd: sunday.toISOString() };
}

function formatWeekLabel(weekStart: string, weekEnd: string): string {
  try {
    const s = new Date(weekStart);
    const e = new Date(weekEnd);
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    const sy = s.getFullYear();
    const ey = e.getFullYear();
    if (sy === ey) {
      return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
    }
    return `${s.toLocaleDateString(undefined, { ...opts, year: "numeric" })} – ${e.toLocaleDateString(undefined, { ...opts, year: "numeric" })}`;
  } catch {
    return `${weekStart.slice(0, 10)} – ${weekEnd.slice(0, 10)}`;
  }
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

async function queryAllJournalItems(
  tableName: string,
  ownerId: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
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
    for (const it of r.Items ?? []) items.push(it as Record<string, unknown>);
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

async function scanAllJournalItems(tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const it of r.Items ?? []) items.push(it as Record<string, unknown>);
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

function journalItemsToWeekEntries(
  items: Record<string, unknown>[],
  weekStart: string,
  weekEnd: string,
): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const item of items) {
    const sk = item.sk;
    if (typeof sk !== "string" || !sk.startsWith("ENTRY#")) continue;
    const id = typeof item.id === "string" ? item.id : sk.slice("ENTRY#".length);
    const createdAt = safeIso(item.createdAt);
    const updatedAt = safeIso(item.updatedAt);
    const title = typeof item.title === "string" ? item.title : "";
    const contentHtml = typeof item.contentHtml === "string" ? item.contentHtml : "";
    if (!createdAt || !updatedAt) continue;
    if (!inRange(updatedAt, weekStart, weekEnd) && !inRange(createdAt, weekStart, weekEnd)) {
      continue;
    }
    out.push({ id, createdAt, updatedAt, title, contentHtml });
  }
  out.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
  return out;
}

async function queryAllMeditationItems(
  tableName: string,
  pk: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ScanIndexForward: false,
        ExclusiveStartKey: lek,
      }),
    );
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    lek = out.LastEvaluatedKey;
  } while (lek);
  return items;
}

async function scanAllMeditationItems(tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        ExclusiveStartKey: lek,
      }),
    );
    items.push(...((out.Items ?? []) as Record<string, unknown>[]));
    lek = out.LastEvaluatedKey;
  } while (lek);
  return items;
}

function parseDraftState(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function formatDraftChat(state: Record<string, unknown>): string {
  const lines: string[] = [];
  const messages = state.messages;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      if (!m || typeof m !== "object") continue;
      const row = m as Record<string, unknown>;
      if (row.variant === "script") continue;
      const role = row.role === "assistant" ? "Guide" : row.role === "user" ? "You" : null;
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (!role || !text) continue;
      lines.push(`${role}: ${text}`);
    }
  }
  const claudeThread = state.claudeThread;
  if (Array.isArray(claudeThread) && lines.length === 0) {
    for (const m of claudeThread) {
      if (!m || typeof m !== "object") continue;
      const row = m as Record<string, unknown>;
      const role =
        row.role === "assistant" ? "Guide" : row.role === "user" ? "You" : null;
      const text = typeof row.content === "string" ? row.content.trim() : "";
      if (!role || !text) continue;
      lines.push(`${role}: ${text}`);
    }
  }
  return lines.join("\n");
}

type MeditationChatSource = {
  label: string;
  when: string;
  text: string;
};

function meditationRowsToWeekChats(
  rows: Record<string, unknown>[],
  weekStart: string,
  weekEnd: string,
): MeditationChatSource[] {
  const out: MeditationChatSource[] = [];
  for (const row of rows) {
    const createdAt = safeIso(row.createdAt);
    if (!createdAt || !inRange(createdAt, weekStart, weekEnd)) continue;

    const title =
      typeof row.title === "string" && row.title.trim() ? row.title.trim() : "Meditation";
    const style =
      typeof row.meditationStyle === "string" && row.meditationStyle.trim()
        ? row.meditationStyle.trim()
        : null;
    const draftState = parseDraftState(row.draftState);
    const chat = draftState ? formatDraftChat(draftState) : "";
    if (chat.trim()) {
      out.push({
        label: `${title}${style ? ` (${style})` : ""}${row.isDraft === true ? " · draft" : ""}`,
        when: createdAt,
        text: chat.trim(),
      });
      continue;
    }
    const transcript =
      typeof row.transcript === "string" && row.transcript.trim()
        ? row.transcript.trim()
        : "";
    if (transcript) {
      out.push({ label: title, when: createdAt, text: transcript });
      continue;
    }
    const scriptText =
      typeof row.scriptText === "string" && row.scriptText.trim()
        ? row.scriptText.trim()
        : "";
    if (scriptText) {
      out.push({
        label: `${title} · generated script`,
        when: createdAt,
        text: scriptText.slice(0, 2500),
      });
    }
  }
  out.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  return out;
}

async function queryWeekJobTranscripts(
  tableName: string,
  userId: string,
  weekStart: string,
  weekEnd: string,
): Promise<MeditationChatSource[]> {
  const out: MeditationChatSource[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          "userId = :uid AND createdAt BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":uid": userId,
          ":start": weekStart,
          ":end": weekEnd,
        },
        ExclusiveStartKey: lek,
      }),
    );
    for (const item of r.Items ?? []) {
      const createdAt = safeIso(item.createdAt);
      const transcript =
        typeof item.transcript === "string" ? item.transcript.trim() : "";
      if (!createdAt || !transcript) continue;
      const style =
        typeof item.meditationStyle === "string" && item.meditationStyle.trim()
          ? item.meditationStyle.trim()
          : null;
      out.push({
        label: `Create session${style ? ` (${style})` : ""}`,
        when: createdAt,
        text: transcript,
      });
    }
    lek = r.LastEvaluatedKey;
  } while (lek);
  out.sort((a, b) => new Date(a.when).getTime() - new Date(b.when).getTime());
  return out;
}

async function scanWeekJobTranscripts(
  tableName: string,
  weekStart: string,
  weekEnd: string,
): Promise<MeditationChatSource[]> {
  const out: MeditationChatSource[] = [];
  let lek: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "createdAt BETWEEN :start AND :end",
        ExpressionAttributeValues: {
          ":start": weekStart,
          ":end": weekEnd,
        },
        ExclusiveStartKey: lek,
      }),
    );
    for (const item of r.Items ?? []) {
      const createdAt = safeIso(item.createdAt);
      const transcript =
        typeof item.transcript === "string" ? item.transcript.trim() : "";
      if (!createdAt || !transcript) continue;
      out.push({
        label: "Create session",
        when: createdAt,
        text: transcript,
      });
    }
    lek = r.LastEvaluatedKey;
  } while (lek);
  return out;
}

function dedupeChats(chats: MeditationChatSource[]): MeditationChatSource[] {
  const seen = new Set<string>();
  const out: MeditationChatSource[] = [];
  for (const c of chats) {
    const key = `${c.when}::${c.text.slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function formatJournalForPrompt(entries: JournalEntry[]): string {
  if (!entries.length) return "(No journal entries this week.)";
  return entries
    .map((e) => {
      const title = e.title.trim() || "Untitled";
      const body = stripHtmlToText(e.contentHtml) || "(empty)";
      return [
        `Entry · ${title}`,
        `Updated: ${e.updatedAt}`,
        body,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

function formatChatsForPrompt(chats: MeditationChatSource[]): string {
  if (!chats.length) return "(No meditation create chats this week.)";
  return chats
    .map((c) => [`${c.label} · ${c.when}`, c.text].join("\n"))
    .join("\n\n---\n\n");
}

function buildSystemPrompt(): string {
  return [
    "You write end-of-week reflection letters for someone using a meditation and journaling app.",
    "Write directly TO the reader in second person ('you'), as a gentle letter — warm, human, and present.",
    "This is NOT a clinical report, NOT third-person analysis ('they/the user'), and NOT a bullet-point dashboard.",
    "Tone: like a thoughtful friend who has been listening all week — honest but kind, unhurried, slightly poetic when natural.",
    "Weave together what showed up in their journal entries and what they explored while creating meditations.",
    "Name specific themes, feelings, or moments when the material supports it; do not invent facts.",
    "If the week was quiet or sparse, say so gently and still offer a short, honest letter.",
    "Do not diagnose. Do not give medical advice. Do not moralize.",
    "Length: roughly 3–8 short paragraphs (about 250–500 words).",
    "You may use a simple salutation (e.g. 'Dear friend,' or their name if provided) and a soft sign-off.",
    "Output ONLY the letter body in markdown (paragraphs; optional one short italic line). No JSON.",
  ].join(" ");
}

function buildUserPrompt(params: {
  weekLabel: string;
  displayName?: string;
  journalText: string;
  chatText: string;
}): string {
  return [
    `WEEK: ${params.weekLabel}`,
    params.displayName?.trim()
      ? `Reader's name (optional salutation): ${params.displayName.trim()}`
      : "",
    "",
    "JOURNAL ENTRIES THIS WEEK:",
    params.journalText,
    "",
    "MEDITATION CREATE CHATS THIS WEEK:",
    params.chatText,
    "",
    "Write the end-of-week letter now.",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJsonObjectFromText(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
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
      if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return t.slice(start, i + 1).trim();
      if (depth < 0) return null;
    }
  }
  return null;
}

async function callClaudeForLetter(params: {
  apiKey: string;
  system: string;
  user: string;
}): Promise<{ letterMarkdown: string; usage: { input_tokens: number; output_tokens: number } | null }> {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 1200,
      temperature: 0.55,
      system: params.system,
      messages: [{ role: "user", content: params.user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic request failed (${res.status}): ${text.slice(0, 600)}`);
  }
  const usage = parseAnthropicMessageUsage(text);
  try {
    const o = JSON.parse(text) as { content?: Array<{ type?: string; text?: string }> };
    const block = Array.isArray(o.content)
      ? o.content.find((b) => b?.type === "text")
      : undefined;
    const outText = typeof block?.text === "string" ? block.text.trim() : "";
    if (!outText) throw new Error("Empty Claude response");
    const jsonObj = extractJsonObjectFromText(outText);
    if (jsonObj) {
      try {
        const parsed = JSON.parse(jsonObj) as { letterMarkdown?: unknown };
        if (typeof parsed.letterMarkdown === "string" && parsed.letterMarkdown.trim()) {
          return { letterMarkdown: parsed.letterMarkdown.trim(), usage };
        }
      } catch {
        /* fall through to plain text */
      }
    }
    return { letterMarkdown: outText, usage };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Invalid Anthropic JSON";
    throw new Error(msg);
  }
}

async function loadWeeklyReflection(
  table: string,
  ownerId: string,
  weekKey: string,
): Promise<WeeklyReflection | null> {
  const r = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: ownerId, sk: `WEEKLY#${weekKey}` },
    }),
  );
  const item = r.Item as Record<string, unknown> | undefined;
  if (!item) return null;
  const letterMarkdown =
    typeof item.letterMarkdown === "string" ? item.letterMarkdown : "";
  const weekStart = safeIso(item.weekStart);
  const weekEnd = safeIso(item.weekEnd);
  const generatedAt = safeIso(item.generatedAt);
  if (!letterMarkdown.trim() || !weekStart || !weekEnd || !generatedAt) return null;
  return {
    ownerId,
    weekKey,
    weekStart,
    weekEnd,
    letterMarkdown,
    meta: {
      generatedAt,
      model:
        typeof item.model === "string" ? item.model : CLAUDE_HAIKU_45_MODEL_ID,
      journalEntryCount:
        typeof item.journalEntryCount === "number" ? item.journalEntryCount : 0,
      meditationChatCount:
        typeof item.meditationChatCount === "number" ? item.meditationChatCount : 0,
      usage:
        item.usage &&
        typeof item.usage === "object" &&
        typeof (item.usage as { input_tokens?: unknown }).input_tokens === "number" &&
        typeof (item.usage as { output_tokens?: unknown }).output_tokens === "number"
          ? (item.usage as { input_tokens: number; output_tokens: number })
          : null,
    },
  };
}

async function saveWeeklyReflection(params: {
  table: string;
  reflection: WeeklyReflection;
}): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: params.table,
      Item: {
        pk: params.reflection.ownerId,
        sk: `WEEKLY#${params.reflection.weekKey}`,
        weekKey: params.reflection.weekKey,
        weekStart: params.reflection.weekStart,
        weekEnd: params.reflection.weekEnd,
        letterMarkdown: params.reflection.letterMarkdown,
        generatedAt: params.reflection.meta.generatedAt,
        model: params.reflection.meta.model,
        journalEntryCount: params.reflection.meta.journalEntryCount,
        meditationChatCount: params.reflection.meta.meditationChatCount,
        usage: params.reflection.meta.usage ?? undefined,
      },
    }),
  );
}

async function collectWeekData(params: {
  journalTable: string;
  analyticsTable: string;
  jobsTable: string;
  ownerId: string;
  weekStart: string;
  weekEnd: string;
  allUsers: boolean;
}): Promise<{ entries: JournalEntry[]; chats: MeditationChatSource[] }> {
  let journalItems: Record<string, unknown>[];
  let meditationRows: Record<string, unknown>[];
  let jobChats: MeditationChatSource[];

  if (params.allUsers) {
    journalItems = await scanAllJournalItems(params.journalTable);
    meditationRows = await scanAllMeditationItems(params.analyticsTable);
    jobChats = await scanWeekJobTranscripts(
      params.jobsTable,
      params.weekStart,
      params.weekEnd,
    );
  } else {
    journalItems = await queryAllJournalItems(params.journalTable, params.ownerId);
    const userPk = meditationUserPk(params.ownerId);
    const globalPk = meditationGlobalUserPk();
    const legacyPk = LEGACY_MEDITATION_PARTITION_PK;
    const [userRows, globalRows, legacyRows] = await Promise.all([
      queryAllMeditationItems(params.analyticsTable, userPk),
      queryAllMeditationItems(params.analyticsTable, globalPk),
      queryAllMeditationItems(params.analyticsTable, legacyPk),
    ]);
    meditationRows = [...userRows, ...globalRows, ...legacyRows];
    jobChats = await queryWeekJobTranscripts(
      params.jobsTable,
      params.ownerId,
      params.weekStart,
      params.weekEnd,
    );
  }

  const entries = journalItemsToWeekEntries(
    journalItems,
    params.weekStart,
    params.weekEnd,
  );
  const draftChats = meditationRowsToWeekChats(
    meditationRows,
    params.weekStart,
    params.weekEnd,
  );
  const chats = dedupeChats([...draftChats, ...jobChats]);
  return { entries, chats };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();

  const journalTable = process.env.JOURNAL_TABLE_NAME?.trim();
  const insightsTable = process.env.JOURNAL_INSIGHTS_TABLE_NAME?.trim();
  const analyticsTable = process.env.MEDITATION_ANALYTICS_TABLE_NAME?.trim();
  const jobsTable = process.env.MEDITATION_JOBS_TABLE_NAME?.trim();
  if (!journalTable || !insightsTable || !analyticsTable || !jobsTable) {
    return json(500, { error: "Weekly reflection is not configured" });
  }

  const user = await optionalUserJson(event);
  const ownerId = user?.sub ?? "__all__";
  const allUsers = !user;

  const weekParam = event.queryStringParameters?.week?.trim();
  const bounds = weekParam
    ? weekBoundsFromDate(new Date(`${weekParam}T12:00:00.000Z`))
    : weekBoundsFromDate(new Date());

  if (method === "GET") {
    try {
      const cached = await loadWeeklyReflection(
        insightsTable,
        ownerId,
        bounds.weekKey,
      );
      return json(200, {
        reflection: cached,
        weekKey: bounds.weekKey,
        weekStart: bounds.weekStart,
        weekEnd: bounds.weekEnd,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Read failed";
      return json(500, { error: msg });
    }
  }

  if (method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let regenerate = false;
  try {
    const bodyRaw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf-8")
      : (event.body ?? "");
    const parsed = JSON.parse(bodyRaw || "{}") as { regenerate?: unknown; week?: unknown };
    if (parsed.regenerate === true) regenerate = true;
    if (typeof parsed.week === "string" && parsed.week.trim()) {
      Object.assign(bounds, weekBoundsFromDate(new Date(`${parsed.week.trim()}T12:00:00.000Z`)));
    }
  } catch {
    /* ignore */
  }

  try {
    if (!regenerate) {
      const cached = await loadWeeklyReflection(
        insightsTable,
        ownerId,
        bounds.weekKey,
      );
      if (cached) {
        return json(200, {
          reflection: cached,
          weekKey: bounds.weekKey,
          weekStart: bounds.weekStart,
          weekEnd: bounds.weekEnd,
        });
      }
    }

    const { entries, chats } = await collectWeekData({
      journalTable,
      analyticsTable,
      jobsTable,
      ownerId: user?.sub ?? ownerId,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd,
      allUsers,
    });

    if (!entries.length && !chats.length) {
      return json(200, {
        reflection: null,
        weekKey: bounds.weekKey,
        weekStart: bounds.weekStart,
        weekEnd: bounds.weekEnd,
        empty: true,
      });
    }

    const apiKey = await getClaudeApiKey();
    const { letterMarkdown, usage } = await callClaudeForLetter({
      apiKey,
      system: buildSystemPrompt(),
      user: buildUserPrompt({
        weekLabel: formatWeekLabel(bounds.weekStart, bounds.weekEnd),
        displayName: user?.name,
        journalText: formatJournalForPrompt(entries),
        chatText: formatChatsForPrompt(chats),
      }),
    });

    const now = new Date().toISOString();
    const reflection: WeeklyReflection = {
      ownerId,
      weekKey: bounds.weekKey,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd,
      letterMarkdown,
      meta: {
        generatedAt: now,
        model: CLAUDE_HAIKU_45_MODEL_ID,
        journalEntryCount: entries.length,
        meditationChatCount: chats.length,
        usage,
      },
    };

    await saveWeeklyReflection({ table: insightsTable, reflection });

    return json(200, {
      reflection,
      weekKey: bounds.weekKey,
      weekStart: bounds.weekStart,
      weekEnd: bounds.weekEnd,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Weekly reflection failed";
    return json(500, { error: msg });
  }
}
