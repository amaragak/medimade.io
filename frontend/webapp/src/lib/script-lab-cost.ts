import {
  CLAUDE_HAIKU_45_MODEL_ID,
  CLAUDE_SONNET_45_MODEL_ID,
  SCRIPT_LAB_HAIKU_MODEL,
  SCRIPT_LAB_SONNET_MODEL,
  claudeModelLabel,
  claudeUsdFromTokens,
} from "@/lib/claude-pricing";
import type { ScriptLabBeat } from "@/lib/script-lab-beats";
import { createSegmentVariantPickerForBeats } from "@/lib/script-segment-variant-select";
import type { ScriptLabTagMeta, ScriptLabVariant } from "@/lib/script-lab-estimate";

/** USD → GBP for display (update as needed). */
export const SCRIPT_LAB_USD_TO_GBP = 0.79;

/** Fish Audio estimated rate — USD per character (custom TTS). */
export const FISH_AUDIO_USD_PER_CHARACTER = 0.000015;

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type ScriptLabUsageBreakdownEntry = {
  stage: string;
  model: string;
  usage: TokenUsage;
};

export type ScriptLabUsageStage = {
  id: "generation" | "fill";
  label: string;
  usage: TokenUsage;
  /** Model-aware cost when usageBreakdown is available. */
  actual?: ScriptLabLlmCostLine;
};

export type ScriptLabLlmCostLine = {
  modelId: string;
  modelLabel: string;
  usd: number;
  gbp: number;
};

export type ScriptLabStageCost = {
  stage: ScriptLabUsageStage;
  sonnet: ScriptLabLlmCostLine;
  haiku: ScriptLabLlmCostLine;
};

export type ScriptLabSimulatedBaseline = {
  usage: TokenUsage;
  sonnet: ScriptLabLlmCostLine;
  haiku: ScriptLabLlmCostLine;
  /** firstPass.input_tokens used as simulated input. */
  firstPassInputTokens: number;
  /** Estimated from final rendered script. */
  estimatedOutputTokens: number;
};

export type ScriptLabCostSummary = {
  stages: ScriptLabStageCost[];
  totalUsage: TokenUsage;
  /** Hypothetical cost if every token were Sonnet-priced. */
  totalSonnet: ScriptLabLlmCostLine;
  /** Hypothetical cost if every token were Haiku-priced. */
  totalHaiku: ScriptLabLlmCostLine;
  /** Actual mixed-model pipeline cost. */
  totalActual: ScriptLabLlmCostLine;
  /** Per-call breakdown with model routing (when available). */
  usageBreakdown: ScriptLabUsageBreakdownEntry[];
  /** Single-shot simulation: first-pass input + final-script output estimate. */
  simulatedBaseline: ScriptLabSimulatedBaseline | null;
  /** Optimised Sonnet vs simulated Sonnet: negative = optimised cheaper. */
  sonnetDeltaUsd: number | null;
  sonnetDeltaPct: number | null;
  fishCustomChars: number;
  fishSegmentChars: number;
  fishAllChars: number;
  fishCustomUsd: number;
  fishCustomGbp: number;
  fishSegmentUsd: number;
  fishSegmentGbp: number;
  fishAllUsd: number;
  fishAllGbp: number;
  totalSonnetUsd: number;
  totalSonnetGbp: number;
  totalHaikuUsd: number;
  totalHaikuGbp: number;
  totalActualUsd: number;
  totalActualGbp: number;
  /** LLM Sonnet + Fish for custom text only (actual TTS if segments cached). */
  grandTotalSonnetUsd: number;
  grandTotalSonnetGbp: number;
  grandTotalHaikuUsd: number;
  grandTotalHaikuGbp: number;
  /** LLM Sonnet + Fish if every spoken character were TTS'd (no segment cache). */
  grandTotalAllTtsSonnetUsd: number;
  grandTotalAllTtsSonnetGbp: number;
  grandTotalAllTtsHaikuUsd: number;
  grandTotalAllTtsHaikuGbp: number;
};

/** ~4 characters per token for English prose (Claude-ish heuristic). */
export const SCRIPT_CHARS_PER_TOKEN_ESTIMATE = 4;

export function estimateTokensFromText(text: string): number {
  const chars = text.trim().length;
  if (chars <= 0) return 0;
  return Math.max(1, Math.ceil(chars / SCRIPT_CHARS_PER_TOKEN_ESTIMATE));
}

