import { streamMedimadeChat, type MeditationTargetMinutes } from "@/lib/medimade-api";
import type { MedimadeChatTurn } from "@/lib/medimade-api";

/**
 * Lightweight coach calls for the Plan workspace (journal-style, no preset technique lock-in).
 */
export async function streamPlanCoachReply(
  messages: MedimadeChatTurn[],
  onDelta: (chunk: string) => void,
  opts?: { meditationTargetMinutes?: MeditationTargetMinutes },
): Promise<string> {
  return streamMedimadeChat(
    {
      meditationStyle: "General",
      messages,
      journalMode: true,
      ...(opts?.meditationTargetMinutes ? { meditationTargetMinutes: opts.meditationTargetMinutes } : {}),
    },
    onDelta,
  );
}
