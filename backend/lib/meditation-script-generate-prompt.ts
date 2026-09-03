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
  scriptLabBreathReturnDisambiguationGeneration,
  scriptLabClosingPhaseTagRulesForType,
  scriptLabConnectiveTagSpacingRules,
  scriptLabSingularAdjacentCustomRules,
  scriptPauseBudgetGuidanceAppendix,
  scriptStoryPauseBandCapRules,
  isStoryMeditationType,
  isSleepMeditationType,
} from "./script-lab-shared-prompt-rules";
import {
  scriptSegmentLibraryPromptBlock,
} from "./script-segment-tags";
import {
  scriptLabSegmentDurationBudgetAppendix,
  type SegmentTagForPrompt,
} from "./script-segment-tag-metrics";

export type { SegmentTagForPrompt, SegmentTagTierAverage } from "./script-segment-tag-metrics";

/**
 * Hard rule for spoken scripts and coach chat. Gendered language is allowed
 * only when the creator themselves used it (e.g. “my daughter”, “she”, “I am a man”).
 */
export const GENDER_NEUTRAL_SCRIPT_RULES = [
  "GENDER (non-negotiable): use gender-neutral language throughout. Never assign a gender to the listener, a future self, an inner voice, a guide, a partner, a child, or anyone else in imagery — unless the creator's own words in the conversation already specified that gender.",
  "Forbidden unless the user said it: she/he/her/his/him/hers, herself/himself, woman/man/girl/boy, lady/gentleman, sister/brother as the listener, 'the woman/man you will become', or any invented gendered name.",
  "Address the listener as you. For a third person who is not gendered in the chat, use they/them, this person, the one, that future you, that version of you — never she/he.",
  "Bad: “Imagine the version of yourself in a year. She knows that she is clear.” Good: “Imagine the version of yourself in a year. They know they are clear.” or “That future you knows you are clear.”",
  "If the user wrote she/he/her/his or named a gendered person, you MAY use that same language for that person only. Do not extend it to anyone else.",
].join(" ");

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
  const storyType = isStoryMeditationType(
    params.journalMode ? null : styleForScript,
  );
  const sleepType = isSleepMeditationType(
    params.journalMode ? null : styleForScript,
  );
  const meditationTypeForRules = params.journalMode ? null : styleForScript;
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
    GENDER_NEUTRAL_SCRIPT_RULES,
    "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
    SCRIPT_PAUSE_PROMPT_RULES,
    scriptPauseBudgetGuidanceAppendix(params.targetMinutes, {
      meditationType: meditationTypeForRules,
    }),
    // Closing-phase tag rules are emitted once in the structured-beats section
    // below; the sleep-only copy here was a verbatim duplicate.
    ...(sleepType && !params.includeSegmentPlaceholders
      ? ["", scriptLabClosingPhaseTagRulesForType(meditationTypeForRules)]
      : []),
    "Important formatting constraints:",
    "1) Do NOT output any title, heading, or preamble of any kind.",
    "2) The very first spoken content must start immediately (first non-whitespace characters must be the guide's words).",
    "3) Do NOT start the script with a pause marker; only include pauses after speaking has begun.",
  );

  if (params.includeSegmentPlaceholders) {
    userParts.push(
      "### Output format (Script Lab — structured beats)",
      "Return the script ONLY by calling the `submit_meditation_script_beats` tool with an ordered `beats` array. Do not output free-form prose or [[SEG:…]] markers in chat text.",
      "",
      "**Personalization wins by default.** Prefer `custom: true` whenever text references this user's specific input — their situation, words, or journal details — even if it resembles a library line. Only consider tags for text with **no personalization signal**: wording that would read the same for any user.",
      "Must stay custom (personalized): e.g. \"Find a comfortable position, sitting beneath your tree\"; \"This is where you've been feeling that tension.\" May belong in a tag if a fit exists (generic, no user signal): e.g. \"Let that breath settle, and notice the natural rhythm that lives in your body\"; \"There's no rush—just notice what's there.\"",
      "",
      "For non-pause beats: set `custom: false` with a library `tag` when a segment covers generic wording; set `custom: true` with `beatType` and `text` when personalization needs bespoke phrasing.",
      "If a custom passage mixes personalized content with a generic aside (reassurance, pacing, transition) that carries no personalization, split the aside into its own tag beat and keep the personalized remainder as a separate `content` beat.",
      "Do not over-fragment. Never split personalized phrases or load-bearing lines that would not make sense on their own. One blended custom beat is valid — e.g. for \"sitting under a tree\", `{ beatType: \"settle_opener\", text: \"Notice you're sitting beneath a tree — let that place hold you for these next few minutes.\" }` needs no separate SETTLE_OPENER tag beat afterward.",
      "",
      scriptLabSingularAdjacentCustomRules(),
      "",
      "Follow the **Segment library — selection rules** and per-tag **Repeatability**, **Description**, and **Phase** lines in the catalog above. The adjacent-custom rule applies to **singular** tags only.",
      "",
      scriptLabConnectiveTagSpacingRules(),
      "",
      scriptLabBreathReturnDisambiguationGeneration(),
      "",
      scriptLabClosingPhaseTagRulesForType(meditationTypeForRules),
      "",
      ...(sleepType
        ? [
            "Sleep scripts: never use CLOSE_* tags; end with SLEEP_THRESHOLD → pause extra-long → SLEEP_CLOSE as the final beat — nothing after SLEEP_CLOSE.",
          ]
        : []),
      "",
      "**Beat shapes — emit the minimal fields, nothing more:**",
      "- Library beat: `{ tag: \"SETTLE_OPENER\" }` — never send `beatType` or `custom` here; both are derived from the tag.",
      "- Custom beat: `{ beatType: \"content\", text: \"…\" }` — main personalized practice material (may repeat).",
      "- Pause beat: `{ pauseBand: \"medium\" }` — standalone structural silence between beats.",
      "Use inline `[[PAUSE …]]` inside a custom beat's text only for shorter pauses within one flowing narration.",
      "Pause bands: extra-short, short, medium, long, extra-long (same vocabulary as [[PAUSE …]] rules above).",
      ...(storyType
        ? [
            scriptStoryPauseBandCapRules(),
            "For Story scripts, reach duration through **narrative length** (more scenes and detail), not contemplative silence — do not insert **`long`** or **`extra-long`** pause beats between routine story beats.",
          ]
        : [
            "For long targets, **standalone pause beats** are the main duration lever — insert many `{ pauseBand: \"long\" }` beats between body regions; use `{ pauseBand: \"extra-long\" }` only at the personalized focus linger and genuine emotional peaks (see Pause budget — Extra-long is punctuation). Do not rely on inline short pauses alone, and do not spray `extra-long` every few beats.",
            "The **Pause budget (scales with target duration)** section above overrides generic pause-share hints when they conflict — longer scripts need proportionally **more** pause beats with **`long` as the workhorse**, not wall-to-wall `extra-long`.",
          ]),
      "",
      "### Worked examples (segment vs custom)",
      "",
      "**Fully generic → all tags**",
      "Before: `{ beatType: \"content\", text: \"And as you exhale, let yourself arrive fully here. [[PAUSE short]] There's nowhere to rush, nowhere to be except right now.\" }`",
      "After: `{ tag: \"BREATH_TRANSITION\" }`, `{ pauseBand: \"short\" }`, `{ tag: \"PACE_REASSURANCE\" }`",
      "",
      "**Partial split (generic aside only)**",
      "Before: `{ beatType: \"content\", text: \"Now I'm going to invite your attention to slowly move through your body, noticing where you hold tension, and gently asking it to soften and release. There's no rush—just notice what's there.\" }`",
      "After: `{ beatType: \"content\", text: \"Now I'm going to invite your attention to slowly move through your body, noticing where you hold tension, and gently asking it to soften and release.\" }`, `{ tag: \"PACE_REASSURANCE\" }`",
      "",
      "**Do not change this (personalized — keep custom):**",
      "`{ beatType: \"settle_opener\", text: \"Find a comfortable position, sitting beneath your tree\" }`",
      "`{ beatType: \"content\", text: \"This is where you've been feeling that tension\" }`",
      "",
      "**Singular tag + adjacent custom (complement only):**",
      "Before: `{ tag: \"CLOSE_DEEPEN_BREATH\" }`, `{ beatType: \"close_deepen_breath\", text: \"Let each breath become a little fuller.\" }`",
      "After: `{ tag: \"CLOSE_DEEPEN_BREATH\" }` only — generic duplicate omitted.",
      "Before: `{ tag: \"CLOSE_SENSORY_RETURN\" }`, `{ beatType: \"close_sensory_return\", text: \"Notice the room around you and the rustling of leaves from your oak tree.\" }`",
      "After: tag beat, then `{ beatType: \"close_sensory_return\", text: \"Notice the rustling of leaves from your oak tree.\" }` — personalized detail only.",
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
      storyType
        ? "**Pause budget precedence (Story):** follow the **Story pause band caps** above — narrative pacing overrides length-tier contemplative silence. Do not inflate duration with **`long`** or **`extra-long`** pauses."
        : `**Pause budget precedence:** for this **${params.targetMinutes}-minute** target, follow the tiered silence share in **Pause budget (scales with target duration)** above — not a fixed ~${(words.pauseShare * 100).toFixed(0)}% pause share. Reach duration with **more pause beats and heavier bands**, not by inflating spoken word count.`,
    );
  }

  const systemParts = [
    "You are an expert meditation scriptwriter for medimade.io.",
    "You write speakable, production-ready guided meditation scripts.",
    "Avoid self-referential product mentions. Do NOT mention Medimade/the app/this platform unless the user explicitly asks. If you must refer to it, use exactly: 'medimade.io' (lowercase) and nothing else.",
    "If the user is joking or playful, it is OK to include whimsical / funny subject matter (e.g. a monkey eating ice cream on a volcano) BUT the meditation itself should remain genuinely calming, coherent, and high-quality—never 'silly writing' or comedy bits. Use playful imagery as a vehicle for grounding, breath, and emotional regulation.",
    "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the user asks for something socially unacceptable, refuse briefly and offer a safe alternative topic.",
    GENDER_NEUTRAL_SCRIPT_RULES,
    "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
    storyType
      ? `You scale pause bands for Story narrative pacing (${params.targetMinutes} min): keep silences modest — **medium** max in narrative sections, **long** only at major scene/emotional boundaries, **never extra-long**. Reach duration with story content, not contemplative silence.`
      : `You scale pause density and band weight to the target duration (${params.targetMinutes} min): longer scripts need substantially more silence than shorter ones — reach duration with more pause beats dominated by **long**, not by spraying **extra-long** throughout the core, and not with extra speech.`,
  ];

  if (params.includeSegmentPlaceholders) {
    systemParts.push(
      "For Script Lab you output structured beats (not inline [[SEG:…]] prose). Personalization wins: keep user-specific wording custom. For generic wording, prefer library tags after reading each tag's Description, Repeatability, and Phase in the catalog. Singular tags at most once; connective tags may repeat only when separated by at least one non-pause beat that is a substantive custom beat or a different tag — never the same connective tag with only pauses between instances. Respect opening / body-tour / closing phase rules" +
        (sleepType
          ? " (Sleep: use SLEEP_THRESHOLD → pause extra-long → SLEEP_CLOSE; never CLOSE_*)."
          : ".") +
        " **Never output generic custom beats within 1–2 non-pause beats of a singular tag that restate the tag's function** — omit them at generation time; verification trim is only a safety net.",
    );
  }

  return {
    system: systemParts.join(" "),
    userContent: userParts.join("\n"),
    maxTokens: 8192,
  };
}