export function buildSimulatedBaseline(params: {
  firstPassUsage: TokenUsage | null | undefined;
  finalScriptText: string;
}): ScriptLabSimulatedBaseline | null {
  if (!params.firstPassUsage) return null;
  const estimatedOutputTokens = estimateTokensFromText(params.finalScriptText);
  const usage: TokenUsage = {
    input_tokens: params.firstPassUsage.input_tokens,
    output_tokens: estimatedOutputTokens,
  };
  return {
    usage,
    sonnet: llmCostLine(usage, SCRIPT_LAB_SONNET_MODEL, "Sonnet 4.6"),
    haiku: llmCostLine(usage, SCRIPT_LAB_HAIKU_MODEL, "Haiku 4.5"),
    firstPassInputTokens: params.firstPassUsage.input_tokens,
    estimatedOutputTokens,
  };
}

export function parseUsageBreakdown(raw: unknown): ScriptLabUsageBreakdownEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ScriptLabUsageBreakdownEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const usage = parseTokenUsage(o.usage);
    const stage = typeof o.stage === "string" ? o.stage : "";
    const model = typeof o.model === "string" ? o.model : "";
    if (!stage || !model || !usage) continue;
    out.push({ stage, model, usage });
  }
  return out;
}

export function actualCostFromBreakdown(
  entries: ScriptLabUsageBreakdownEntry[],
): ScriptLabLlmCostLine {
  let usd = 0;
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    usd += llmCostUsd(entry.usage, entry.model);
    const label = claudeModelLabel(entry.model);
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  const modelLabel =
    labels.length === 0
      ? "Mixed (routed)"
      : labels.length === 1
        ? labels[0]!
        : labels.join(" + ");
  return {
    modelId: labels.length === 1 ? entries[0]!.model : "mixed",
    modelLabel,
    usd,
    gbp: usdToGbp(usd),
  };
}

/** Human label for a pipeline stage id from the backend usageBreakdown. */
export function scriptLabStageDisplayLabel(stage: string): string {
  switch (stage) {
    case "v1_generation":
      return "V1 generation";
    case "v1_verification":
      return "V1 verification";
    case "v2_pass1_skeleton":
      return "V2 pass 1 skeleton";
    case "v2_pass2_personalization":
      return "V2 pass 2 personalization";
    case "v2_verification":
      return "V2 verification";
    case "v3_pass1_generation":
      return "V3 pass 1 generation";
    case "v3_pass3_classify":
      return "V3 personalization classify";
    case "v3_pass5_substitution_review":
      return "V3 substitution review";
    case "v3_pass5_promotion_review":
      return "V3 promotion review";
    case "fill":
      return "Fill placeholders";
    default:
      return stage;
  }
}

export function costLineForBreakdownEntry(
  entry: ScriptLabUsageBreakdownEntry,
): ScriptLabLlmCostLine {
  return llmCostLine(entry.usage, entry.model);
}

export function parseTokenUsage(raw: unknown): TokenUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const input = typeof u.input_tokens === "number" ? u.input_tokens : 0;
  const output = typeof u.output_tokens === "number" ? u.output_tokens : 0;
  if (input === 0 && output === 0) return null;
  return { input_tokens: input, output_tokens: output };
}

export function mergeTokenUsage(
  ...usages: Array<TokenUsage | null | undefined>
): TokenUsage {
  let input = 0;
  let output = 0;
  for (const u of usages) {
    if (!u) continue;
    input += u.input_tokens;
    output += u.output_tokens;
  }
  return { input_tokens: input, output_tokens: output };
}

export function usdToGbp(usd: number): number {
  return usd * SCRIPT_LAB_USD_TO_GBP;
}

export function formatUsd(amount: number, digits = 4): string {
  return `$${amount.toFixed(digits)}`;
}

export function formatGbp(amount: number, digits = 3): string {
  return `£${amount.toFixed(digits)}`;
}

export function llmCostUsd(
  usage: TokenUsage | null | undefined,
  model: string,
): number {
  if (!usage) return 0;
  return claudeUsdFromTokens(model, usage.input_tokens, usage.output_tokens);
}

export function llmCostLine(
  usage: TokenUsage,
  modelId: string,
  modelLabel?: string,
): ScriptLabLlmCostLine {
  const usd = llmCostUsd(usage, modelId);
  return {
    modelId,
    modelLabel: modelLabel ?? claudeModelLabel(modelId),
    usd,
    gbp: usdToGbp(usd),
  };
}

