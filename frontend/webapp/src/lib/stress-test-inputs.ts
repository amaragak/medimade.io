import type { MeditationStyleLabel } from "@/lib/meditation-style-intake";
import type { StyleQuestionAnswers } from "@/lib/meditation-style-intake";
import { SCRIPT_LAB_MEDITATION_TYPES } from "@/lib/script-lab-coverage";

/** Canonical fixed intake answers per meditation type for stress testing. */
export const STRESS_TEST_FIXED_INPUTS: Record<MeditationStyleLabel, StyleQuestionAnswers> = {
  "Body scan": [
    "linger on lower back",
    "lower back tension",
    "relief",
    "seated or lying",
  ],
  Visualization: [
    "a sunny morning in a garden",
    "birdsong",
    "peaceful",
    "",
  ],
  "Breath-led": [
    "counted breath (4-hold-2-out-6)",
    "scattered",
    "slow then natural",
    "",
  ],
  Manifestation: [
    "financial security",
    "resistance acknowledged",
    "5 years from now",
    "",
  ],
  "Affirmation loop": [
    "self-worth",
    "recent criticism",
    '"I am enough"',
    "",
  ],
  Story: [
    "a lone traveller finds shelter in a storm",
    "about someone else",
    "safe and held",
    "",
  ],
  Reflection: [
    "a close friend who moved away",
    "just sit with it",
    "gratitude and acceptance",
    "",
  ],
  Sleep: [
    "tired but wired",
    "drifting scene",
    "drift off",
    "late night in bed",
  ],
  "Loving-kindness": [
    "directed at a parent",
    "complicated relationship",
    "warmth and forgiveness",
    "",
  ],
  "Anxiety relief": [
    "social anxiety before a presentation",
    "chest and stomach",
    "calm and grounded",
    "",
  ],
  "Movement meditation": [
    "walking in place",
    "restless energy",
    "stay quiet and grounded",
    "office space constraint",
  ],
  "Open awareness": [
    "background anxiety",
    "sitting",
    "just be with it",
    "music playing",
  ],
};

export const STRESS_TEST_MEDITATION_TYPES = SCRIPT_LAB_MEDITATION_TYPES;

export function emptyCustomInputsForType(type: string): StyleQuestionAnswers {
  return ["", "", "", ""];
}

export function resolveStressTestAnswers(
  type: MeditationStyleLabel,
  useFixed: boolean,
  customByType: Partial<Record<MeditationStyleLabel, StyleQuestionAnswers>>,
): StyleQuestionAnswers {
  if (useFixed) return STRESS_TEST_FIXED_INPUTS[type];
  return customByType[type] ?? emptyCustomInputsForType(type);
}
