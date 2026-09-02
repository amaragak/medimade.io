/**
 * Shared Script Lab / generation prompt rules used by V1, V2, and verification.
 * Version-specific framing stays in each path; these blocks are the common policy text.
 */

import { normalizeMeditationType } from "./meditation-types";

export function isStoryMeditationType(
  meditationType: string | null | undefined,
): boolean {
  if (!meditationType?.trim()) return false;
  return normalizeMeditationType(meditationType) === "Story";
}

export function isSleepMeditationType(
  meditationType: string | null | undefined,
): boolean {
  if (!meditationType?.trim()) return false;
  return normalizeMeditationType(meditationType) === "Sleep";
}

/** Waking-awareness closing tags — forbidden in Sleep scripts. */
export const WAKING_CLOSE_TAGS = [
  "CLOSE_DEEPEN_BREATH",
  "CLOSE_SENSORY_RETURN",
  "CLOSE_EYES_OPEN",
  "CLOSE_SENDOFF",
] as const;

/** Sleep closing sequence tags (in order). */
export const SLEEP_CLOSING_TAGS = ["SLEEP_THRESHOLD", "SLEEP_CLOSE"] as const;

/** Connective sleep tags for core deepening — not part of the closing sequence. */
export const SLEEP_CONNECTIVE_TAGS = [
  "SLEEP_PERMISSION_DRIFT",
  "SLEEP_HEAVINESS",
  "SLEEP_RELEASE_CUE",
  "SLEEP_THOUGHT_DISSOLVE",
] as const;

type PauseBudgetTier = {
  label: string;
  silenceShare: string;
  density: string;
  bandMix: string;
};

function pauseBudgetTierForTarget(targetMinutes: number): PauseBudgetTier {
  if (targetMinutes <= 3) {
    return {
      label: "2–3 minute",
      silenceShare: "30–40%",
      density: "Pauses light — mostly **short** and **medium**; **extra-long** rare or absent.",
      bandMix:
        "Favor **short** between lines; **medium** at transitions; **long** only after the heaviest invitation; skip **extra-long** unless one brief open moment is essential.",
    };
  }
  if (targetMinutes <= 7) {
    return {
      label: "5 minute",
      silenceShare: "40–50%",
      density:
        "Pauses moderate — **short**, **medium**, and **long** in mix; **extra-long** sparingly at genuine peak moments only (~2–3 total).",
      bandMix:
        "Use **medium** as default between lighter beats; **long** for general core spacing and after regional invitations; **extra-long** at most ~2–3 times — only at the focus linger or a significant emotional landing, never as routine spacing.",
    };
  }
  if (targetMinutes <= 14) {
    return {
      label: "10 minute",
      silenceShare: "50–60%",
      density:
        "Pauses generous — **long** is the workhorse in the core; **extra-long** is punctuation at deliberate peaks only (~4–6 total).",
      bandMix:
        "**Long** between most core beats; **medium** between lighter connective beats; **extra-long** only after personalized focus or a significant emotional/narrative landing — not after every region.",
    };
  }
  return {
    label: "20 minute",
    silenceShare: "60–70%",
    density:
      "Pauses **dominant** via many **long** beats (and medium where lighter) — the script should feel spacious. **Extra-long** is reserved punctuation (~8–12 total), not the default gap.",
    bandMix:
      "**Long** is the default between core beats on a 20-minute script; **medium** between lighter connective beats; **extra-long** only at the personalized focus linger and a few significant emotional landings — never every 2–3 beats throughout the core.",
  };
}

/** Cap on extra-long pause beats: ~2–3 per 5 minutes of target. */
export function maxExtraLongPausesForTarget(targetMinutes: number): {
  lo: number;
  hi: number;
} {
  const units = Math.max(1, Math.ceil(targetMinutes / 5));
  return { lo: units * 2, hi: units * 3 };
}

/** Story scripts use narrative pacing — caps pause bands regardless of target duration. */
export function scriptStoryPauseBandCapRules(): string {
  return [
    "### Story — pause band caps (narrative pacing override)",
    "Story scripts use **narrative pacing**, not contemplative pacing. Long silences break narrative momentum rather than creating useful space.",
    "",
    "**Hard caps (whole script):**",
    "- **Within narrative sections** (scene-setting, character, action, dialogue): maximum pause band is **`medium`**.",
    "  - **`short`** (or **`extra-short`**) for in-sentence beats and quick rhythm within a flowing paragraph.",
    "  - **`medium`** between narrative paragraphs or minor story beats.",
    "- **At major structural boundaries only** (end of a scene; a significant emotional beat that must land before the story continues): **`long`** is acceptable.",
    "- **`extra-long` is never appropriate** in a Story script — do not use it anywhere (inline or standalone pause beats).",
    "",
    "**Duration on Story targets:** reach length through **more narrative content** (scenes, detail, story arc) — not by stacking **`long`** or **`extra-long`** pauses the way contemplative types do. A 20-minute Story should **not** mirror the heavy silence share of a 20-minute body scan.",
  ].join("\n");
}

