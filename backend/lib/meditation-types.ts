/**
 * Preset meditation categories for library / analytics / LLM metadata.
 * Single source of truth — import here; do not duplicate lists in lambdas.
 */
export const KNOWN_MEDITATION_TYPES = [
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

export type KnownMeditationType = (typeof KNOWN_MEDITATION_TYPES)[number];

export function knownMeditationTypesListForPrompt(): string {
  return KNOWN_MEDITATION_TYPES.join(", ");
}

/** JSON array literal for LLM prompts — model must copy one element verbatim for `meditationType`. */
export function knownMeditationTypesJsonArrayBlock(): string {
  return JSON.stringify([...KNOWN_MEDITATION_TYPES], null, 2);
}

/** Optional copy for script-generation prompts (e.g. streaming script Lambda). */
export function scriptWriterLibraryTypeParagraph(): string {
  return [
    "The product will assign **one** library category from this exact list (spelling matters):",
    `${knownMeditationTypesListForPrompt()}.`,
    "Shape the script so the **main** technique clearly fits **one** category—for example: progressive body attention → Body scan; walking or slow movement cues → Movement meditation; wide, non-directed attention → Open awareness; breath cadence or pranayama-style → Breath-led; gentle repetition of simple English phrases → Affirmation loop; guided imagery → Visualization or Story; Metta → Loving-kindness; worry softening → Anxiety relief; processing → Reflection; sleep → Sleep.",
    "Do **not** name the category in the script; make the practice itself unambiguous.",
  ].join("\n");
}

/**
 * True when the creator picked a concrete style in "choose a type" mode (not journal / not placeholder General).
 * Used to require follow-up questions and scripts to honor that technique.
 */
export function creatorChoseSpecificMeditationTechnique(params: {
  journalMode: boolean;
  meditationStyle: string;
}): boolean {
  if (params.journalMode) return false;
  const t = params.meditationStyle.trim();
  if (!t) return false;
  if (t.toLowerCase() === "general") return false;
  return true;
}

const TYPE_ADHERENCE_LINES: Record<KnownMeditationType, string> = {
  "Body scan":
    "The main practice must progressively move attention through the body (or clearly defined regions), inviting release of tension—not only breath or abstract imagery unless the user steers away in chat.",
  Visualization:
    "The main practice must use sustained guided imagery tied to what they want to see or feel; keep scenes concrete and revisit the visualization—not only breath counting or generic grounding.",
  "Breath-led":
    "The main practice must center on the breath as the primary anchor (cadence, sensations, or simple breath-based regulation)—not substitute a different core technique unless the user asks.",
  Manifestation:
    "The main practice must include future-focused intention and vivid ‘as-if’ or already-here framing aligned with what they want to call in—not only relaxation without that through-line.",
  "Affirmation loop":
    "The main practice must return several times to short, gentle affirmations or phrases the listener can repeat internally—spoken with calm pacing, not a one-off line buried in unrelated content.",
  Story:
    "The main practice must follow a coherent narrative arc with sensory detail and emotional resolution—not a disjointed list of instructions framed as a single metaphor line.",
  Reflection:
    "The main practice must invite inquiry into meaning, values, or what they are carrying—questions or prompts to notice and integrate—not only breath or body without reflective pauses.",
  Sleep:
    "Pacing, language, and imagery must support winding down and drifting off; avoid energizing or problem-solving intensity in the core of the practice.",
  "Loving-kindness":
    "The main practice must include compassionate phrases directed toward self and/or others (metta-style), with quiet repetition or expansion—not only generic self-care without that structure.",
  "Anxiety relief":
    "The main practice must pair grounding or breath with explicit softening of worry, reassurance, or working with racing thoughts—not only a neutral body scan unrelated to anxiety.",
  "Movement meditation":
    "The main practice must guide slow movement, walking, or posture shifts as the primary focus—not only stillness unless the user declined movement in chat.",
  "Open awareness":
    "The main practice must open to a wide field (sounds, sensations, thoughts) without fixing on one object the whole time—explicit invitations to let experience move and change.",
};

/**
 * Concrete technique requirements for chat + script prompts when the user locked a preset type.
 * Caller should only use when `creatorChoseSpecificMeditationTechnique` is true.
 */
export function styleAdherenceBlockForPrompt(meditationStyle: string): string {
  const raw = meditationStyle.trim();
  const norm = normalizeMeditationType(raw);
  const specific = norm ? TYPE_ADHERENCE_LINES[norm] : null;
  const label = norm ?? raw;
  const custom =
    norm == null
      ? `The creator named their approach "${raw}". Your follow-ups must gather what you need to deliver that kind of practice honestly; the script’s core method must match that label for much of the session—not a generic unrelated technique unless they clearly change their mind in the chat.`
      : `Preset type (internal label): "${label}". ${specific}`;
  return ["### Chosen technique (must honor)", custom].join("\n");
}

export function normalizeMeditationType(raw: string): KnownMeditationType | null {
  const t = (raw || "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  const direct = KNOWN_MEDITATION_TYPES.find((x) => x.toLowerCase() === lower);
  if (direct) return direct;

  if (lower === "visualisation") return "Visualization";
  if (lower === "viz" || lower === "visualization") return "Visualization";
  if (lower === "bodyscan" || lower === "body scan") return "Body scan";
  if (lower === "breath led" || lower === "breath-led" || lower === "breath")
    return "Breath-led";
  if (
    lower === "metta" ||
    lower === "loving kindness" ||
    lower === "loving-kindness"
  )
    return "Loving-kindness";
  if (lower === "anxiety" || lower === "anxiety relief") return "Anxiety relief";
  if (
    lower === "affirmations" ||
    lower === "affirmation" ||
    lower === "affirmation loop"
  )
    return "Affirmation loop";

  if (lower === "mantra" || lower === "japa") return "Affirmation loop";
  if (
    lower === "movement meditation" ||
    lower === "walking meditation" ||
    lower === "movement"
  )
    return "Movement meditation";
  if (
    lower === "open awareness" ||
    lower === "open monitoring" ||
    lower === "choiceless awareness"
  )
    return "Open awareness";

  return null;
}

/**
 * Last-resort preset guess from script wording when the metadata LLM fails
 * (e.g. journal mode). Used only as fallback, not primary classification.
 */
export function inferPresetTypeFromScriptHeuristic(
  script: string,
): KnownMeditationType | null {
  const s = script.slice(0, 12_000).toLowerCase();
  if (
    /\b(sleep|asleep|insomnia|bedtime|drift off|fall asleep|dream|under the covers)\b/.test(
      s,
    )
  ) {
    return "Sleep";
  }
  if (
    /\b(mantra|japa|chanting|sacred syllable|repeat (?:silently )?(?:this|the) (?:phrase|word|syllable))\b/.test(
      s,
    )
  ) {
    return "Affirmation loop";
  }
  if (
    /\b(walking meditation|each step|footsteps?|as you walk|pace (?:slowly|gently)|moving (?:slowly|through))\b/.test(
      s,
    )
  ) {
    return "Movement meditation";
  }
  if (
    /\b(open awareness|open monitoring|choiceless|wide field of attention|whatever arises|sounds? (?:and|or) sensations (?:arise|come and go))\b/.test(
      s,
    )
  ) {
    return "Open awareness";
  }
  if (
    /\b(body scan|scan (?:down|through|from)|toes|soles of the feet|ankles|calves|knees|thighs|hips|belly|chest|fingertips|scalp|crown)\b/.test(
      s,
    ) &&
    /\b(notice|feel|sensation|heavy|warm|tingle)\b/.test(s)
  ) {
    return "Body scan";
  }
  if (
    /\b(breath|inhale|exhale|in-breath|out-breath|nostril|belly breath|count (?:to |your )?(?:four|three|five))\b/.test(
      s,
    ) &&
    (s.includes("follow") ||
      s.includes("notice your breath") ||
      s.includes("breathe"))
  ) {
    return "Breath-led";
  }
  if (
    /\b(may you be|may all beings|loving-kindness|metta|send (?:them )?well|compassion for)\b/.test(
      s,
    )
  ) {
    return "Loving-kindness";
  }
  if (
    /\b(anxiety|worried|worry|racing thoughts|nervous|panic|what-ifs|rumination)\b/.test(
      s,
    )
  ) {
    return "Anxiety relief";
  }
  if (
    /\b(visualize|imagine (?:a |yourself|that)|picture (?:a |yourself)|inner light|golden light|safe place)\b/.test(
      s,
    )
  ) {
    return "Visualization";
  }
  if (/\b(once upon|story|journey through|path through the|character who)\b/.test(s)) {
    return "Story";
  }
  if (
    /\b(i am |you are enough|affirm|repeat (?:after me|these words)|again:)\b/.test(s)
  ) {
    return "Affirmation loop";
  }
  if (/\b(manifest|already yours|as if it(’|'| i)s done|universe conspires)\b/.test(s)) {
    return "Manifestation";
  }
  return null;
}
