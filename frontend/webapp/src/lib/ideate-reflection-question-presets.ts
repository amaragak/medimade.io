/**
 * Predefined Ideate reflection questions for the home / self-definition page.
 * Keep these life-level (identity, values, direction) — project-specific prompts
 * belong inside a life area, not here.
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
      id: "become",
      text: "What kind of person are you trying to become?",
      description: "Not a job title — how you want to show up.",
    },
    {
      id: "more-of",
      text: "What do you want more of in your life?",
      description: "Time, people, craft, rest — name it plainly.",
    },
    {
      id: "less-of",
      text: "What do you want less of?",
      description: "Habits, obligations, noise you’d gladly drop.",
    },
    {
      id: "nonnegotiable",
      text: "What are you unwilling to compromise on?",
      description: "The line you won’t cross to make life easier.",
    },
    {
      id: "proud",
      text: "Who do you want to be able to respect you?",
      description: "A person — including yourself — be specific.",
    },
    {
      id: "avoiding",
      text: "What truth about your life are you ducking?",
      description: "The one that would change how you spend your weeks.",
    },
    {
      id: "five-years",
      text: "What would make the next five years feel well spent?",
      description: "One or two outcomes you’d be proud to point at.",
    },
    {
      id: "ordinary-day",
      text: "What does a good ordinary day look like for you?",
      description: "Not a vacation — a Tuesday that feels right.",
    },
    {
      id: "relationship",
      text: "Which relationship needs more of your real attention?",
      description: "Partner, parent, friend, kid — name who.",
    },
    {
      id: "stop-performing",
      text: "What are you ready to stop performing?",
      description: "The role or image that’s exhausting you.",
    },
    {
      id: "money-truth",
      text: "What’s the honest story with your money right now?",
      description: "Anxiety, avoidance, goals — say it without spin.",
    },
    {
      id: "energy",
      text: "When do you feel most like yourself?",
      description: "A place, activity, or company — be concrete.",
    },
    {
      id: "legacy-small",
      text: "What do you want people closest to you to say about you?",
      description: "One sentence you’d hope is true.",
    },
  ] as const;
