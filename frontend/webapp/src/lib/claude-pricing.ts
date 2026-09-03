/**
 * Claude Messages API: billed per **input token** (system + messages on each request)
 * and **output token** (assistant completion). Align with `backend/lib/anthropic-pricing.ts`.
 *
 * @see https://platform.claude.com/docs/en/about-claude/pricing
 */
export const CLAUDE_HAIKU_45_USD_PER_INPUT_TOKEN = 1 / 1_000_000;
export const CLAUDE_HAIKU_45_USD_PER_OUTPUT_TOKEN = 5 / 1_000_000;

export const CLAUDE_HAIKU_45_MODEL_ID = "claude-haiku-4-5";
export const CLAUDE_SONNET_45_MODEL_ID = "claude-sonnet-4-5";
/** Script Lab pipeline stages. */
export const SCRIPT_LAB_SONNET_MODEL = "claude-sonnet-4-6";
export const SCRIPT_LAB_HAIKU_MODEL = "claude-haiku-4-5-20251001";

export const CLAUDE_MODEL_RATES: Record<
  string,
  { usdPerInputToken: number; usdPerOutputToken: number; label: string }
> = {
  [CLAUDE_HAIKU_45_MODEL_ID]: {
    usdPerInputToken: 1 / 1_000_000,
    usdPerOutputToken: 5 / 1_000_000,
    label: "Haiku 4.5",
  },
  [SCRIPT_LAB_HAIKU_MODEL]: {
    usdPerInputToken: 1 / 1_000_000,
    usdPerOutputToken: 5 / 1_000_000,
    label: "Haiku 4.5",
  },
  [CLAUDE_SONNET_45_MODEL_ID]: {
    usdPerInputToken: 3 / 1_000_000,
    usdPerOutputToken: 15 / 1_000_000,
    label: "Sonnet 4.5",
  },
  [SCRIPT_LAB_SONNET_MODEL]: {
    usdPerInputToken: 3 / 1_000_000,
    usdPerOutputToken: 15 / 1_000_000,
    label: "Sonnet 4.6",
  },
};

export function claudeModelLabel(model: string | null | undefined): string {
  if (!model) return "Claude";
  return CLAUDE_MODEL_RATES[model]?.label ?? model;
}

/** Per-million rates for display, e.g. "$1 / $5 per MTok". */
export function claudeRatesPerMillion(model: string | null | undefined): {
  input: number;
  output: number;
} {
  const rate =
    (model ? CLAUDE_MODEL_RATES[model] : undefined) ??
    CLAUDE_MODEL_RATES[CLAUDE_HAIKU_45_MODEL_ID];
  return {
    input: rate.usdPerInputToken * 1_000_000,
    output: rate.usdPerOutputToken * 1_000_000,
  };
}

export function claudeUsdFromTokens(
  model: string | null | undefined,
  inputTokens: number,
  outputTokens: number,
): number {
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return 0;
  const rate =
    (model ? CLAUDE_MODEL_RATES[model] : undefined) ??
    CLAUDE_MODEL_RATES[CLAUDE_HAIKU_45_MODEL_ID];
  return (
    Math.max(0, inputTokens) * rate.usdPerInputToken +
    Math.max(0, outputTokens) * rate.usdPerOutputToken
  );
}

export function claudeHaiku45UsdFromTokens(
  inputTokens: number,
  outputTokens: number,
): number {
  return claudeUsdFromTokens(CLAUDE_HAIKU_45_MODEL_ID, inputTokens, outputTokens);
}