/** Pause-budget guidance for Story — replaces contemplative tier weighting. */
function scriptStoryPauseBudgetGuidanceAppendix(targetMinutes: number): string {
  return [
    "",
    "### Pause budget — Story type (overrides length-tier contemplative pacing)",
    `This is a **${targetMinutes}-minute Story** script. Contemplative pause tiers (heavy **long** / **extra-long** spacing by duration) **do not apply** — Story uses narrative pacing instead.`,
    "",
    scriptStoryPauseBandCapRules(),
    "",
    "**Planning check:** if pauses dominate over story momentum, you have over-silenced the narrative — shorten bands, add story content, and reserve **`long`** only for scene boundaries or major emotional landings.",
  ].join("\n");
}

/** Pause-budget guidance scaled to target duration. */
export function scriptPauseBudgetGuidanceAppendix(
  targetMinutes: number,
  options?: { meditationType?: string | null },
): string {
  if (isStoryMeditationType(options?.meditationType)) {
    return scriptStoryPauseBudgetGuidanceAppendix(targetMinutes);
  }

  const tier = pauseBudgetTierForTarget(targetMinutes);
  const stemSeconds = Math.round(targetMinutes * 60);
  const tierLo = parseInt(tier.silenceShare.split("–")[0] ?? "30", 10) / 100;
  const tierHi =
    parseInt(tier.silenceShare.split("–")[1]?.replace("%", "") ?? "40", 10) / 100;
  const targetPauseLo = Math.round(stemSeconds * tierLo);
  const targetPauseHi = Math.round(stemSeconds * tierHi);
  const xlCap = maxExtraLongPausesForTarget(targetMinutes);

  return [
    "",
    "### Pause budget (scales with target duration)",
    `This is a **${targetMinutes}-minute** script (${tier.label} tier). Silence is the **primary lever** for hitting the target — not spoken word count.`,
    "",
    "**Duration tiers (starting points — match your target):**",
    "- **2 min:** pauses light, mostly short/medium — silence ~**30–40%** of total duration",
    "- **5 min:** pauses moderate, short/medium/long mix — silence ~**40–50%**; extra-long sparse (~2–3)",
    "- **10 min:** pauses generous, **long** as the core default — silence ~**50–60%**; extra-long as punctuation (~4–6)",
    "- **20 min:** pauses dominant via many **long** beats — silence ~**60–70%**; extra-long reserved (~8–12), not sprayed through the core",
    "",
    `**Your tier (${tier.label}):** aim for **~${tier.silenceShare}** of the ~**${stemSeconds}** s stem in pause markers / pause beats — roughly **${targetPauseLo}–${targetPauseHi}** s of silence total. ${tier.density}`,
    "",
    "**Band mix for this target:**",
    tier.bandMix,
    "",
    "**Extra-long is punctuation — long is the workhorse (critical):**",
    "- **Do not** place `extra-long` every 2–3 beats through the core. That over-accumulates silence and hits duration with pause padding instead of proportionate content.",
    "- **Default core spacing** on long scripts: **`long`** (7s) between substantive beats; **`medium`** between lighter connective beats.",
    "- Reserve **`extra-long`** (12s) for deliberate moments only:",
    "  - The personalized focus-region linger point",
    "  - Immediately after a significant emotional or narrative beat that genuinely needs extended space to land",
    `- Hard cap: roughly **${xlCap.lo}–${xlCap.hi}** \`extra-long\` pauses for this **${targetMinutes}-minute** target (~2–3 per 5 minutes). Prefer the low end unless several genuine peaks clearly warrant more.`,
    "- Hitting the silence budget: add **more `long` pause beats** (and medium where appropriate), **not** more `extra-long`.",
    "",
    "**Body tour & core practice (longer scripts):**",
    "- After each **regional body beat** (crown, jaw, shoulders, hips, etc.), follow with a pause long enough to inhabit that region — on a 10–20 minute script that usually means **`long`**, not `extra-long` every time.",
    "- After the **personalized focus** passage (stated tension, linger region, key imagery), **`extra-long`** is expected and correct — that is the primary use of the band. One or two back-to-back `extra-long` at that linger is fine; do not then continue `extra-long` for every subsequent region.",
    "",
    "**Proportional band vocabulary:**",
    "- Scale pause **count** and prefer **`long` over `medium`** as targets get longer — that is how 20-minute scripts stay spacious.",
    "- Do **not** interpret “heavier pauses on long scripts” as “use `extra-long` as the default gap.” Extra-long stays rare and intentional at every duration.",
    "- Do **not** use the same pause density as a 5-minute script and expect a 20-minute result — longer targets need **more pause beats** and a heavier mix dominated by **`long`**, not longer speeches and not wall-to-wall `extra-long`.",
    "",
    "**Do not pad with words:**",
    "- If duration is short, add **silence** (more pause beats, especially **`long`**) — **not** more spoken content, and **not** by converting every gap to `extra-long`.",
    "- A 20-minute script may have a **similar word count** to a 10-minute script once pause budget is right; that is **correct and expected**.",
    "- Never increase narration length to compensate for a duration shortfall when the fix is more silence (silence also costs zero TTS).",
    "",
    `Planning check: if your estimated pause total is well below **${targetPauseLo}** s for this ${targetMinutes}-minute target, you have not budgeted enough silence yet — add **\`long\`** pauses, not a spray of \`extra-long\`.`,
    `Planning check: if you have more than **~${xlCap.hi}** \`extra-long\` pauses, convert routine ones to **\`long\`** and keep \`extra-long\` only at focus/emotional peaks.`,
  ].join("\n");
}

