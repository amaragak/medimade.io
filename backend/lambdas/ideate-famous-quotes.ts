/**
 * Shared famous quote libraries (thinkers + works).
 * POST { source: "author"|"work", query } → Haiku resolve + Dynamo cache → 10 quotes.
 * Dynamo: AUTHOR#<slug>|WORK#<slug> / LIBRARY + ALIAS#… / MAP
 *
 * Canonicalisation / public cache is ONLY for Haiku library lookups.
 * User-written / paraphrased / personal Ideate quotes must NEVER be written here.
 */

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
} from "@aws-sdk/lib-dynamodb";
import { CLAUDE_HAIKU_45_MODEL_ID } from "../lib/anthropic-pricing";

const secrets = new SecretsManagerClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const QUOTE_COUNT = 10;
const MAX_QUERY = 80;
const MAX_QUOTE_CHARS = 400;

let cachedClaudeKey: string | undefined;

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
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Medimade-Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

/** Fold accents, casing, punctuation — "Alan Watts" ≈ "alan wats" after Haiku. */
export function normalizeAuthorKey(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function authorSlugFromKey(key: string): string {
  return key.replace(/\s+/g, "-").slice(0, 96);
}

/** "On the Road — Jack Kerouac" or just "The Bible" when no credited author. */
export function formatWorkAttribution(
  title: string,
  author: string | null | undefined,
): string {
  const t = title.trim();
  const a = typeof author === "string" ? author.trim() : "";
  if (!t) return a;
  if (!a) return t;
  return `${t} — ${a}`;
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

type AuthorLibrary = {
  slug: string;
  displayName: string;
  quotes: string[];
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};

type WorkLibrary = {
  slug: string;
  title: string;
  /** Null/empty for anonymous or communal works (e.g. the Bible). */
  authorName: string | null;
  quotes: string[];
  aliases: string[];
  createdAt: string;
  updatedAt: string;
};

type HaikuAuthorResult = {
  isFamousPerson: boolean;
  canonicalName: string;
  quotes: string[];
};

type HaikuWorkResult = {
  isKnownWork: boolean;
  title: string;
  authorName: string | null;
  quotes: string[];
};

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model reply");
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}

function sanitizeQuotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    let t = item.trim().replace(/\s+/g, " ");
    t = t.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
    if (!t || t.length > MAX_QUOTE_CHARS) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= QUOTE_COUNT) break;
  }
  return out;
}

function optionalAuthorName(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  if (
    lower === "null" ||
    lower === "none" ||
    lower === "unknown" ||
    lower === "anonymous" ||
    lower === "n/a"
  ) {
    return null;
  }
  return t.slice(0, 120);
}

