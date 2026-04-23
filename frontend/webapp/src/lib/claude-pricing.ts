/**
 * Claude Messages API: billed per **input token** (system + messages on each request)
 * and **output token** (assistant completion). Align with `backend/lib/anthropic-pricing.ts`.
 *
 * @see https://platform.claude.com/docs/en/about-claude/pricing
 */
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
