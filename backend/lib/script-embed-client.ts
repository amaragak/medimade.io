/**
 * Invoke the Python fastembed ScriptEmbed Lambda from Node.
 */
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { markVariantsEmbedPending } from "./script-lab-embed-queue";

const lambdaClient = new LambdaClient({});

export type ScriptEmbedSearchMatch = {
  id: string;
  tag: string;
  text: string;
  score: number;
  lengthTier?: string | null;
  direction?: string | null;
  source?: string;
  approved?: boolean;
};

export type ScriptEmbedSearchResult = {
  queryIndex: number;
  embedding: number[];
  matches: ScriptEmbedSearchMatch[];
};

function embedFunctionName(): string | null {
  const name = process.env.SCRIPT_EMBED_FUNCTION_NAME?.trim();
  return name || null;
}

function requireEmbedFunctionName(): string {
  const name = embedFunctionName();
  if (!name) throw new Error("SCRIPT_EMBED_FUNCTION_NAME is not set");
  return name;
}

export type ScriptEmbedInvokeResult = {
  ok: boolean;
  functionName: string;
  durationMs: number;
  statusCode?: number;
  functionError?: string;
  rawPayload: string;
  parsed: Record<string, unknown> | null;
  error?: string;
};

/** Sync invoke with full diagnostics (used by Script Lab test-embed). */
export async function invokeEmbedLambdaDiagnostic(
  payload: Record<string, unknown>,
): Promise<ScriptEmbedInvokeResult> {
  const functionName = requireEmbedFunctionName();
  const started = Date.now();
  let res;
  try {
    res = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        Payload: Buffer.from(JSON.stringify(payload)),
        LogType: "Tail",
      }),
    );
  } catch (e) {
    return {
      ok: false,
      functionName,
      durationMs: Date.now() - started,
      rawPayload: "",
      parsed: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
  const rawPayload = res.Payload ? Buffer.from(res.Payload).toString("utf8") : "";
  const functionError = res.FunctionError?.trim() || undefined;
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  if (rawPayload) {
    try {
      parsed = JSON.parse(rawPayload) as Record<string, unknown>;
    } catch {
      parseError = `Invalid JSON from embed Lambda: ${rawPayload.slice(0, 500)}`;
    }
  }
  const logTail = res.LogResult
    ? Buffer.from(res.LogResult, "base64").toString("utf8").slice(-2000)
    : undefined;
  if (functionError || parseError || parsed?.ok === false) {
    const parts = [
      functionError ? `FunctionError=${functionError}` : null,
      parseError,
      parsed?.error != null ? String(parsed.error) : null,
      logTail ? `--- CloudWatch log tail ---\n${logTail}` : null,
    ].filter(Boolean);
    return {
      ok: false,
      functionName,
      durationMs: Date.now() - started,
      statusCode: res.StatusCode,
      functionError,
      rawPayload: rawPayload.slice(0, 4000),
      parsed,
      error: parts.join("\n") || "Script embed Lambda failed",
    };
  }
  return {
    ok: true,
    functionName,
    durationMs: Date.now() - started,
    statusCode: res.StatusCode,
    rawPayload: rawPayload.slice(0, 4000),
    parsed: parsed ?? {},
  };
}

async function invokeEmbedLambda(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const diag = await invokeEmbedLambdaDiagnostic(payload);
  if (!diag.ok || !diag.parsed) {
    throw new Error(diag.error ?? "Script embed Lambda failed");
  }
  return diag.parsed;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out = await invokeEmbedLambda({ action: "embed", texts });
  const embeddings = out.embeddings;
  if (!Array.isArray(embeddings)) throw new Error("embed response missing embeddings");
  return embeddings.map((row) =>
    Array.isArray(row) ? row.map((n) => (typeof n === "number" ? n : Number(n))) : [],
  );
}

export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedTexts([text]);
  return vec ?? [];
}

/**
 * Async (Event) invoke: embed texts and write vectors onto variant records.
 * Caller returns immediately; Dynamo updates when the embed Lambda finishes.
 */
export async function enqueueVariantEmbeddingStore(
  items: Array<{ tagName: string; variantId: string; text: string }>,
): Promise<number> {
  const name = embedFunctionName();
  if (!name || items.length === 0) return 0;
  const BATCH = 80;
  let queued = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH).filter((x) => x.text.trim());
    if (slice.length === 0) continue;
    await markVariantsEmbedPending(
      slice.map((x) => ({ tagName: x.tagName, variantId: x.variantId })),
    );
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: name,
        InvocationType: "Event",
        Payload: Buffer.from(
          JSON.stringify({
            action: "embed_store",
            items: slice.map((x) => ({
              tagName: x.tagName,
              variantId: x.variantId,
              text: x.text,
            })),
          }),
        ),
      }),
    );
    queued += slice.length;
  }
  return queued;
}

export async function searchVariantCatalog(params: {
  queries: string[];
  catalog: Array<{
    id: string;
    tag: string;
    text: string;
    embedding: number[];
    lengthTier?: string | null;
    direction?: string | null;
    source?: string;
    approved?: boolean;
  }>;
  topK?: number;
}): Promise<ScriptEmbedSearchResult[]> {
  if (params.queries.length === 0) return [];
  const out = await invokeEmbedLambda({
    action: "search",
    queries: params.queries,
    catalog: params.catalog,
    topK: params.topK ?? 10,
  });
  const results = out.results;
  if (!Array.isArray(results)) throw new Error("search response missing results");
  return results.map((r, i) => {
    const row = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const matchesRaw = Array.isArray(row.matches) ? row.matches : [];
    return {
      queryIndex: typeof row.queryIndex === "number" ? row.queryIndex : i,
      embedding: Array.isArray(row.embedding)
        ? row.embedding.map((n) => (typeof n === "number" ? n : Number(n)))
        : [],
      matches: matchesRaw.map((m) => {
        const mm = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
        return {
          id: String(mm.id ?? ""),
          tag: String(mm.tag ?? ""),
          text: String(mm.text ?? ""),
          score: typeof mm.score === "number" ? mm.score : Number(mm.score) || 0,
          lengthTier:
            mm.lengthTier === "short" || mm.lengthTier === "medium" || mm.lengthTier === "long"
              ? mm.lengthTier
              : null,
          direction: typeof mm.direction === "string" ? mm.direction : null,
          source: typeof mm.source === "string" ? mm.source : undefined,
          approved: typeof mm.approved === "boolean" ? mm.approved : undefined,
        };
      }),
    };
  });
}
