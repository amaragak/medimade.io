import {
  buildJournalHandoffApiContent,
  JOURNAL_CREATE_FIRST_MESSAGE,
  journalEntryPlainForHandoff,
  type JournalEntry,
} from "@/lib/journal-storage";
import type { MedimadeChatTurn } from "@/lib/medimade-api";

export const OPENING_STYLE =
  "What style of meditation should we build? Pick one below or describe your own.";
export const OPENING_JOURNAL = "What’s on your mind?";
export const JOURNAL_REFLECT_PICK_INTRO =
  "Which journal entry would you like to reflect on?";

export type JournalHandoffSegment = {
  entryId: string;
  title: string;
  bodyPlain: string;
  createdAt?: string;
};

export type CreateFlowTranscriptMessage = {
  role: "user" | "assistant";
  text: string;
  variant?: "chat" | "script";
  muted?: boolean;
  kind?: "divider";
  journalSegments?: JournalHandoffSegment[];
};

export function packageOneShotPrompt(rawPrompt: string): string {
  const prompt = rawPrompt.trim();
  return (
    "Please write a complete guided meditation script from this one-shot request. " +
    "Use a calm, warm tone suitable for spoken guidance. Interpret the request generously — " +
    "do not ask clarifying questions.\n\n" +
    `Request:\n${prompt}`
  );
}

export function createFlowTranscriptLine(message: CreateFlowTranscriptMessage): string {
  if (message.role === "user" && message.journalSegments?.length) {
    return buildJournalHandoffApiContent(message.journalSegments);
  }
  return message.text;
}

export function buildCreateFlowTranscript(
  messages: CreateFlowTranscriptMessage[],
): string {
  return messages
    .filter((m) => !m.muted && m.kind !== "divider" && m.variant !== "script")
    .map(
      (m) =>
        `${m.role === "user" ? "User" : "Guide"}: ${createFlowTranscriptLine(m)}`,
    )
    .join("\n\n");
}

export function journalHandoffSegmentFromEntry(entry: JournalEntry): JournalHandoffSegment {
  return {
    entryId: entry.id,
    title: entry.title.trim() || "Untitled",
    bodyPlain: journalEntryPlainForHandoff(entry.contentHtml),
    createdAt: entry.createdAt,
  };
}

export function buildJournalReflectHandoffMessages(
  entry: JournalEntry,
  guidance: string,
): {
  displayMessages: CreateFlowTranscriptMessage[];
  claudeThread: MedimadeChatTurn[];
  apiUserContent: string;
} {
  const journalCards = [journalHandoffSegmentFromEntry(entry)];
  const guidanceNote = guidance.trim();
  const apiUserContent = buildJournalHandoffApiContent(
    journalCards,
    guidanceNote || undefined,
  );
  return {
    displayMessages: [
      {
        role: "user",
        text: JOURNAL_CREATE_FIRST_MESSAGE,
        journalSegments: journalCards,
        variant: "chat",
      },
    ],
    claudeThread: [{ role: "user", content: apiUserContent }],
    apiUserContent,
  };
}

export function buildGuideChatTranscriptFromThread(
  thread: MedimadeChatTurn[],
): string {
  return thread
    .map((t) => `${t.role === "user" ? "User" : "Guide"}: ${t.content.trim()}`)
    .join("\n\n");
}