async function resolveAuthorWithHaiku(
  authorQuery: string,
): Promise<HaikuAuthorResult> {
  const apiKey = await getClaudeApiKey();
  const system = [
    "You resolve famous people and recall their well-known quotes.",
    "Unify spelling variants of the SAME person to one correct presentation name",
    '(e.g. "alan watts", "Alan Watts", "alan Wats" → "Alan Watts") when no other',
    "distinct famous person clearly matches.",
    "If the query is ambiguous between two famous people, pick the better-known match",
    "and use that person's correct full name.",
    "If the query is not a recognizable famous person (or is too vague), set isFamousPerson false.",
    "Return ONLY valid JSON — no markdown, no commentary.",
  ].join(" ");

  const user = [
    `Author query: ${JSON.stringify(authorQuery)}`,
    "",
    "Respond with JSON shaped exactly like:",
    "{",
    '  "isFamousPerson": true,',
    '  "canonicalName": "Correct Presentation Name",',
    `  "quotes": ["quote 1", "quote 2", ... exactly ${QUOTE_COUNT} well-known attributed quotes]`,
    "}",
    "",
    `Rules: quotes must be short (${MAX_QUOTE_CHARS} chars max), famous/attributed lines`,
    "widely associated with that person, no invented obscure lines, no speaker labels inside quotes,",
    `exactly ${QUOTE_COUNT} quotes when isFamousPerson is true; empty quotes array when false.`,
  ].join("\n");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 1800,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Haiku author quotes failed: ${raw.slice(0, 400)}`);
  }

  let text = "";
  try {
    const parsed = JSON.parse(raw) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    text = (parsed.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!.trim())
      .join("\n")
      .trim();
  } catch {
    throw new Error("Haiku returned invalid envelope");
  }

  const obj = extractJsonObject(text) as Record<string, unknown>;
  const isFamousPerson = obj.isFamousPerson === true;
  const canonicalName =
    typeof obj.canonicalName === "string" ? obj.canonicalName.trim() : "";
  const quotes = sanitizeQuotes(obj.quotes);
  return { isFamousPerson, canonicalName, quotes };
}

async function resolveWorkWithHaiku(workQuery: string): Promise<HaikuWorkResult> {
  const apiKey = await getClaudeApiKey();
  const system = [
    "You resolve famous works (books, scripture, poems, plays, films, songs)",
    "and recall well-known lines from them.",
    "Unify spelling/title variants of the SAME work to one correct presentation title",
    '(e.g. "on the road", "On The Road" → "On the Road").',
    "Set authorName to the primary credited author/creator when clearly known;",
    "set authorName to null for anonymous, traditional, or communal works",
    "(e.g. the Bible, many folk songs, some scripture).",
    "If the query is not a recognizable work (or is too vague), set isKnownWork false.",
    "Return ONLY valid JSON — no markdown, no commentary.",
  ].join(" ");

  const user = [
    `Work query: ${JSON.stringify(workQuery)}`,
    "",
    "Respond with JSON shaped exactly like:",
    "{",
    '  "isKnownWork": true,',
    '  "title": "Correct Work Title",',
    '  "authorName": "Author Name or null",',
    `  "quotes": ["quote 1", "quote 2", ... exactly ${QUOTE_COUNT} well-known lines from this work]`,
    "}",
    "",
    `Rules: quotes must be short (${MAX_QUOTE_CHARS} chars max), famous lines from the work`,
    "(not generic lines merely about it), no invented obscure lines, no speaker labels inside quotes,",
    `exactly ${QUOTE_COUNT} quotes when isKnownWork is true; empty quotes array when false.`,
  ].join("\n");

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 1800,
      temperature: 0.2,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Haiku work quotes failed: ${raw.slice(0, 400)}`);
  }

  let text = "";
  try {
    const parsed = JSON.parse(raw) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    text = (parsed.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!.trim())
      .join("\n")
      .trim();
  } catch {
    throw new Error("Haiku returned invalid envelope");
  }

  const obj = extractJsonObject(text) as Record<string, unknown>;
  const isKnownWork = obj.isKnownWork === true;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const authorName = optionalAuthorName(obj.authorName);
  const quotes = sanitizeQuotes(obj.quotes);
  return { isKnownWork, title, authorName, quotes };
}

async function getAlias(
  table: string,
  aliasPk: string,
): Promise<string | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: aliasPk, sk: "MAP" },
    }),
  );
  const slug = out.Item?.canonicalSlug;
  return typeof slug === "string" && slug.trim() ? slug.trim() : null;
}

function authorAliasPk(key: string): string {
  return `ALIAS#${key}`;
}

function workAliasPk(key: string): string {
  return `ALIAS#work:${key}`;
}

async function getAuthorLibrary(
  table: string,
  slug: string,
): Promise<AuthorLibrary | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: `AUTHOR#${slug}`, sk: "LIBRARY" },
    }),
  );
  const item = out.Item;
  if (!item) return null;
  const displayName =
    typeof item.displayName === "string" ? item.displayName.trim() : "";
  const quotes = sanitizeQuotes(item.quotes);
  if (!displayName || quotes.length === 0) return null;
  const aliases = Array.isArray(item.aliases)
    ? item.aliases.filter((a): a is string => typeof a === "string")
    : [];
  return {
    slug,
    displayName,
    quotes,
    aliases,
    createdAt:
      typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    updatedAt:
      typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
  };
}

async function getWorkLibrary(
  table: string,
  slug: string,
): Promise<WorkLibrary | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: `WORK#${slug}`, sk: "LIBRARY" },
    }),
  );
  const item = out.Item;
  if (!item) return null;
  const title = typeof item.title === "string" ? item.title.trim() : "";
  const quotes = sanitizeQuotes(item.quotes);
  if (!title || quotes.length === 0) return null;
  const aliases = Array.isArray(item.aliases)
    ? item.aliases.filter((a): a is string => typeof a === "string")
    : [];
  return {
    slug,
    title,
    authorName: optionalAuthorName(item.authorName),
    quotes,
    aliases,
    createdAt:
      typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    updatedAt:
      typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
  };
}

