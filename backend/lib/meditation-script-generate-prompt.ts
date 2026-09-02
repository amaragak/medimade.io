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
      density: "Pauses moderate — **short**, **medium**, and **long** in mix; **extra-long** sparingly.",
      bandMix:
        "Use **medium** as default between beats; **long** after regional invitations; **extra-long** once or twice in the core section at most.",
    };
  }
  if (targetMinutes <= 14) {
    return {
      label: "10 minute",
      silenceShare: "50–60%",
      density: "Pauses generous — frequent **long** and regular **extra-long** in the core practice.",
      bandMix:
        "**Medium** and **long** between most beats; **extra-long** after each major body region or open practice block; **short** mainly within breath pairs.",
    };
  }
  return {
    label: "20 minute",
    silenceShare: "60–70%",
    density:
      "Pauses **dominant** — **extra-long** used freely in core and body-tour sections; the script should feel **spacious**, not filled with speech.",
    bandMix:
      "**Extra-long** should appear **frequently** (often after every regional body beat and every personalized focus passage); **long** as the typical gap elsewhere; **short**/**medium** mainly in opening breath cues and light transitions — not as the default in the body tour.",
  };
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

  return [
    "",
    "### Pause budget (scales with target duration)",
    `This is a **${targetMinutes}-minute** script (${tier.label} tier). Silence is the **primary lever** for hitting the target — not spoken word count.`,
    "",
    "**Duration tiers (starting points — match your target):**",
    "- **2 min:** pauses light, mostly short/medium — silence ~**30–40%** of total duration",
    "- **5 min:** pauses moderate, short/medium/long mix — silence ~**40–50%**",
    "- **10 min:** pauses generous, more long/extra-long — silence ~**50–60%**",
    "- **20 min:** pauses dominant, extra-long freely in core/body sections — silence ~**60–70%** — the script should feel **spacious**, not filled",
    "",
    `**Your tier (${tier.label}):** aim for **~${tier.silenceShare}** of the ~**${stemSeconds}** s stem in pause markers / pause beats — roughly **${targetPauseLo}–${targetPauseHi}** s of silence total. ${tier.density}`,
    "",
    "**Band mix for this target:**",
    tier.bandMix,
    "",
    "**Body tour & core practice (longer scripts):**",
    "- After each **regional body beat** (crown, jaw, shoulders, hips, etc.), follow with a pause **long enough to actually inhabit that region** — on a 10–20 minute script that usually means **long** or **extra-long**, not a brief **short** before moving on.",
    "- After **personalized focus** passages (lower back, the user's stated tension, imagery like sitting beneath their tree), **extra-long** pauses are **expected and correct** — often two or more in a row if the listener needs sustained open time. This is not excessive.",
    "",
    "**Proportional band vocabulary:**",
    "- Scale pause **bands** to target length: on a **20-minute** script, **extra-long** should appear **frequently** throughout the body tour and core; on a **2-minute** script, **extra-long** should appear **rarely or not at all**.",
    "- Do **not** use the same pause density as a 5-minute script and expect a 20-minute result — longer targets need **more pause beats** and **heavier bands**, not longer speeches.",
    "",
    "**Do not pad with words:**",
    "- If duration is short, add **silence** (more pause beats, heavier bands) — **not** more spoken content.",
    "- A 20-minute script may have a **similar word count** to a 10-minute script once pause budget is right; that is **correct and expected**.",
    "- Never increase narration length to compensate for a duration shortfall when the fix is more silence (silence also costs zero TTS).",
    "",
    `Planning check: if your estimated pause total is well below **${targetPauseLo}** s for this ${targetMinutes}-minute target, you have not budgeted enough silence yet.`,
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
      "Singular tags: at most once — a second mention of the same subject area must be custom text, not the same tag again. Connective tags may repeat for pacing; this adjacent-custom rule applies to **singular** tags only.",
      "Before selecting any tag, read its Description; skip tags whose stated boundary conditions apply to this script (e.g. defer BODY_SCAN_SPINE_BACK when lower-back personalization already dominates).",
      "Respect phase rules: SETTLE_OPENER and BREATH_OPENER only in opening; BODY_SCAN_* only after a body-tour intro beat; CLOSE_* only in closing.",
      "Use `{ beatType: \"content\", custom: true, text: \"…\" }` for main personalized practice material (may repeat).",
      "Use `{ beatType: \"pause\", pauseBand: \"medium\" }` for standalone structural silences between beats; use inline `[[PAUSE …]]` inside a custom beat's text only for shorter pauses within one flowing narration.",
      "Pause bands: extra-short, short, medium, long, extra-long (same vocabulary as [[PAUSE …]] rules above).",
      "For long targets, **standalone pause beats** are the main duration lever — insert many `{ beatType: \"pause\", pauseBand: \"long\" }` and `{ beatType: \"pause\", pauseBand: \"extra-long\" }` beats between body regions and after personalized focus; do not rely on inline short pauses alone.",
      "The **Pause budget (scales with target duration)** section above overrides generic pause-share hints when they conflict — longer scripts need proportionally **more** and **heavier** pause beats.",
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
    `You scale pause density and band weight to the target duration (${params.targetMinutes} min): longer scripts need substantially more silence than shorter ones — reach duration with pauses, not extra speech.`,
  ];

  if (params.includeSegmentPlaceholders) {
    systemParts.push(
      "For Script Lab you output structured beats (not inline [[SEG:…]] prose). Personalization wins: keep user-specific wording custom. For generic wording, prefer library tags after reading each tag's Description, Repeatability, and Phase in the catalog. Singular tags at most once; connective tags may repeat. Respect opening / body-tour / closing phase rules. **Never output generic custom beats within 1–2 non-pause beats of a singular tag that restate the tag's function** — omit them at generation time; verification trim is only a safety net.",
    );
  }

  return {
    system: systemParts.join(" "),
    userContent: userParts.join("\n"),
    maxTokens: 8192,
  };
}