/** Same connective tag must not stack with only pauses between instances. */
export function scriptLabConnectiveTagSpacingRules(): string {
  return [
    "### Connective tag spacing (generation)",
    "Connective tags (BREATH_TRANSITION, PACE_REASSURANCE, PRE_PAUSE_BRIDGE, POST_PAUSE_CONTINUE, BODY_RELAX, SOFT_AFFIRMATION, WANDERING_ACK, BODY_SOFTEN_CUE, SENSORY_EXPAND, etc.) **may** appear more than once in a script.",
    "**Hard rule:** the same connective tag must not appear within **1 non-pause beat** of itself. At least one **substantive custom beat** or a **different tag** must separate any two uses of the same connective tag. Pauses do not count as separation.",
    "Only pauses between two instances of the same connective tag is **never** correct.",
    "**Never correct:** `BREATH_TRANSITION` → pause → `BREATH_TRANSITION` (or three in a row with only pauses). Same for `SENSORY_EXPAND` → pause → `SENSORY_EXPAND`, and any other connective tag.",
    "**Exception / fine:** a connective tag separated from another instance of itself by a **substantive custom beat** is fine even if that custom beat is short — content between them is what matters, not distance. Example: `BREATH_TRANSITION` → pause → custom content beat → pause → `BREATH_TRANSITION`.",
    "Before placing a connective tag, scan the previous non-pause beat: if it is the same connective tag, do **not** place it again — insert a custom bridge or a different tag first, or skip the second placement.",
  ].join("\n");
}

/**
 * BREATH_TRANSITION vs BREATH_GATHER — one breath-return per moment.
 * Generation wording (placement); verification uses {@link scriptLabBreathReturnDisambiguationVerification}.
 */
export function scriptLabBreathReturnDisambiguationGeneration(): string {
  return [
    "### BREATH_TRANSITION vs BREATH_GATHER (generation)",
    "BREATH_TRANSITION and BREATH_GATHER serve the same functional moment (return-to-breath) with different depth, and must **not** appear within **2 non-pause beats** of each other in **either direction** (pauses do not count):",
    "- **BREATH_TRANSITION:** a brief one-line re-anchor cue. Use for a quick return to breath between sections.",
    "- **BREATH_GATHER:** a fuller framing of the breath as anchor for scattered attention. Use when the script wants to spend more time on the return.",
    "Only one breath-return beat per moment — regardless of which direction the adjacency runs. If both feel appropriate for the same point, pick the better semantic fit and use only that one.",
    "**Never correct:** `BREATH_GATHER` → pause → `BREATH_TRANSITION`, or `BREATH_TRANSITION` → pause → `BREATH_GATHER` (either direction).",
  ].join("\n");
}