export function fishCostUsd(characters: number): number {
  if (!Number.isFinite(characters) || characters <= 0) return 0;
  return characters * FISH_AUDIO_USD_PER_CHARACTER;
}

export function formatTokenUsage(usage: TokenUsage): string {
  return `${usage.input_tokens.toLocaleString()} in · ${usage.output_tokens.toLocaleString()} out`;
}

export function characterCountsFromBeats(params: {
  beats: ScriptLabBeat[];
  picksByTag?: Record<string, string>;
  variantsByTag: Record<string, ScriptLabVariant[]>;
  tagMetaByName?: Record<string, ScriptLabTagMeta>;
  targetMinutes: number;
  meditationType?: string | null;
  contextTags?: string[];
}): { customCharCount: number; segmentCharCount: number } {
  const picker = createSegmentVariantPickerForBeats({
    beats: params.beats,
    variantsByTag: params.variantsByTag,
    tagMetaByName: params.tagMetaByName,
    targetMinutes: params.targetMinutes,
    meditationType: params.meditationType ?? null,
    contextTags: params.contextTags ?? [],
    preferredVariantIdByTag: params.picksByTag,
    random: false,
  });

  let customCharCount = 0;
  let segmentCharCount = 0;

  for (let i = 0; i < params.beats.length; i += 1) {
    const beat = params.beats[i]!;
    if (beat.beatType === "pause") continue;
    if (beat.custom) {
      customCharCount += (beat.text ?? "").trim().length;
      continue;
    }
    if (beat.tag) {
      const text =
        beat.text?.trim() ||
        picker.pickVariantText(beat.tag, i)?.trim() ||
        "";
      segmentCharCount += text.length;
    }
  }

  return { customCharCount, segmentCharCount };
}

export function buildScriptLabCostSummary(params: {
  generationUsage?: TokenUsage | null;
  fillUsage?: TokenUsage | null;
  usageBreakdown?: ScriptLabUsageBreakdownEntry[] | null;
  firstPassUsage?: TokenUsage | null;
  finalScriptText?: string;
  generationLabel?: string;
  fishCustomChars?: number;
  fishSegmentChars?: number;
}): ScriptLabCostSummary | null {
  const usageBreakdown = params.usageBreakdown ?? [];
  const stages: ScriptLabUsageStage[] = [];
  if (params.generationUsage) {
    const genBreakdown = usageBreakdown.filter((e) => e.stage !== "fill");
    stages.push({
      id: "generation",
      label: params.generationLabel ?? "Generation (incl. verification)",
      usage: params.generationUsage,
      actual:
        genBreakdown.length > 0
          ? actualCostFromBreakdown(genBreakdown)
          : undefined,
    });
  }
  if (params.fillUsage) {
    const fillBreakdown = usageBreakdown.filter((e) => e.stage === "fill");
    stages.push({
      id: "fill",
      label: "Fill placeholders",
      usage: params.fillUsage,
      actual:
        fillBreakdown.length > 0
          ? actualCostFromBreakdown(fillBreakdown)
          : undefined,
    });
  }
  if (stages.length === 0) return null;

  const stageCosts: ScriptLabStageCost[] = stages.map((stage) => ({
    stage,
    sonnet: llmCostLine(stage.usage, SCRIPT_LAB_SONNET_MODEL),
    haiku: llmCostLine(stage.usage, SCRIPT_LAB_HAIKU_MODEL),
  }));

  const totalUsage = mergeTokenUsage(
    params.generationUsage,
    params.fillUsage,
  );
  const totalSonnet = llmCostLine(totalUsage, SCRIPT_LAB_SONNET_MODEL);
  const totalHaiku = llmCostLine(totalUsage, SCRIPT_LAB_HAIKU_MODEL);
  const totalActual =
    usageBreakdown.length > 0
      ? actualCostFromBreakdown(usageBreakdown)
      : totalSonnet;

  const simulatedBaseline = buildSimulatedBaseline({
    firstPassUsage: params.firstPassUsage,
    finalScriptText: params.finalScriptText ?? "",
  });

  let sonnetDeltaUsd: number | null = null;
  let sonnetDeltaPct: number | null = null;
  if (simulatedBaseline && simulatedBaseline.sonnet.usd > 0) {
    sonnetDeltaUsd = totalActual.usd - simulatedBaseline.sonnet.usd;
    sonnetDeltaPct = (sonnetDeltaUsd / simulatedBaseline.sonnet.usd) * 100;
  }

  const fishCustomChars = params.fishCustomChars ?? 0;
  const fishSegmentChars = params.fishSegmentChars ?? 0;
  const fishAllChars = fishCustomChars + fishSegmentChars;
  const fishCustomUsd = fishCostUsd(fishCustomChars);
  const fishSegmentUsd = fishCostUsd(fishSegmentChars);
  const fishAllUsd = fishCostUsd(fishAllChars);

  return {
    stages: stageCosts,
    totalUsage,
    totalSonnet,
    totalHaiku,
    totalActual,
    usageBreakdown,
    simulatedBaseline,
    sonnetDeltaUsd,
    sonnetDeltaPct,
    fishCustomChars,
    fishSegmentChars,
    fishAllChars,
    fishCustomUsd,
    fishCustomGbp: usdToGbp(fishCustomUsd),
    fishSegmentUsd,
    fishSegmentGbp: usdToGbp(fishSegmentUsd),
    fishAllUsd,
    fishAllGbp: usdToGbp(fishAllUsd),
    totalSonnetUsd: totalSonnet.usd,
    totalSonnetGbp: totalSonnet.gbp,
    totalHaikuUsd: totalHaiku.usd,
    totalHaikuGbp: totalHaiku.gbp,
    totalActualUsd: totalActual.usd,
    totalActualGbp: totalActual.gbp,
    grandTotalSonnetUsd: totalActual.usd + fishCustomUsd,
    grandTotalSonnetGbp: usdToGbp(totalActual.usd + fishCustomUsd),
    grandTotalHaikuUsd: totalHaiku.usd + fishCustomUsd,
    grandTotalHaikuGbp: usdToGbp(totalHaiku.usd + fishCustomUsd),
    grandTotalAllTtsSonnetUsd: totalActual.usd + fishAllUsd,
    grandTotalAllTtsSonnetGbp: usdToGbp(totalActual.usd + fishAllUsd),
    grandTotalAllTtsHaikuUsd: totalHaiku.usd + fishAllUsd,
    grandTotalAllTtsHaikuGbp: usdToGbp(totalHaiku.usd + fishAllUsd),
  };
}

