import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { CLAUDE_HAIKU_45_MODEL_ID } from "../lib/anthropic-pricing";
import { optionalUserJson } from "../lib/medimade-auth-http";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const secrets = new SecretsManagerClient({});
let cachedClaudeKey: string | undefined;

const MAX_UNITS = 180;
const MAX_BODY_CHARS = 140_000;

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
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
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

type AnnotUnit = {
  fileName?: string;
  page?: number;
  type?: string;
  contents?: string;
  pageText?: string;
  annotDate?: string | null;
};

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

function ymdOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  let body: { units?: unknown; sessionToken?: string };
  try {
    body = JSON.parse(event.body || "{}") as {
      units?: unknown;
      sessionToken?: string;
    };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );

  if (!Array.isArray(body.units) || body.units.length === 0) {
    return json(400, { error: "Field `units` must be a non-empty array" });
  }

  const units: AnnotUnit[] = body.units.slice(0, MAX_UNITS).map((raw) => {
    const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return {
      fileName: typeof o.fileName === "string" ? o.fileName.slice(0, 200) : "",
      page: typeof o.page === "number" ? o.page : 0,
      type: typeof o.type === "string" ? o.type.slice(0, 40) : "",
      contents: typeof o.contents === "string" ? o.contents.slice(0, 4000) : "",
      pageText: typeof o.pageText === "string" ? o.pageText.slice(0, 2500) : "",
      annotDate: typeof o.annotDate === "string" ? o.annotDate : null,
    };
  });

  const packed = JSON.stringify(units);
  if (packed.length > MAX_BODY_CHARS) {
    return json(413, {
      error: "That PDF extract is too large to date in one go. Try fewer pages.",
    });
  }

  let apiKey: string;
  try {
    apiKey = await getClaudeApiKey();
  } catch (e) {
    return json(500, {
      error: e instanceof Error ? e.message : "Secret lookup failed",
    });
  }

  const system = [
    "You turn PDF journal annotations into dated journal entries.",
    "Group nearby annotations on the same page (or clearly the same writing session) into one entry.",
    "Each entry needs a title (short) and a body (the person's words / highlighted text, cleaned into readable prose).",
    "Dates: ONLY use dates you can read in the page text, headers, or annotation timestamps.",
    "Never invent today's date. Never guess a year you cannot see.",
    "If you cannot confidently date the entries from the material, set dates_found to false and still return the grouped entries with date null.",
    "If you CAN date them, set dates_found true and give every entry a date as YYYY-MM-DD.",
    "Respond with JSON only: {\"dates_found\": boolean, \"entries\": [{\"title\": string, \"body\": string, \"date\": string|null}]}",
  ].join(" ");

  const user = `Annotations extracted from PDFs (not full page scans unless noted):\n${packed}`;

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 8000,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    return json(upstream.status >= 400 ? upstream.status : 502, {
      error: "Claude request failed",
      detail: detail.slice(0, 1500),
    });
  }

  let modelText = "";
  try {
    const data = (await upstream.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    modelText = (data.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("\n");
  } catch {
    return json(502, { error: "Could not read Claude’s reply" });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJsonObject(modelText);
  } catch {
    return json(502, { error: "Claude did not return usable JSON" });
  }

  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const entries: Array<{ title: string; body: string; date: string | null }> = [];
  for (const raw of rawEntries) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const bodyText = typeof o.body === "string" ? o.body.trim() : "";
    if (!bodyText) continue;
    const title = typeof o.title === "string" ? o.title.trim().slice(0, 160) : "";
    entries.push({
      title,
      body: bodyText.slice(0, 20_000),
      date: ymdOrNull(o.date),
    });
  }

  if (!entries.length) {
    return json(200, {
      dates_found: false,
      entries: [],
      error:
        "Nothing readable came back from those annotations. They may be handwriting-only ink with no text layer.",
    });
  }

  const allDated = entries.every((e) => Boolean(e.date));
  const dates_found = parsed.dates_found === true && allDated;

  if (dates_found) {
    entries.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  }

  return json(200, { dates_found, entries });
}
