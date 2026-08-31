/**
 * Predefined Ideate reflection questions.
 * PLACEHOLDER COPY — not final; replace before shipping copy review.
 */

export type IdeateReflectionQuestionPreset = {
  id: string;
  text: string;
  description: string;
};

export const IDEATE_REFLECTION_QUESTION_PRESETS: readonly IdeateReflectionQuestionPreset[] =
  [
    {
      id: "regret",
      text: "What would you regret not trying?",
      description: "A quiet nudge toward the thing you keep postponing.",
    },
    {
      id: "who-there",
      text: "Who do you want to be there when it happens?",
      description: "Name the people who make the dream feel real.",
    },
    {
      id: "avoiding",
      text: "What are you avoiding thinking about?",
      description: "The uncomfortable edge often points the way.",
    },
    {
      id: "enough",
      text: "What would ‘enough’ look like here?",
      description: "Soften the finish line so you can move toward it.",
    },
    {
      id: "body-knows",
      text: "What does your body already know about this?",
      description: "Before the plan — what does it feel like?",
    },
  ] as const;
