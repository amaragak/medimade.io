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
  type ScriptSegmentScope,
} from "./script-segment-tags";

export type SegmentTagForPrompt = {
  name: string;
  scope: ScriptSegmentScope;
  types: string[];
  sampleVariants: string[];
};

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
      "Never produce two beats with the same functional beatType (except `content` and `pause`, which may repeat).",
      "Use `{ beatType: \"content\", custom: true, text: \"…\" }` for main personalized practice material (may repeat).",
      "Use `{ beatType: \"pause\", pauseBand: \"medium\" }` for standalone structural silences between beats; use inline `[[PAUSE …]]` inside a custom beat's text only for shorter pauses within one flowing narration.",
      "Pause bands: extra-short, short, medium, long, extra-long (same vocabulary as [[PAUSE …]] rules above).",
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

  const systemParts = [
    "You are an expert meditation scriptwriter for medimade.io.",
    "You write speakable, production-ready guided meditation scripts.",
    "Avoid self-referential product mentions. Do NOT mention Medimade/the app/this platform unless the user explicitly asks. If you must refer to it, use exactly: 'medimade.io' (lowercase) and nothing else.",
    "If the user is joking or playful, it is OK to include whimsical / funny subject matter (e.g. a monkey eating ice cream on a volcano) BUT the meditation itself should remain genuinely calming, coherent, and high-quality—never 'silly writing' or comedy bits. Use playful imagery as a vehicle for grounding, breath, and emotional regulation.",
    "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the user asks for something socially unacceptable, refuse briefly and offer a safe alternative topic.",
    "You use gender-neutral language and never assume anyone's gender.",
    "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
    "You place pauses **generously and often** for clarity and pacing—especially spacious where self-paced work needs room—while keeping each silence **motivated** (never mechanical fillers).",
  ];

  if (params.includeSegmentPlaceholders) {
    systemParts.push(
      "For Script Lab you output structured beats (not inline [[SEG:…]] prose). Personalization wins: keep user-specific wording custom. For generic wording only, prefer library tags after checking the full eligible list; split swappable asides into tag beats without over-fragmenting personalized passages. Never duplicate functional beatTypes (except content and pause).",
    );
  }

  return {
    system: systemParts.join(" "),
    userContent: userParts.join("\n"),
    maxTokens: 8192,
  };
}
