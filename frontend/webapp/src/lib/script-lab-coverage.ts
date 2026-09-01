import {
  buildScriptLabContextTags,
  variantEligibleForRequest,
} from "@/lib/script-constraint-tags";
import { segmentEligibleForType } from "@/lib/script-segment-tags";

/** Known meditation types — keep in sync with Script Lab test panel dropdown. */
export const SCRIPT_LAB_MEDITATION_TYPES = [
  "Body scan",
  "Visualization",
  "Breath-led",
  "Manifestation",
  "Affirmation loop",
  "Story",
  "Reflection",
  "Sleep",
  "Loving-kindness",
  "Anxiety relief",
  "Movement meditation",
  "Open awareness",
] as const;

export type ScriptLabCoverageVariant = {
  requiredConstraints: string[];
  excludedConstraints: string[];
};

export type ScriptLabCoverageTag = {
  name: string;
  scope: "general" | "types";
  types: string[];
};

export type ScriptLabTagCoverage = {
  tagName: string;
  minEligibleCount: number;
  underThresholdContexts: Array<{ label: string; eligibleCount: number; contextTags: string[] }>;
  countsByContext: Array<{ label: string; eligibleCount: number; contextTags: string[] }>;
};

function applicableTypesForTag(tag: ScriptLabCoverageTag): readonly string[] {
  if (tag.scope === "general") return SCRIPT_LAB_MEDITATION_TYPES;
  return tag.types.length > 0 ? tag.types : [];
}

/** Default seated context per meditation type (no standing unless user signals). */
function defaultContextForMeditationType(meditationType: string): string[] {
  return buildScriptLabContextTags({ meditationType, userText: "" });
}

export function countEligibleVariantsForContext(params: {
  tag: ScriptLabCoverageTag;
  variants: ScriptLabCoverageVariant[];
  meditationType: string;
  contextTags: string[];
}): number {
  if (!segmentEligibleForType(params.tag.scope, params.tag.types, params.meditationType)) {
    return 0;
  }
  return params.variants.filter((v) =>
    variantEligibleForRequest({
      tagScope: params.tag.scope,
      tagTypes: params.tag.types,
      meditationType: params.meditationType,
      requiredConstraints: v.requiredConstraints,
      excludedConstraints: v.excludedConstraints,
      contextTags: params.contextTags,
    }),
  ).length;
}

export function computeTagCoverage(params: {
  tag: ScriptLabCoverageTag;
  variants: ScriptLabCoverageVariant[];
  threshold: number;
}): ScriptLabTagCoverage {
  const applicable = applicableTypesForTag(params.tag);
  const countsByContext = applicable.map((type) => {
    const contextTags = defaultContextForMeditationType(type);
    return {
      label: type,
      eligibleCount: countEligibleVariantsForContext({
        tag: params.tag,
        variants: params.variants,
        meditationType: type,
        contextTags,
      }),
      contextTags,
    };
  });

  const underThresholdContexts = countsByContext.filter(
    (row) => row.eligibleCount < params.threshold,
  );
  const minEligibleCount =
    countsByContext.length > 0
      ? Math.min(...countsByContext.map((row) => row.eligibleCount))
      : 0;

  return {
    tagName: params.tag.name,
    minEligibleCount,
    underThresholdContexts,
    countsByContext,
  };
}

export function computeLibraryCoverage(params: {
  tags: ScriptLabCoverageTag[];
  variantsByTag: Record<string, ScriptLabCoverageVariant[]>;
  threshold: number;
}): Record<string, ScriptLabTagCoverage> {
  const out: Record<string, ScriptLabTagCoverage> = {};
  for (const tag of params.tags) {
    out[tag.name] = computeTagCoverage({
      tag,
      variants: params.variantsByTag[tag.name] ?? [],
      threshold: params.threshold,
    });
  }
  return out;
}
