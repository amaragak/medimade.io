import {
  creatorChoseSpecificMeditationTechnique,
  styleAdherenceBlockForPrompt,
} from "./meditation-types";
import {
  getFleetScriptWordTargets,
  scriptDurationPlanningAppendix,
} from "./script-duration-planning-prompt";
import { SCRIPT_PAUSE_PROMPT_RULES } from "./script-pause-bands";
import {
  scriptSegmentLibraryPromptBlock,
} from "./script-segment-tags";
import {
  scriptLabSegmentDurationBudgetAppendix,
  type SegmentTagForPrompt,
} from "./script-segment-tag-metrics";

export type { SegmentTagForPrompt, SegmentTagTierAverage } from "./script-segment-tag-metrics";

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
function maxExtraLongPausesForTarget(targetMinutes: number): { lo: number; hi: number } {
  const units = Math.max(1, Math.ceil(targetMinutes / 5));
  return { lo: units * 2, hi: units * 3 };
}

/** Pause-budget guidance scaled to target duration (generation prompt only). */
function scriptPauseBudgetGuidanceAppendix(targetMinutes: number): string {
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

/**
 * Shared meditation script generation prompt used by the real create flow
 * (includeSegmentPlaceholders: false) and Script Lab admin (true).
 */
export function buildMeditationScriptGenerationPrompt(params: {
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  targetMinutes: number;
  speechSpeed: number;
  includeSegmentPlaceholders: boolean;
  segmentTags?: SegmentTagForPrompt[];
}): { system: string; userContent: string; maxTokens: number } {
  const words = getFleetScriptWordTargets({
    targetMinutes: params.targetMinutes,
    speechSpeed: params.speechSpeed,
  });
  const scriptWordsMin = words.min;
  const scriptWordsMax = words.max;
  const styleForScript = params.meditationStyle.trim();
  const styleLocked = creatorChoseSpecificMeditationTechnique({
    journalMode: params.journalMode,
    meditationStyle: styleForScript,
  });
  const styleHint = styleForScript
    ? `Preferred meditation style from the creator: "${styleForScript}".`
    : "The creator has not locked a style label yet — infer an appropriate approach from the chat.";

  const lockBlock = styleLocked
    ? [
        "",
        styleAdherenceBlockForPrompt(styleForScript),
        "",
        "The script must spend a substantial part of the practice on the chosen technique above (not a brief nod while the rest is a generic unrelated meditation), while still reflecting the user’s situation from the conversation.",
      ].join("\n")
    : "";

  const segmentBlock =
    params.includeSegmentPlaceholders && params.segmentTags
      ? scriptSegmentLibraryPromptBlock({
          tags: params.segmentTags,
          meditationType: params.journalMode ? null : styleForScript,
          structuredBeats: true,
        })
      : "";

  const userParts: string[] = [
    styleHint,
    lockBlock,
  ];

  if (segmentBlock) {
    userParts.push("", segmentBlock);
  }

  userParts.push(
    "",
    "### Conversation between creator and guide (chronological)",
    params.transcript.trim() || "(No messages yet.)",
    "",
    "### Your task",
    "Write the complete guided meditation script that a human guide would read aloud for recording.",
    `Target length: about **${params.targetMinutes} minutes** at a calm, unhurried speaking pace (roughly ${scriptWordsMin}–${scriptWordsMax} words).`,
    "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
    "Match the emotional tone, intentions, and imagery implied by the conversation.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Use gender-neutral language throughout; never assume anyone's gender. Avoid he/she/his/her—prefer 'you' or singular 'they' where needed.",
    "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
    SCRIPT_PAUSE_PROMPT_RULES,
    scriptPauseBudgetGuidanceAppendix(params.targetMinutes),
    "Important formatting constraints:",
    "1) Do NOT output any title, heading, or preamble of any kind.",
    "2) The very first spoken content must start immediately (first non-whitespace characters must be the guide's words).",
    "3) Do NOT start the script with a pause marker; only include pauses after speaking has begun.",
  );

  if (params.includeSegmentPlaceholders) {
    userParts.push(
      "### Output format (Script Lab — structured beats)",
      "Return the script ONLY by calling the `submit_meditation_script_beats` tool with an ordered `beats` array. Do not output free-form prose or [[SEG:…]] markers in chat text.",
      "Each beat needs an accurate `beatType` (functional category), whether custom or library-based.",
      "",
      "**Personalization wins by default.** Prefer `custom: true` whenever text references this user's specific input — their situation, words, or journal details — even if it resembles a library line. Only consider tags for text with **no personalization signal**: wording that would read the same for any user.",
      "Must stay custom (personalized): e.g. \"Find a comfortable position, sitting beneath your tree\"; \"This is where you've been feeling that tension.\" May belong in a tag if a fit exists (generic, no user signal): e.g. \"Let that breath settle, and notice the natural rhythm that lives in your body\"; \"There's no rush—just notice what's there.\"",
      "",
      "For non-pause beats: set `custom: false` with a library `tag` when a segment covers generic wording; set `custom: true` with `text` when personalization needs bespoke phrasing.",
      "Before writing `custom: true` generic text, check the **full eligible tag library** above — any tag that covers the same idea, not only tags with an obvious topical match to the current beat.",
      "If a custom passage mixes personalized content with a generic aside (reassurance, pacing, transition) that carries no personalization, split the aside into its own tag beat and keep the personalized remainder as a separate `content` beat. Example: a body-scan intro ending with \"There's no rush—just notice what's there\" → custom `content` for \"Now I'm going to invite your attention to slowly move through your body…\" then `{ beatType: \"pace_reassurance\", custom: false, tag: \"PACE_REASSURANCE\" }` for the aside — not embedded inside the custom text.",
      "Do not over-fragment. Never split personalized phrases or load-bearing lines that would not make sense on their own. One blended custom beat is valid — e.g. for \"sitting under a tree\", `{ beatType: \"settle_opener\", custom: true, text: \"Notice you're sitting beneath a tree — let that place hold you for these next few minutes.\" }` needs no separate SETTLE_OPENER tag beat afterward.",
      "",
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
      "",
      "Follow the **Segment library — selection rules** and per-tag **Repeatability**, **Description**, and **Phase** lines in the catalog above.",
      "Singular tags: at most once — a second mention of the same subject area must be custom text, not the same tag again. The adjacent-custom rule above applies to **singular** tags only.",
      "",
      "### Connective tag spacing (generation)",
      "Connective tags (BREATH_TRANSITION, PACE_REASSURANCE, PRE_PAUSE_BRIDGE, POST_PAUSE_CONTINUE, BODY_RELAX, SOFT_AFFIRMATION, WANDERING_ACK, BODY_SOFTEN_CUE, SENSORY_EXPAND, etc.) **may** appear more than once in a script — but **never** with only pauses between two instances of the **same** connective tag.",
      "**Hard rule:** the same connective tag must not appear within **1 non-pause beat** of itself. At least one **substantive custom beat** or a **different tag** must separate any two uses of the same connective tag. Pauses do not count as separation.",
      "**Never correct:** `BREATH_TRANSITION` → pause → `BREATH_TRANSITION` (or three in a row with only pauses). Same for `SENSORY_EXPAND` → pause → `SENSORY_EXPAND`.",
      "**Fine:** `BREATH_TRANSITION` → pause → custom content beat → pause → `BREATH_TRANSITION` — a substantive custom beat between them is enough, even if that custom beat is short. Content between them matters, not raw distance.",
      "Before placing a connective tag, scan the previous non-pause beat: if it is the same connective tag, do **not** place it again — insert a custom bridge or a different tag first, or skip the second placement.",
      "",
      "Before selecting any tag, read its Description; skip tags whose stated boundary conditions apply to this script (e.g. defer BODY_SCAN_SPINE_BACK when lower-back personalization already dominates).",
      "Respect phase rules: SETTLE_OPENER and BREATH_OPENER only in opening; BODY_SCAN_* only after a body-tour intro beat; CLOSE_* only in closing.",
      "Use `{ beatType: \"content\", custom: true, text: \"…\" }` for main personalized practice material (may repeat).",
      "Use `{ beatType: \"pause\", pauseBand: \"medium\" }` for standalone structural silences between beats; use inline `[[PAUSE …]]` inside a custom beat's text only for shorter pauses within one flowing narration.",
      "Pause bands: extra-short, short, medium, long, extra-long (same vocabulary as [[PAUSE …]] rules above).",
      "For long targets, **standalone pause beats** are the main duration lever — insert many `{ beatType: \"pause\", pauseBand: \"long\" }` beats between body regions; use `{ beatType: \"pause\", pauseBand: \"extra-long\" }` only at the personalized focus linger and genuine emotional peaks (see Pause budget — Extra-long is punctuation). Do not rely on inline short pauses alone, and do not spray `extra-long` every few beats.",
      "The **Pause budget (scales with target duration)** section above overrides generic pause-share hints when they conflict — longer scripts need proportionally **more** pause beats with **`long` as the workhorse**, not wall-to-wall `extra-long`.",
      "",
      "### Worked examples (segment vs custom)",
      "",
      "**Fully generic → all tags**",
      "Before:",
      "`{ beatType: \"content\", custom: true, text: \"And as you exhale, let yourself arrive fully here. [[PAUSE short]] There's nowhere to rush, nowhere to be except right now.\" }`",
      "After:",
      "`{ beatType: \"breath_transition\", custom: false, tag: \"BREATH_TRANSITION\" }`, `{ beatType: \"pause\", pauseBand: \"short\" }`, `{ beatType: \"pace_reassurance\", custom: false, tag: \"PACE_REASSURANCE\" }`",
      "",
      "**Partial split (generic aside only)**",
      "Before:",
      "`{ beatType: \"content\", custom: true, text: \"Now I'm going to invite your attention to slowly move through your body, noticing where you hold tension, and gently asking it to soften and release. There's no rush—just notice what's there.\" }`",
      "After:",
      "`{ beatType: \"content\", custom: true, text: \"Now I'm going to invite your attention to slowly move through your body, noticing where you hold tension, and gently asking it to soften and release.\" }`, `{ beatType: \"pace_reassurance\", custom: false, tag: \"PACE_REASSURANCE\" }`",
      "",
      "**Do not change this (personalized — keep custom):**",
      "`{ beatType: \"settle_opener\", custom: true, text: \"Find a comfortable position, sitting beneath your tree\" }`",
      "`{ beatType: \"content\", custom: true, text: \"This is where you've been feeling that tension\" }`",
      "",
      "**Singular tag + adjacent custom (complement only):**",
      "Before: `{ beatType: \"close_deepen_breath\", custom: false, tag: \"CLOSE_DEEPEN_BREATH\" }`, `{ beatType: \"close_deepen_breath\", custom: true, text: \"Let each breath become a little fuller.\" }`",
      "After: `{ beatType: \"close_deepen_breath\", custom: false, tag: \"CLOSE_DEEPEN_BREATH\" }` only — generic duplicate omitted.",
      "Before: `{ beatType: \"close_sensory_return\", custom: false, tag: \"CLOSE_SENSORY_RETURN\" }`, `{ beatType: \"close_sensory_return\", custom: true, text: \"Notice the room around you and the rustling of leaves from your oak tree.\" }`",
      "After: tag beat, then `{ beatType: \"close_sensory_return\", custom: true, text: \"Notice the rustling of leaves from your oak tree.\" }` — personalized detail only.",
    );
  } else {
    userParts.push(
      "Output **only** the words the guide speaks and these [[PAUSE …]] named-band markers; do not output other markdown or commentary.",
    );
  }

  userParts.push(
    scriptDurationPlanningAppendix(params.targetMinutes, {
      speechSpeed: params.speechSpeed,
    }),
  );

  if (params.includeSegmentPlaceholders && params.segmentTags?.length) {
    userParts.push(
      scriptLabSegmentDurationBudgetAppendix({
        targetMinutes: params.targetMinutes,
        speechSpeed: params.speechSpeed,
        wordTargets: words,
      }),
      "",
      `**Pause budget precedence:** for this **${params.targetMinutes}-minute** target, follow the tiered silence share in **Pause budget (scales with target duration)** above — not a fixed ~${(words.pauseShare * 100).toFixed(0)}% pause share. Reach duration with **more pause beats and heavier bands**, not by inflating spoken word count.`,
    );
  }

  const systemParts = [
    "You are an expert meditation scriptwriter for medimade.io.",
    "You write speakable, production-ready guided meditation scripts.",
    "Avoid self-referential product mentions. Do NOT mention Medimade/the app/this platform unless the user explicitly asks. If you must refer to it, use exactly: 'medimade.io' (lowercase) and nothing else.",
    "If the user is joking or playful, it is OK to include whimsical / funny subject matter (e.g. a monkey eating ice cream on a volcano) BUT the meditation itself should remain genuinely calming, coherent, and high-quality—never 'silly writing' or comedy bits. Use playful imagery as a vehicle for grounding, breath, and emotional regulation.",
    "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the user asks for something socially unacceptable, refuse briefly and offer a safe alternative topic.",
    "You use gender-neutral language and never assume anyone's gender.",
    "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
    `You scale pause density and band weight to the target duration (${params.targetMinutes} min): longer scripts need substantially more silence than shorter ones — reach duration with more pause beats dominated by **long**, not by spraying **extra-long** throughout the core, and not with extra speech.`,
  ];

  if (params.includeSegmentPlaceholders) {
    systemParts.push(
      "For Script Lab you output structured beats (not inline [[SEG:…]] prose). Personalization wins: keep user-specific wording custom. For generic wording, prefer library tags after reading each tag's Description, Repeatability, and Phase in the catalog. Singular tags at most once; connective tags may repeat only when separated by at least one non-pause beat that is a substantive custom beat or a different tag — never the same connective tag with only pauses between instances. Respect opening / body-tour / closing phase rules. **Never output generic custom beats within 1–2 non-pause beats of a singular tag that restate the tag's function** — omit them at generation time; verification trim is only a safety net.",
    );
  }

  return {
    system: systemParts.join(" "),
    userContent: userParts.join("\n"),
    maxTokens: 8192,
  };
}
