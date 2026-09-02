"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  streamMedimadeChat,
  type MeditationTargetMinutes,
  type ScriptLabFlow,
} from "@/lib/medimade-api";
import type { JournalEntry, JournalFolder } from "@/lib/journal-storage";
import { journalEntriesForReflectPicker } from "@/components/journal-reflect-picker";
import {
  buildCreateFlowTranscript,
  buildGuideChatTranscriptFromThread,
  buildJournalReflectHandoffMessages,
  OPENING_JOURNAL,
  packageOneShotPrompt,
  type CreateFlowTranscriptMessage,
} from "@/lib/create-flow-transcript";
import {
  emptyStyleQuestionAnswers,
  intakeQuestionsForStyle,
  revealedCountFromStyleAnswers,
  STYLE_ANYTHING_ELSE_PROMPT,
  transcriptFromStyleAnswers,
  type StyleQuestionAnswers,
} from "@/lib/meditation-style-intake";
import { SCRIPT_LAB_MEDITATION_TYPES } from "@/lib/script-lab-coverage";

const MEDITATION_TYPES = SCRIPT_LAB_MEDITATION_TYPES;

export type ScriptLabFlowGenerationInput = {
  flow: ScriptLabFlow;
  transcript: string;
  journalMode: boolean;
  meditationStyle: string;
  userTextSample: string;
  /** Style-intake "Anything else?" free-text (by-type flow). */
  additionalContext?: string;
  ready: boolean;
};

type Props = {
  flow: ScriptLabFlow;
  targetMinutes: MeditationTargetMinutes;
  journalEntries: JournalEntry[];
  journalFolders: JournalFolder[];
  onInputChange: (input: ScriptLabFlowGenerationInput) => void;
};

const inputClassName =
  "mt-1 block w-full border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-600 dark:bg-neutral-800";

