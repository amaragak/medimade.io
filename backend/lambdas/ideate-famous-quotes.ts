/**
 * Shared famous-author quote libraries.
 * POST { authorQuery } → resolve/cache via Haiku → 10 quotes.
 * Dynamo: AUTHOR#<slug> / LIBRARY + ALIAS#<normalized> / MAP
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

/** Fold accents, casing, punctuation — "Alan Watts" ≈ "alan wats" after Haiku, same key for exact folds. */
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

type HaikuAuthorResult = {
  isFamousPerson: boolean;
  canonicalName: string;
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

async function resolveWithHaiku(authorQuery: string): Promise<HaikuAuthorResult> {
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

async function getAlias(
  table: string,
  key: string,
): Promise<string | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: `ALIAS#${key}`, sk: "MAP" },
    }),
  );
  const slug = out.Item?.canonicalSlug;
  return typeof slug === "string" && slug.trim() ? slug.trim() : null;
}

async function getLibrary(
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

async function putAlias(table: string, key: string, canonicalSlug: string) {
  if (!key) return;
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: {
        pk: `ALIAS#${key}`,
        sk: "MAP",
        canonicalSlug,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
}

async function putLibrary(table: string, lib: AuthorLibrary) {
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

function responseFromLibrary(
  lib: AuthorLibrary,
  cached: boolean,
): APIGatewayProxyStructuredResultV2 {
  return json(200, {
    author: lib.displayName,
    authorSlug: lib.slug,
    quotes: lib.quotes.slice(0, QUOTE_COUNT),
    cached,
  });
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
  let body: { authorQuery?: unknown };
  try {
    body = JSON.parse(bodyRaw || "{}") as { authorQuery?: unknown };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const authorQuery =
    typeof body.authorQuery === "string" ? body.authorQuery.trim().slice(0, MAX_QUERY) : "";
  if (authorQuery.length < 2) {
    return json(400, { error: "authorQuery must be at least 2 characters" });
  }

  const queryKey = normalizeAuthorKey(authorQuery);
  if (!queryKey) {
    return json(400, { error: "authorQuery is empty after normalization" });
  }

  try {
    // 1) Exact alias / fold hit
    const aliased = await getAlias(table, queryKey);
    if (aliased) {
      const lib = await getLibrary(table, aliased);
      if (lib) return responseFromLibrary(lib, true);
    }

    // 2) Direct slug hit (query already matches canonical fold)
    const directSlug = authorSlugFromKey(queryKey);
    const direct = await getLibrary(table, directSlug);
    if (direct) {
      await putAlias(table, queryKey, direct.slug);
      return responseFromLibrary(direct, true);
    }

    // 3) Haiku resolve + fetch
    const haiku = await resolveWithHaiku(authorQuery);
    if (!haiku.isFamousPerson || !haiku.canonicalName) {
      return json(404, {
        error: "No famous person matched that name",
        authorQuery,
      });
    }

    const canonicalKey = normalizeAuthorKey(haiku.canonicalName);
    if (!canonicalKey) {
      return json(404, { error: "Could not resolve a canonical author name" });
    }
    const slug = authorSlugFromKey(canonicalKey);

    // 4) Existing library under canonical identity (spelling unified)
    const existing = await getLibrary(table, slug);
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
      await putLibrary(table, next);
      await putAlias(table, queryKey, slug);
      await putAlias(table, canonicalKey, slug);
      return responseFromLibrary(next, true);
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
    await putLibrary(table, lib);
    await putAlias(table, queryKey, slug);
    await putAlias(table, canonicalKey, slug);
    return responseFromLibrary(lib, false);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Famous quotes lookup failed";
    return json(500, { error: msg });
  }
}