/** @deprecated Use script-lab-cost constants */
export { SCRIPT_LAB_USD_TO_GBP as STRESS_TEST_USD_TO_GBP };
/** @deprecated Use script-lab-cost constants */
export { FISH_AUDIO_USD_PER_CHARACTER as STRESS_TEST_FISH_AUDIO_USD_PER_CHARACTER };

export type LlmCostBreakdownGbp = {
  generation: number;
  verification: number;
  fill: number;
  total: number;
};

export function buildLlmCostBreakdownGbp(params: {
  generationUsage: TokenUsage | null | undefined;
  fillUsage?: TokenUsage | null | undefined;
  usageBreakdown?: ScriptLabUsageBreakdownEntry[] | null;
}): LlmCostBreakdownGbp {
  const breakdown = params.usageBreakdown ?? [];
  const genEntries = breakdown.filter((e) => e.stage !== "fill");
  const fillEntries = breakdown.filter((e) => e.stage === "fill");
  const generation =
    genEntries.length > 0
      ? usdToGbp(actualCostFromBreakdown(genEntries).usd)
      : usdToGbp(llmCostUsd(params.generationUsage, SCRIPT_LAB_SONNET_MODEL));
  const fill =
    fillEntries.length > 0
      ? usdToGbp(actualCostFromBreakdown(fillEntries).usd)
      : usdToGbp(llmCostUsd(params.fillUsage, SCRIPT_LAB_HAIKU_MODEL));
  return { generation, verification: 0, fill, total: generation + fill };
}

export function ttsCostGbpFromCharacterCount(characters: number): number {
  return usdToGbp(fishCostUsd(characters));
}

export function totalEstCostGbp(params: {
  llmTotal: number;
  estTtsCost: number;
}): number {
  return params.llmTotal + params.estTtsCost;
}

/** @deprecated Use buildLlmCostBreakdownGbp */
export const buildLlmCostBreakdown = buildLlmCostBreakdownGbp;

/** @deprecated Use llmCostUsd + usdToGbp */
export function llmCostGbpFromUsage(
  usage: TokenUsage | null | undefined,
  model: string = CLAUDE_SONNET_45_MODEL_ID,
): number {
  return usdToGbp(llmCostUsd(usage, model));
}