/** Closing tags must never appear mid-script / in the core. */
export function scriptLabClosingPhaseTagRules(): string {
  return [
    "### Closing tags — closing phase only (generation)",
    "`CLOSE_SENDOFF`, `CLOSE_EYES_OPEN`, `CLOSE_SENSORY_RETURN`, and `CLOSE_DEEPEN_BREATH` must **only** appear in the **closing phase** — after core content is complete and the listener is being guided back to waking awareness.",
    "They must **never** appear mid-script regardless of how well the wording fits a particular narrative moment.",
    "If a mid-script beat needs sendoff-style, eyes-open, sensory-return, or deepen-breath language, write it as **custom text**, not as a closing tag.",
  ].join("\n");
}

/** Sleep scripts use a dedicated closing sequence — never waking CLOSE_* tags. */
export function scriptSleepClosingPhaseTagRules(): string {
  return [
    "### Sleep — closing structure (replaces waking CLOSE_* tags)",
    "Sleep scripts must **not** use `CLOSE_DEEPEN_BREATH`, `CLOSE_SENSORY_RETURN`, `CLOSE_EYES_OPEN`, or `CLOSE_SENDOFF` under **any circumstances**. Those tags return the listener to waking awareness — the opposite of sleep.",
    "",
    "**Closing sequence (exact final beats):**",
    "`SLEEP_THRESHOLD` (singular — once, near the end) → `{ beatType: \"pause\", pauseBand: \"extra-long\" }` → `SLEEP_CLOSE` (singular — **final beat**)",
    "",
    "**After `SLEEP_CLOSE`:** nothing — no pause beat, no custom text, no further tags. The script **ends** on `SLEEP_CLOSE` and fades to silence.",
    "",
    "**Core deepening (not closing):** connective sleep tags — `SLEEP_PERMISSION_DRIFT`, `SLEEP_HEAVINESS`, `SLEEP_RELEASE_CUE`, `SLEEP_THOUGHT_DISSOLVE` — belong in the **core deepening section**, progressively preparing for `SLEEP_THRESHOLD`. Do **not** place them in the closing sequence after `SLEEP_THRESHOLD` begins.",
  ].join("\n");
}

/** Type-aware closing rules for V1 / V2 generation prompts. */
export function scriptLabClosingPhaseTagRulesForType(
  meditationType?: string | null,
): string {
  if (isSleepMeditationType(meditationType)) {
    return scriptSleepClosingPhaseTagRules();
  }
  return scriptLabClosingPhaseTagRules();
}

/** Verification wording for convert_tag decisions. */
export function scriptLabBreathReturnDisambiguationVerification(): string {
  return [
    "### Tag disambiguation — BREATH_TRANSITION vs BREATH_GATHER",
    "BREATH_TRANSITION and BREATH_GATHER serve related but distinct functions:",
    "- BREATH_TRANSITION: a brief, light re-anchor — one sentence, appropriate for a quick return to breath between sections",
    "- BREATH_GATHER: a fuller framing of the breath as anchor for scattered attention — appropriate when the script wants to spend more time on the return, typically in breath-led scripts for scattered/anxious states",
    "When considering converting a sentence to either tag, check whether the other tag already appears within 2 non-pause beats. If BREATH_TRANSITION is already present nearby, do not also convert to BREATH_GATHER, and vice versa. One breath-return beat per moment — pick the better semantic fit for the sentence in question, not both.",
  ].join("\n");
}

