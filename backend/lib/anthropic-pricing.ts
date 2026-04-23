/**
 * Claude API billing (Messages): **input tokens** (system + full messages on each request)
 * and **output tokens** (completion). Rates are list prices for the model id we deploy.
 *
 * Verify current numbers: https://platform.claude.com/docs/en/about-claude/pricing
 * (Haiku 4.5 listed at $1 / MTok input, $5 / MTok output as of early 2026.)
 */
export const CLAUDE_HAIKU_45_MODEL_ID = "claude-haiku-4-5";

export const CLAUDE_HAIKU_45_USD_PER_INPUT_TOKEN = 1 / 1_000_000;
export const CLAUDE_HAIKU_45_USD_PER_OUTPUT_TOKEN = 5 / 1_000_000;

export function claudeHaiku45UsdFromTokens(
  inputTokens: number,
  outputTokens: number,
): number {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return 0;
  return (
    Math.max(0, inputTokens) * CLAUDE_HAIKU_45_USD_PER_INPUT_TOKEN +
    Math.max(0, outputTokens) * CLAUDE_HAIKU_45_USD_PER_OUTPUT_TOKEN
  );
}

/** Parse `usage` from a non-streaming `/v1/messages` JSON body. */
export function parseAnthropicMessageUsage(jsonText: string): {
  input_tokens: number;
  output_tokens: number;
} | null {
  try {
    const o = JSON.parse(jsonText) as {
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const u = o.usage;
    if (!u) return null;
    const it = u.input_tokens;
    const ot = u.output_tokens;
    if (typeof it !== "number" || typeof ot !== "number") return null;
    if (!Number.isFinite(it) || !Number.isFinite(ot)) return null;
    return { input_tokens: it, output_tokens: ot };
  } catch {
    return null;
  }
}

const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";

/**
 * Official input-token count for a Messages-shaped payload (no completion).
 * Free; does not spend model tokens.
 */
export async function anthropicCountMessageInputTokens(params: {
  apiKey: string;
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): Promise<number | null> {
  const res = await fetch(COUNT_TOKENS_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      ...(params.system ? { system: params.system } : {}),
      messages: params.messages,
    }),
  });
  const text = await res.text();
  if (!res.ok) return null;
  try {
    const o = JSON.parse(text) as { input_tokens?: unknown };
    if (typeof o.input_tokens !== "number" || !Number.isFinite(o.input_tokens)) {
      return null;
    }
    return o.input_tokens;
  } catch {
    return null;
  }
}
