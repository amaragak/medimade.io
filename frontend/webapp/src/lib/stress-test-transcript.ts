import { buildCreateFlowTranscript } from "@/lib/create-flow-transcript";
import {
  transcriptFromStyleAnswers,
  type StyleQuestionAnswers,
} from "@/lib/meditation-style-intake";
import type { MeditationStyleLabel } from "@/lib/meditation-style-intake";

export function buildStressTestTranscript(
  meditationType: MeditationStyleLabel,
  answers: StyleQuestionAnswers,
): { transcript: string; additionalContext: string } {
  const built = transcriptFromStyleAnswers(meditationType, answers);
  return {
    transcript: buildCreateFlowTranscript(built.messages),
    additionalContext: answers[3].trim(),
  };
}