/** Do not write generic custom that restates a nearby singular tag. */
export function scriptLabSingularAdjacentCustomRules(): string {
  return [
    "### Singular tags + adjacent custom beats (generation — first line of defence)",
    "When you place a **singular** tag beat (see catalog Repeatability: singular), scan **immediately adjacent** beats within **1–2 non-pause beats** on either side (pauses do not count toward the window). **Do not write generic custom beats that restate the tag's function.** A post-generation verification pass may **trim** redundant adjacent customs — your job is to produce a beat list that needs little or no trimming.",
    "",
    "**Rule (whole script — openers, body tour, closing; all singular tags equally):**",
    "- If an adjacent custom beat would contain **only generic content already covered by the tag**, **omit that custom beat entirely** — do not output it.",
    "- If an adjacent custom beat contains **personalized content** from this user's input (stated tension, visualisation, goal, context), **keep it** — but scope the text to the personalized part only; remove any generic restatement of the tag's function from the same beat.",
    "- **Test:** does this custom beat say something the tag **cannot** say for **this specific user**? If yes → keep only that part. If no → omit the beat.",
    "",
    "**Examples — omit generic adjacent custom:**",
    "- `CLOSE_DEEPEN_BREATH` tag → do **not** add adjacent custom \"breathe a little fuller\" / \"let each breath become fuller\" (same function, zero personalization).",
    "- `CLOSE_SENSORY_RETURN` tag → do **not** add adjacent custom \"notice the sounds around you\" / \"feel the room around you\" (generic sensory return the tag already covers).",
    "- `BODY_SCAN_NECK_SHOULDERS` tag → do **not** add adjacent custom shoulder-release / dropping-shoulders language (tag covers it); keep only user-specific tension pattern if present.",
    "- `SETTLE_OPENER` or `BREATH_OPENER` tag → do **not** add adjacent generic arrival/breath opener custom text; personalized settling (e.g. \"sitting beneath your oak tree\") may stay as custom **or** as a tag — never both with generic overlap.",
    "",
    "**Examples — keep scoped personalized adjacent custom:**",
    "- `CLOSE_SENSORY_RETURN` tag → adjacent custom **may** be only: \"Notice the rustling of leaves from your oak tree.\" (personalized sensory detail the tag cannot provide).",
    "- `BODY_SCAN_*` tag → adjacent custom **may** reference this user's lower-back tension — generic body-region wording belongs in the tag, not the custom beat.",
    "- **Important:** `{ beatType: \"content\", custom: true }` does **not** exempt a beat from this rule. Generic breath-deepening, sensory-return, shoulder-release, or other tag-covered language must not appear in **any** custom beat within 1–2 non-pause beats of the matching singular tag.",
    "- After placing a singular tag, **stop** — do not add a follow-up custom beat unless you have user-specific content the tag cannot carry. When in doubt, omit the custom beat and use a pause beat instead.",
  ].join("\n");
}

export function scriptLabSharedTagPlacementRulesGeneration(
  meditationType?: string | null,
): string {
  return [
    scriptLabConnectiveTagSpacingRules(),
    "",
    scriptLabBreathReturnDisambiguationGeneration(),
    "",
    scriptLabClosingPhaseTagRulesForType(meditationType),
  ].join("\n");
}

/**
 * Shared rules for V2 Pass 1 (skeleton): pause budget + tag placement.
 * Additive to V2 — V1 already includes these via the same helpers.
 */
export function scriptLabSharedRulesForV2Pass1(
  targetMinutes: number,
  meditationType?: string | null,
): string {
  const sleepType = isSleepMeditationType(meditationType);
  return [
    scriptPauseBudgetGuidanceAppendix(targetMinutes, { meditationType }),
    "",
    scriptLabConnectiveTagSpacingRules(),
    "",
    scriptLabBreathReturnDisambiguationGeneration(),
    "",
    scriptLabClosingPhaseTagRulesForType(meditationType),
    "",
    sleepType
      ? "Apply connective and BREATH_* rules when placing tag slots in the skeleton. Sleep closing is exactly SLEEP_THRESHOLD → pause extra-long → SLEEP_CLOSE (last beat). Never use CLOSE_* tags."
      : "Apply the connective, BREATH_*, and closing-phase rules when placing tag slots in the skeleton (pauses between tags do not count as separation; CLOSE_* only in the closing sequence).",
  ].join("\n");
}

/**
 * Shared rules for V2 Pass 2 (personalization): adjacency + breath pair + connective + closing.
 * When adding custom or reviewing tags, do not create the forbidden adjacencies or mid-script CLOSE_*.
 */
export function scriptLabSharedRulesForV2Pass2(
  meditationType?: string | null,
): string {
  const storyPause =
    isStoryMeditationType(meditationType) ? [scriptStoryPauseBandCapRules(), ""] : [];
  const sleepType = isSleepMeditationType(meditationType);
  return [
    ...storyPause,
    scriptLabSingularAdjacentCustomRules(),
    "",
    "Singular tags: at most once — a second mention of the same subject area must be custom text, not the same tag again. The adjacent-custom rule above applies to **singular** tags only.",
    "",
    scriptLabConnectiveTagSpacingRules(),
    "",
    scriptLabBreathReturnDisambiguationGeneration(),
    "",
    scriptLabClosingPhaseTagRulesForType(meditationType),
    "",
    sleepType
      ? "When adding custom beats or removing redundant tags, do not create BREATH_TRANSITION / BREATH_GATHER pairs within 2 non-pause beats, do not stack the same connective tag with only pauses between, never use CLOSE_* tags, and do not add any beats after SLEEP_CLOSE."
      : "When adding custom beats or removing redundant tags, do not create BREATH_TRANSITION / BREATH_GATHER pairs within 2 non-pause beats, do not stack the same connective tag with only pauses between, and do not introduce CLOSE_* tags outside the closing phase.",
  ].join("\n");
}
