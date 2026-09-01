import type { MedimadeChatTurn } from "@/lib/medimade-api";

export const MEDITATION_STYLE_LABELS = [
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

export type MeditationStyleLabel = (typeof MEDITATION_STYLE_LABELS)[number];

export const STYLE_ANYTHING_ELSE_PROMPT = "Anything else you would like to add?";

/** Three targeted intake questions per preset type (style path; not chat). */
export const STYLE_INTAKE_QUESTIONS: Record<MeditationStyleLabel, [string, string, string]> = {
  "Body scan": [
    "Would you like a full head-to-toe scan, or to linger on a few areas?",
    "Where in your body are you holding the most tension or discomfort right now?",
    "What would you like to feel in your body by the end?",
  ],
  Visualization: [
    "What do you want to visualise — a place, object, or presence that matters to you? Describe.",
    "What’s the first vivid detail you notice (sight, sound, touch, or a sense of presence)?",
    "How do you want to feel as you stay with this image?",
  ],
  "Breath-led": [
    "Do you want counted breaths, or to follow the breath as it is?",
    "How do you feel right now—wired, tired, scattered, something else?",
    "Do you want a slow, long breath, or to keep a natural pace?",
  ],
  Manifestation: [
    "What do you want to manifest?",
    "Is anything getting in the way of this—doubt, fear, a practical obstacle?",
    "How would you feel if this actually came true?",
  ],
  "Affirmation loop": [
    "What feeling are you trying to generate?",
    "Is there a goal you’re moving towards?",
    "Are there any words or phrases you want to use specifically?",
  ],
  Story: [
    "What style should the story be—zen story, kids’ story, fable, something else?",
    "Are you in the story, or is it about someone else?",
    "What feeling should it leave you with?",
  ],
  Reflection: [
    "What do you need to process?",
    "Do you want to look for an answer, or just sit with it?",
    "What would a helpful insight or shift look like when you’re done?",
  ],
  Sleep: [
    "How are you feeling as you get ready for sleep?",
    "Do you want a drifting scene, or just body and breath?",
    "How do you want to feel as you fall asleep?",
  ],
  "Loving-kindness": [
    "Who is this practice for today—yourself, someone else, or both?",
    "How do you feel toward them—or toward yourself—right now?",
    "What kind of kindness is most needed (warmth, forgiveness, belonging)?",
  ],
  "Anxiety relief": [
    "What’s the main worry or pressure right now?",
    "Do you feel it in your body, and if so, where?",
    "How do you want to feel by the end of this session?",
  ],
  "Movement meditation": [
    "Will you be walking, stretching in place, or something else?",
    "How does your body feel as you start—restless, stiff, tired?",
    "Any limits we should work around—injury, tight space, needing to stay quiet?",
  ],
  "Open awareness": [
    "What pulls your attention away most—thoughts, sounds, restlessness?",
    "What’s your position—sitting, standing, lying down, or walking?",
    "Where are you right now? Is it quiet or noisy?",
  ],
};

export type StyleQuestionAnswers = [string, string, string, string];

export function intakeQuestionsForStyle(style: string): [string, string, string] {
  if ((MEDITATION_STYLE_LABELS as readonly string[]).includes(style)) {
    return STYLE_INTAKE_QUESTIONS[style as MeditationStyleLabel];
  }
  const trimmed = style.trim() || "this";
  return [
    `How are you feeling today, and what do you want this “${trimmed}” practice to support?`,
    "Is there a situation, person, or inner state we should keep in mind?",
    "How do you want to feel when the meditation ends?",
  ];
}

export function emptyStyleQuestionAnswers(): StyleQuestionAnswers {
  return ["", "", "", ""];
}

/** How many intake fields to show: 1–4 (3 questions + optional anything else). */
export function revealedCountFromStyleAnswers(answers: StyleQuestionAnswers): number {
  let n = 1;
  for (let i = 0; i < 3; i += 1) {
    if (!answers[i].trim()) break;
    n = i + 2;
  }
  return Math.min(4, n);
}

export function parseStyleQuestionAnswers(raw: unknown): StyleQuestionAnswers | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const next = emptyStyleQuestionAnswers();
  for (let i = 0; i < 4; i += 1) {
    const v = raw[i];
    next[i] = typeof v === "string" ? v : "";
  }
  return next;
}

export type StyleIntakeChatMessage = {
  role: "user" | "assistant";
  text: string;
  variant?: "chat";
};

export function transcriptFromStyleAnswers(
  style: string,
  answers: StyleQuestionAnswers,
): { messages: StyleIntakeChatMessage[]; claudeThread: MedimadeChatTurn[] } {
  const questions = intakeQuestionsForStyle(style);
  const messages: StyleIntakeChatMessage[] = [
    {
      role: "assistant",
      text: `We'll shape a ${style} meditation from your answers.`,
      variant: "chat",
    },
  ];
  questions.forEach((q, i) => {
    messages.push({ role: "assistant", text: q, variant: "chat" });
    messages.push({ role: "user", text: answers[i].trim() });
  });
  const extra = answers[3].trim();
  if (extra) {
    messages.push({
      role: "assistant",
      text: STYLE_ANYTHING_ELSE_PROMPT,
      variant: "chat",
    });
    messages.push({ role: "user", text: extra });
  }
  const claudeThread: MedimadeChatTurn[] = messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));
  return { messages, claudeThread };
}
