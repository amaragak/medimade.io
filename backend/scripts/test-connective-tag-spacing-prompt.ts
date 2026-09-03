/**
 * Connective tag set + catalog prompt language (no Anthropic call).
 *   npx tsx scripts/test-connective-tag-spacing-prompt.ts
 */
import {
  collapseSameConnectiveSeparatedOnlyByPauses,
  type ScriptLabBeat,
} from "../lib/script-lab-beats";
import {
  CONNECTIVE_SEGMENT_TAGS,
  inferDefaultSegmentRepeatability,
  isConnectiveSegmentTag,
  repeatabilityPromptLine,
  scriptSegmentLibraryPromptBlock,
  scriptSegmentSelectionRulesBlock,
} from "../lib/script-segment-tags";
import { scriptLabConnectiveTagSpacingRules } from "../lib/script-lab-shared-prompt-rules";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const required = [
  "SENSORY_EXPAND",
  "EMOTIONAL_NOTICE",
  "DETAIL_FOCUS",
  "LINGER",
  "BREATH_GATHER",
  "BREATH_SENSORY_NOTICE",
  "BREATH_WITNESS",
  "ARRIVE",
  "IMAGE_SOFTEN",
  "REENTRY_BRIDGE",
  "MANIFESTATION_REALITY_BRIDGE",
  "MANIFESTATION_WORTHINESS",
  "MANIFESTATION_RESISTANCE",
  "MANIFESTATION_GRATITUDE",
  "AFFIRMATION_REPEAT_CUE",
  "AFFIRMATION_COMPLEXITY",
  "AFFIRMATION_EMBODIMENT",
] as const;

for (const tag of required) {
  assert(CONNECTIVE_SEGMENT_TAGS.has(tag), `missing from CONNECTIVE_SEGMENT_TAGS: ${tag}`);
  assert(
    inferDefaultSegmentRepeatability(tag) === "connective",
    `default repeatability should be connective: ${tag}`,
  );
  assert(isConnectiveSegmentTag(tag), `isConnectiveSegmentTag(${tag})`);
}

assert(
  isConnectiveSegmentTag("MADE_UP_CONNECTIVE", "connective"),
  "library-stored connective wins for unknown tags",
);
assert(
  !isConnectiveSegmentTag("SENSORY_EXPAND", "singular"),
  "library-stored singular overrides seed set",
);

// The per-tag line is a bare label — the full spacing rule is stated once in
// the selection-rules block below, not repeated on all ~70 catalog entries.
const line = repeatabilityPromptLine("connective");
assert(!/freely/i.test(line), `repeatabilityPromptLine still says freely: ${line}`);
assert(line === "connective", `repeatabilityPromptLine should be a bare label: ${line}`);
assert(
  repeatabilityPromptLine("singular") === "singular",
  "singular repeatability line should be a bare label",
);

const rules = scriptSegmentSelectionRulesBlock({
  connectiveTagNames: ["SENSORY_EXPAND", "PACE_REASSURANCE"],
});
assert(!/may repeat freely/i.test(rules), "selection rules still say freely");
assert(/SENSORY_EXPAND/.test(rules), "selection rules should list library connective tags");
assert(
  /never.*only pauses/i.test(rules) || /At least one \*\*substantive custom beat\*\*/i.test(rules),
  "selection rules missing spacing constraint",
);

const spacing = scriptLabConnectiveTagSpacingRules();
assert(/SENSORY_EXPAND/.test(spacing), "spacing rule unchanged and still names SENSORY_EXPAND");

const catalog = scriptSegmentLibraryPromptBlock({
  structuredBeats: true,
  meditationType: "Manifestation",
  tags: [
    {
      name: "SENSORY_EXPAND",
      scope: "general",
      types: [],
      sampleVariants: ["Notice the colours around you."],
      repeatability: "connective",
    },
    {
      name: "SETTLE_OPENER",
      scope: "general",
      types: [],
      sampleVariants: ["Settle in."],
      repeatability: "singular",
    },
  ],
});
assert(!/may repeat freely/i.test(catalog), "catalog block still says freely");
assert(
  catalog.includes(`Repeatability: ${repeatabilityPromptLine("connective")}`),
  "catalog should use the bare per-tag connective label",
);
// The rule the per-tag line no longer carries must still reach the model once.
assert(
  /never.*only pauses/i.test(catalog),
  "catalog must still carry the connective spacing rule via the selection-rules block",
);

const stacked: ScriptLabBeat[] = [
  { beatType: "sensory_expand", custom: false, tag: "SENSORY_EXPAND" },
  { beatType: "pause", custom: false, pauseBand: "long" },
  { beatType: "sensory_expand", custom: false, tag: "SENSORY_EXPAND" },
  { beatType: "pause", custom: false, pauseBand: "medium" },
  { beatType: "sensory_expand", custom: false, tag: "SENSORY_EXPAND" },
  { beatType: "content", custom: true, text: "bridge" },
  { beatType: "sensory_expand", custom: false, tag: "SENSORY_EXPAND" },
];
const collapsed = collapseSameConnectiveSeparatedOnlyByPauses(stacked);
const se = collapsed.filter((b) => b.tag === "SENSORY_EXPAND");
assert(se.length === 2, `expected 2 SENSORY_EXPAND after collapse, got ${se.length}`);
assert(
  collapsed.some((b) => b.custom && b.text === "bridge"),
  "custom bridge kept",
);

console.log("OK connective-tag-spacing-prompt", {
  connectiveCount: CONNECTIVE_SEGMENT_TAGS.size,
  sampleLine: line.slice(0, 80) + "…",
});
