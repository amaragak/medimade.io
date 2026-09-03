/**
 * Per-stage model routing for Script Lab. The frontend model picker is display-only;
 * internal pipeline stages use these constants.
 */
export const SCRIPT_LAB_SONNET_MODEL = "claude-sonnet-4-6";
export const SCRIPT_LAB_HAIKU_MODEL = "claude-haiku-4-5-20251001";

export type ScriptLabPipelineStage =
  | "v1_generation"
  | "v1_verification"
  | "v2_pass1_skeleton"
  | "v2_pass2_personalization"
  | "v2_verification"
  | "v3_pass1_generation"
  | "v3_pass3_classify"
  | "v3_pass5_substitution_review"
  | "v3_pass5_promotion_review"
  | "fill";

export type ScriptLabUsageBreakdownEntry = {
  stage: ScriptLabPipelineStage;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
};

export function scriptLabModelForStage(stage: ScriptLabPipelineStage): string {
  switch (stage) {
    case "v1_generation":
    case "v2_pass1_skeleton":
    case "v2_pass2_personalization":
    case "v3_pass1_generation":
    case "v3_pass5_promotion_review":
      return SCRIPT_LAB_SONNET_MODEL;
    case "v1_verification":
    case "v2_verification":
    case "v3_pass3_classify":
    case "v3_pass5_substitution_review":
    case "fill":
      return SCRIPT_LAB_HAIKU_MODEL;
  }
}

export function mergeUsageBreakdown(
  ...parts: Array<ScriptLabUsageBreakdownEntry[] | undefined>
): ScriptLabUsageBreakdownEntry[] {
  return parts.flatMap((p) => p ?? []);
}