export function ScriptLabTestFlowPanel({
  flow,
  targetMinutes,
  journalEntries,
  journalFolders,
  onInputChange,
}: Props) {
  const [meditationStyle, setMeditationStyle] = useState<string>(MEDITATION_TYPES[0]);
  const [styleAnswers, setStyleAnswers] = useState<StyleQuestionAnswers>(
    emptyStyleQuestionAnswers(),
  );
  const [styleRevealed, setStyleRevealed] = useState(1);

  const [guideMessages, setGuideMessages] = useState<CreateFlowTranscriptMessage[]>([
    { role: "assistant", text: OPENING_JOURNAL, variant: "chat" },
  ]);
  const [guideThread, setGuideThread] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [guideInput, setGuideInput] = useState("");
  const [guideLoading, setGuideLoading] = useState(false);
  const [guideReady, setGuideReady] = useState(false);

  const [journalEntryId, setJournalEntryId] = useState("");
  const [journalGuidance, setJournalGuidance] = useState("");
  const [journalConfirmed, setJournalConfirmed] = useState(false);
  const [journalHandoffMessages, setJournalHandoffMessages] = useState<
    CreateFlowTranscriptMessage[]
  >([]);

  const [singlePrompt, setSinglePrompt] = useState("");

  const reflectEntries = useMemo(
    () => journalEntriesForReflectPicker(journalEntries),
    [journalEntries],
  );

  useEffect(() => {
    if (reflectEntries[0]?.id && !journalEntryId) {
      setJournalEntryId(reflectEntries[0].id);
    }
  }, [reflectEntries, journalEntryId]);

  useEffect(() => {
    setStyleAnswers(emptyStyleQuestionAnswers());
    setStyleRevealed(1);
    setGuideMessages([{ role: "assistant", text: OPENING_JOURNAL, variant: "chat" }]);
    setGuideThread([]);
    setGuideInput("");
    setGuideLoading(false);
    setGuideReady(false);
    setJournalGuidance("");
    setJournalConfirmed(false);
    setJournalHandoffMessages([]);
    setSinglePrompt("");
  }, [flow]);

  const generationInput = useMemo((): ScriptLabFlowGenerationInput => {
    if (flow === "by-type") {
      const style = meditationStyle.trim();
      const answersReady =
        styleAnswers[0].trim().length > 0 &&
        styleAnswers[1].trim().length > 0 &&
        styleAnswers[2].trim().length > 0;
      if (!answersReady) {
        return {
          flow,
          transcript: "",
          journalMode: false,
          meditationStyle: style,
          userTextSample: styleAnswers.join("\n"),
          additionalContext: styleAnswers[3].trim(),
          ready: false,
        };
      }
      const built = transcriptFromStyleAnswers(style, styleAnswers);
      return {
        flow,
        transcript: buildCreateFlowTranscript(built.messages),
        journalMode: false,
        meditationStyle: style,
        userTextSample: styleAnswers.filter(Boolean).join("\n"),
        additionalContext: styleAnswers[3].trim(),
        ready: true,
      };
    }

    if (flow === "guide-chat") {
      const transcript =
        guideThread.length > 0
          ? buildGuideChatTranscriptFromThread(guideThread)
          : buildCreateFlowTranscript(guideMessages);
      return {
        flow,
        transcript,
        journalMode: true,
        meditationStyle: "General",
        userTextSample: guideThread
          .filter((t) => t.role === "user")
          .map((t) => t.content)
          .join("\n"),
        ready: guideThread.some((t) => t.role === "user"),
      };
    }

    if (flow === "journal") {
      if (!journalConfirmed || journalHandoffMessages.length === 0) {
        return {
          flow,
          transcript: "",
          journalMode: true,
          meditationStyle: "General",
          userTextSample: journalGuidance,
          ready: false,
        };
      }
      return {
        flow,
        transcript: buildCreateFlowTranscript(journalHandoffMessages),
        journalMode: true,
        meditationStyle: "General",
        userTextSample: journalGuidance,
        ready: true,
      };
    }

    const packaged = singlePrompt.trim();
    const ready = packaged.length > 0;
    return {
      flow,
      transcript: ready
        ? `User: ${packageOneShotPrompt(packaged)}`
        : "",
      journalMode: true,
      meditationStyle: "General",
      userTextSample: packaged,
      ready,
    };
  }, [
    flow,
    meditationStyle,
    styleAnswers,
    guideThread,
    guideMessages,
    guideReady,
    journalConfirmed,
    journalHandoffMessages,
    journalGuidance,
    singlePrompt,
  ]);

  useEffect(() => {
    onInputChange(generationInput);
  }, [generationInput, onInputChange]);

  const sendGuideMessage = useCallback(async () => {
    const trimmed = guideInput.trim();
    if (!trimmed || guideLoading) return;
    setGuideInput("");
    setGuideLoading(true);
    try {
      const history =
        guideThread.length === 0
          ? [
              { role: "assistant" as const, content: OPENING_JOURNAL },
              { role: "user" as const, content: trimmed },
            ]
          : [...guideThread, { role: "user" as const, content: trimmed }];
      setGuideMessages((prev) => [...prev, { role: "user", text: trimmed, variant: "chat" }]);
      const text = await streamMedimadeChat(
        {
          meditationStyle: "General",
          messages: history,
          journalMode: true,
          meditationTargetMinutes: targetMinutes,
        },
        () => {},
      );
      const nextThread = [...history, { role: "assistant" as const, content: text }];
      setGuideThread(nextThread);
      setGuideMessages((prev) => [
        ...prev,
        { role: "assistant", text: text.replace(/\[\[\s*READY\s*\]\]/gi, "").trim(), variant: "chat" },
      ]);
      setGuideReady(/\[\[\s*READY\s*\]\]/i.test(text));
    } catch {
      setGuideMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry — could not reach the guide.", variant: "chat" },
      ]);
    } finally {
      setGuideLoading(false);
    }
  }, [guideInput, guideLoading, guideThread, targetMinutes]);

  function confirmJournalSelection() {
    const entry = reflectEntries.find((e) => e.id === journalEntryId);
    if (!entry) return;
    const handoff = buildJournalReflectHandoffMessages(entry, journalGuidance);
    setJournalHandoffMessages(handoff.displayMessages);
    setJournalConfirmed(true);
  }

  if (flow === "by-type") {
    const questions = intakeQuestionsForStyle(meditationStyle);
    return (
      <div className="space-y-2">
        <label className="block">
          Type
          <select
            value={meditationStyle}
            onChange={(e) => {
              setMeditationStyle(e.target.value);
              setStyleAnswers(emptyStyleQuestionAnswers());
              setStyleRevealed(1);
            }}
            className={inputClassName}
          >
            {MEDITATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {questions.slice(0, Math.min(3, styleRevealed)).map((q, i) => (
          <label key={`${meditationStyle}-${i}`} className="block">
            {q}
            <textarea
              value={styleAnswers[i]}
              rows={2}
              onChange={(e) => {
                const v = e.target.value;
                setStyleAnswers((prev) => {
                  const next = [...prev] as StyleQuestionAnswers;
                  next[i] = v;
                  setStyleRevealed(revealedCountFromStyleAnswers(next));
                  return next;
                });
              }}
              className={inputClassName}
            />
          </label>
        ))}
        {styleRevealed >= 4 ? (
          <label className="block">
            {STYLE_ANYTHING_ELSE_PROMPT}
            <span className="text-neutral-500"> (optional)</span>
            <textarea
              value={styleAnswers[3]}
              rows={2}
              onChange={(e) => {
                const v = e.target.value;
                setStyleAnswers((prev) => {
                  const next = [...prev] as StyleQuestionAnswers;
                  next[3] = v;
                  return next;
                });
              }}
              className={inputClassName}
            />
          </label>
        ) : null}
      </div>
    );
  }

  if (flow === "guide-chat") {
    return (
      <div className="space-y-2">
        <div className="max-h-40 space-y-1 overflow-y-auto border border-neutral-300 bg-white p-2 dark:border-neutral-600 dark:bg-neutral-800">
          {guideMessages.map((m, i) => (
            <p key={i} className="leading-snug">
              <span className="text-neutral-500">
                {m.role === "user" ? "You" : "Guide"}:
              </span>{" "}
              {m.text.slice(0, 500)}
              {m.text.length > 500 ? "…" : ""}
            </p>
          ))}
          {guideLoading ? (
            <p className="text-neutral-500">Guide is typing…</p>
          ) : null}
        </div>
        <label className="block">
          Message
          <textarea
            value={guideInput}
            rows={3}
            onChange={(e) => setGuideInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendGuideMessage();
              }
            }}
            className={inputClassName}
          />
        </label>
        <button
          type="button"
          disabled={guideLoading || !guideInput.trim()}
          onClick={() => void sendGuideMessage()}
          className="w-full cursor-pointer border border-neutral-400 bg-white py-1 disabled:opacity-50 dark:border-neutral-500 dark:bg-neutral-800"
        >
          Send
        </button>
        {guideReady ? (
          <p className="text-[10px] text-green-700 dark:text-green-400">
            Guide marked ready — you can generate.
          </p>
        ) : (
          <p className="text-[10px] text-neutral-500">
            Chat until the guide signals ready, or send a few turns then generate.
          </p>
        )}
      </div>
    );
  }

  if (flow === "journal") {
    return (
      <div className="space-y-2">
        <label className="block">
          Journal entry
          <select
            value={journalEntryId}
            onChange={(e) => {
              setJournalEntryId(e.target.value);
              setJournalConfirmed(false);
            }}
            className={inputClassName}
          >
            {reflectEntries.length === 0 ? (
              <option value="">No entries loaded</option>
            ) : (
              reflectEntries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.title?.trim() || "Untitled"}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="block">
          Reflection note
          <span className="text-neutral-500"> (optional)</span>
          <textarea
            value={journalGuidance}
            rows={3}
            onChange={(e) => {
              setJournalGuidance(e.target.value);
              setJournalConfirmed(false);
            }}
            placeholder="How should the guide use this entry?"
            className={inputClassName}
          />
        </label>
        <button
          type="button"
          disabled={!journalEntryId}
          onClick={confirmJournalSelection}
          className="w-full cursor-pointer border border-neutral-400 bg-white py-1 disabled:opacity-50 dark:border-neutral-500 dark:bg-neutral-800"
        >
          {journalConfirmed ? "Entry confirmed" : "Confirm entry →"}
        </button>
        {journalFolders.length > 0 ? (
          <p className="text-[10px] text-neutral-500">
            {reflectEntries.length} reflectable entries ({journalFolders.length} folders).
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <label className="block">
      Prompt
      <textarea
        value={singlePrompt}
        rows={4}
        onChange={(e) => setSinglePrompt(e.target.value)}
        placeholder="e.g. A 10-minute body scan for restless sleep…"
        className={inputClassName}
      />
    </label>
  );
}
