/**
 * Segment descriptions restate their own repeatability ("Connective tissue, may
 * repeat freely.", "Singular — use once, ..."). That rule is already stated in
 * full, once, in scriptSegmentSelectionRulesBlock and on each catalog entry's
 * `Repeatability:` line, so the prose copy is ~1.5k wasted prompt tokens per
 * generation call and adds no signal.
 *
 * This strips the repeatability lead-in while preserving the placement guidance
 * that usually follows it ("… appropriate wherever the script uses sound as an
 * anchor" is real information; "Connective tissue," is not).
 *
 * Dry run by default:
 *   npx tsx scripts/strip-repeatability-boilerplate.ts
 * Apply:
 *   npx tsx scripts/strip-repeatability-boilerplate.ts --apply
 */
import {
  listAllScriptSegmentLibrary,
  putScriptSegmentTag,
} from "../lib/script-segment-library";
import {
  effectiveSegmentRepeatability,
  type ScriptSegmentRepeatability,
} from "../lib/script-segment-tags";

const APPLY = process.argv.includes("--apply");

/** Leading "Connective tissue —" / "Singular," / "Connective -" etc. */
const LEAD_IN = /^(connective|singular)(?:\s+tissue)?\s*(?:[—–-]|,|:)\s*/i;
/** "use once per script," / "use at most once," — the rule, not the placement. */
const USE_ONCE = /^use\s+(?:it\s+)?(?:at\s+most\s+)?once(?:\s+per\s+script)?\s*,?\s*/i;
/** "may repeat freely" / "may appear more than once" / "may be used multiple times" */
const MAY_REPEAT =
  /^may\s+(?:repeat|be\s+(?:re)?used|appear)(?:\s+freely|\s+more\s+than\s+once|\s+multiple\s+times)?\s*,?\s*/i;

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type SentenceResult =
  | { action: "keep" }
  | { action: "drop" }
  | { action: "rewrite"; text: string }
  | { action: "conflict"; declared: ScriptSegmentRepeatability };

function processSentence(
  sentence: string,
  repeatability: ScriptSegmentRepeatability,
): SentenceResult {
  const lead = LEAD_IN.exec(sentence);
  let rest = sentence;

  if (lead) {
    const declared = lead[1]!.toLowerCase() as ScriptSegmentRepeatability;
    // A description that disagrees with the stored field is a data bug, not
    // boilerplate — surface it rather than silently deleting either side.
    if (declared !== repeatability) return { action: "conflict", declared };
    rest = sentence.slice(lead[0].length).trim();
  }

  const before = rest;
  // A tail of "" or "." means the sentence was nothing but the repeatability
  // rule ("Connective tissue, may repeat freely.") — drop it whole.
  const substantive = (tail: string) => /[a-z0-9]/i.test(tail);
  if (USE_ONCE.test(rest)) {
    const tail = rest.replace(USE_ONCE, "");
    if (!substantive(tail)) return { action: "drop" };
    rest = `Use ${tail}`;
  } else if (MAY_REPEAT.test(rest)) {
    const tail = rest.replace(MAY_REPEAT, "");
    // "may repeat freely, but proximity-check should avoid…" is pure rule text.
    if (!substantive(tail) || /^but\b/i.test(tail)) return { action: "drop" };
    rest = `Appropriate ${tail}`;
  }

  if (!lead && rest === before) return { action: "keep" };
  // Lead-in was the whole sentence ("Connective tissue, may repeat freely.").
  if (!rest || /^[.,;]?$/.test(rest)) return { action: "drop" };
  if (/^(?:,|but)\b/i.test(rest)) return { action: "drop" };

  return { action: "rewrite", text: capitalize(rest) };
}

function stripBoilerplate(
  description: string,
  repeatability: ScriptSegmentRepeatability,
): { next: string; conflicts: string[] } {
  const out: string[] = [];
  const conflicts: string[] = [];

  for (const sentence of splitSentences(description)) {
    const result = processSentence(sentence, repeatability);
    if (result.action === "drop") continue;
    if (result.action === "conflict") {
      conflicts.push(
        `description says "${result.declared}" but stored repeatability is "${repeatability}": ${sentence}`,
      );
      out.push(sentence);
      continue;
    }
    out.push(result.action === "rewrite" ? result.text : sentence);
  }

  return { next: out.join(" ").trim(), conflicts };
}

async function main(): Promise<void> {
  const lib = await listAllScriptSegmentLibrary();
  const approxTokens = (s: string) => Math.ceil(s.length / 4);

  let changed = 0;
  let savedTokens = 0;
  const conflicts: string[] = [];
  const pending: Array<{ name: string; description: string }> = [];

  for (const tag of [...lib.tags].sort((a, b) => a.name.localeCompare(b.name))) {
    const description = (tag.description ?? "").trim();
    if (!description) continue;

    const repeatability = effectiveSegmentRepeatability({
      tag: tag.name,
      repeatability: tag.repeatability,
    });
    const { next, conflicts: tagConflicts } = stripBoilerplate(
      description,
      repeatability,
    );
    for (const c of tagConflicts) conflicts.push(`${tag.name}: ${c}`);
    if (!next || next === description) continue;

    changed += 1;
    savedTokens += approxTokens(description) - approxTokens(next);
    pending.push({ name: tag.name, description: next });

    console.log(`\n${tag.name} [${repeatability}]`);
    console.log(`  - ${description}`);
    console.log(`  + ${next}`);
  }

  if (conflicts.length > 0) {
    console.log(`\n!! ${conflicts.length} repeatability conflict(s) — left untouched:`);
    for (const c of conflicts) console.log(`   ${c}`);
  }

  console.log(
    `\n${changed} tag description(s) would change, saving ~${savedTokens} prompt tokens.`,
  );

  if (!APPLY) {
    console.log("Dry run — re-run with --apply to write to DynamoDB.");
    return;
  }

  for (const p of pending) {
    await putScriptSegmentTag({ name: p.name, description: p.description });
    console.log(`updated ${p.name}`);
  }
  console.log(`\nApplied ${pending.length} description update(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