async function putAlias(table: string, aliasPk: string, canonicalSlug: string) {
  if (!aliasPk) return;
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: aliasPk,
        sk: "MAP",
        canonicalSlug,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

async function putAuthorLibrary(table: string, lib: AuthorLibrary) {
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: `AUTHOR#${lib.slug}`,
        sk: "LIBRARY",
        displayName: lib.displayName,
        quotes: lib.quotes,
        aliases: lib.aliases,
        createdAt: lib.createdAt,
        updatedAt: lib.updatedAt,
      },
    }),
  );
}

async function putWorkLibrary(table: string, lib: WorkLibrary) {
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: `WORK#${lib.slug}`,
        sk: "LIBRARY",
        title: lib.title,
        ...(lib.authorName ? { authorName: lib.authorName } : {}),
        quotes: lib.quotes,
        aliases: lib.aliases,
        createdAt: lib.createdAt,
        updatedAt: lib.updatedAt,
      },
    }),
  );
}

function responseFromAuthorLibrary(
  lib: AuthorLibrary,
  cached: boolean,
): APIGatewayProxyStructuredResultV2 {
  return json(200, {
    kind: "author",
    author: lib.displayName,
    authorSlug: lib.slug,
    attribution: lib.displayName,
    quotes: lib.quotes.slice(0, QUOTE_COUNT),
    cached,
  });
}

function responseFromWorkLibrary(
  lib: WorkLibrary,
  cached: boolean,
): APIGatewayProxyStructuredResultV2 {
  const attribution = formatWorkAttribution(lib.title, lib.authorName);
  return json(200, {
    kind: "work",
    workTitle: lib.title,
    workAuthor: lib.authorName,
    workSlug: lib.slug,
    attribution,
    quotes: lib.quotes.slice(0, QUOTE_COUNT),
    cached,
  });
}

async function handleAuthorQuery(
  table: string,
  authorQuery: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const queryKey = normalizeAuthorKey(authorQuery);
  if (!queryKey) {
    return json(400, { error: "query is empty after normalization" });
  }

  const aliased = await getAlias(table, authorAliasPk(queryKey));
  if (aliased) {
    const lib = await getAuthorLibrary(table, aliased);
    if (lib) return responseFromAuthorLibrary(lib, true);
  }

  const directSlug = authorSlugFromKey(queryKey);
  const direct = await getAuthorLibrary(table, directSlug);
  if (direct) {
    await putAlias(table, authorAliasPk(queryKey), direct.slug);
    return responseFromAuthorLibrary(direct, true);
  }

  const haiku = await resolveAuthorWithHaiku(authorQuery);
  if (!haiku.isFamousPerson || !haiku.canonicalName) {
    return json(404, {
      error: "No famous person matched that name",
      query: authorQuery,
    });
  }

  const canonicalKey = normalizeAuthorKey(haiku.canonicalName);
  if (!canonicalKey) {
    return json(404, { error: "Could not resolve a canonical author name" });
  }
  const slug = authorSlugFromKey(canonicalKey);

  const existing = await getAuthorLibrary(table, slug);
  if (existing) {
    const aliases = Array.from(
      new Set([...existing.aliases, queryKey, canonicalKey]),
    );
    const now = new Date().toISOString();
    const next: AuthorLibrary = {
      ...existing,
      displayName: haiku.canonicalName.trim() || existing.displayName,
      aliases,
      updatedAt: now,
    };
    await putAuthorLibrary(table, next);
    await putAlias(table, authorAliasPk(queryKey), slug);
    await putAlias(table, authorAliasPk(canonicalKey), slug);
    return responseFromAuthorLibrary(next, true);
  }

  const quotes = haiku.quotes;
  if (quotes.length < 5) {
    return json(502, {
      error: "Haiku returned too few quotes for this author",
      author: haiku.canonicalName,
    });
  }

  const now = new Date().toISOString();
  const lib: AuthorLibrary = {
    slug,
    displayName: haiku.canonicalName.trim(),
    quotes,
    aliases: Array.from(new Set([queryKey, canonicalKey])),
    createdAt: now,
    updatedAt: now,
  };
  await putAuthorLibrary(table, lib);
  await putAlias(table, authorAliasPk(queryKey), slug);
  await putAlias(table, authorAliasPk(canonicalKey), slug);
  return responseFromAuthorLibrary(lib, false);
}

