/**
 * Unit tests for Script Lab V3 pause split + assemble helpers (no Anthropic/embed).
 *   npx tsx scripts/test-script-lab-v3-split.ts
 */
import {
  splitScriptOnPauseMarkers,
  V3_PROMOTION_THRESHOLD,
  V3_SUBSTITUTION_THRESHOLD,
} from "../lib/script-lab-generate-v3";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const sample = [
  "Settle into the cactus stump image.",
  "[[PAUSE medium]]",
  "Gather the breath at the belly.",
  "[[PAUSE short]]",
  "And when you are ready, open the eyes.",
].join(" ");

const chunks = splitScriptOnPauseMarkers(sample);
assert(chunks.length === 3, `expected 3 chunks, got ${chunks.length}`);
assert(chunks[0]!.pauseAfter === "medium", "first pause medium");
assert(chunks[1]!.pauseAfter === "short", "second pause short");
assert(chunks[2]!.pauseAfter === null, "last has no pause");
assert(chunks[0]!.text.toLowerCase().includes("cactus"), "personalized text preserved");

assert(V3_SUBSTITUTION_THRESHOLD === 0.9, "sub threshold");
assert(V3_PROMOTION_THRESHOLD === 0.7, "promo threshold");

console.log("OK script-lab-v3-split", {
  chunks: chunks.map((c) => ({ i: c.index, pause: c.pauseAfter, n: c.text.length })),
});