async function handleWorkQuery(
  table: string,
  workQuery: string,
): Promise<APIGatewayProxyStructuredResultV2> {
  const queryKey = normalizeAuthorKey(workQuery);
  if (!queryKey) {
    return json(400, { error: "query is empty after normalization" });
  }

  const aliased = await getAlias(table, workAliasPk(queryKey));
  if (aliased) {
    const lib = await getWorkLibrary(table, aliased);
    if (lib) return responseFromWorkLibrary(lib, true);
  }

  const directSlug = authorSlugFromKey(queryKey);
  const direct = await getWorkLibrary(table, directSlug);
  if (direct) {
    await putAlias(table, workAliasPk(queryKey), direct.slug);
    return responseFromWorkLibrary(direct, true);
  }

  const haiku = await resolveWorkWithHaiku(workQuery);
  if (!haiku.isKnownWork || !haiku.title) {
    return json(404, {
      error: "No known work matched that title",
      query: workQuery,
    });
  }

  const canonicalKey = normalizeAuthorKey(haiku.title);
  if (!canonicalKey) {
    return json(404, { error: "Could not resolve a canonical work title" });
  }
  const slug = authorSlugFromKey(canonicalKey);

  const existing = await getWorkLibrary(table, slug);
  if (existing) {
    const aliases = Array.from(
      new Set([...existing.aliases, queryKey, canonicalKey]),
    );
    const now = new Date().toISOString();
    const next: WorkLibrary = {
      ...existing,
      title: haiku.title.trim() || existing.title,
      authorName:
        haiku.authorName !== undefined ? haiku.authorName : existing.authorName,
      aliases,
      updatedAt: now,
    };
    await putWorkLibrary(table, next);
    await putAlias(table, workAliasPk(queryKey), slug);
    await putAlias(table, workAliasPk(canonicalKey), slug);
    return responseFromWorkLibrary(next, true);
  }

  const quotes = haiku.quotes;
  if (quotes.length < 5) {
    return json(502, {
      error: "Haiku returned too few quotes for this work",
      workTitle: haiku.title,
    });
  }

  const now = new Date().toISOString();
  const lib: WorkLibrary = {
    slug,
    title: haiku.title.trim(),
    authorName: haiku.authorName,
    quotes,
    aliases: Array.from(new Set([queryKey, canonicalKey])),
    createdAt: now,
    updatedAt: now,
  };
  await putWorkLibrary(table, lib);
  await putAlias(table, workAliasPk(queryKey), slug);
  await putAlias(table, workAliasPk(canonicalKey), slug);
  return responseFromWorkLibrary(lib, false);
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  const table = process.env.FAMOUS_QUOTES_TABLE_NAME?.trim();
  if (!table) return json(500, { error: "FAMOUS_QUOTES_TABLE_NAME is not set" });

  let bodyRaw = event.body ?? "";
  if (event.isBase64Encoded && bodyRaw) {
    bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
  }
  let body: {
    source?: unknown;
    query?: unknown;
    authorQuery?: unknown;
    workQuery?: unknown;
  };
  try {
    body = JSON.parse(bodyRaw || "{}") as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const sourceRaw =
    typeof body.source === "string" ? body.source.trim().toLowerCase() : "";
  const source: "author" | "work" =
    sourceRaw === "work"
      ? "work"
      : sourceRaw === "author" || !sourceRaw
        ? "author"
        : "author";

  const query =
    (typeof body.query === "string" ? body.query.trim() : "") ||
    (source === "work"
      ? typeof body.workQuery === "string"
        ? body.workQuery.trim()
        : ""
      : typeof body.authorQuery === "string"
        ? body.authorQuery.trim()
        : "");
  const clipped = query.slice(0, MAX_QUERY);
  if (clipped.length < 2) {
    return json(400, {
      error: "query must be at least 2 characters",
    });
  }

  try {
    if (source === "work") return await handleWorkQuery(table, clipped);
    return await handleAuthorQuery(table, clipped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Famous quotes lookup failed";
    return json(500, { error: msg });
  }
}
