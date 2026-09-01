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
import { parseAnthropicMessageUsage } from "./anthropic-pricing";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type ScriptLabFlow = "by-type" | "guide-chat" | "journal" | "single-prompt";

export function buildScriptLabTranscript(params: {
  flow: ScriptLabFlow;
  meditationStyle?: string;
  moodFocus?: string;
  chatText?: string;
  journalTitle?: string;
  journalBody?: string;
  singlePrompt?: string;
}): { transcript: string; journalMode: boolean; meditationStyle: string } {
  switch (params.flow) {
    case "by-type": {
      const style = params.meditationStyle?.trim() || "Open awareness";
      const mood = params.moodFocus?.trim() || "Calm and grounded";
      return {
        transcript: [
          "User: I'd like a meditation.",
          `Guide: What style are you drawn to?`,
          `User: ${style}. Mood or focus: ${mood}.`,
        ].join("\n\n"),
        journalMode: false,
        meditationStyle: style,
      };
    }
    case "guide-chat":
      return {
        transcript: `User: ${params.chatText?.trim() || "(empty)"}`,
        journalMode: true,
        meditationStyle: "General",
      };
    case "journal": {
      const title = params.journalTitle?.trim() || "Journal entry";
      const body = params.journalBody?.trim() || "";
      return {
        transcript: [
          "User: Please create a meditation from my journal entry.",
          "",
          `--- ${title} ---`,
          body,
        ].join("\n"),
        journalMode: true,
        meditationStyle: "General",
      };
    }
    case "single-prompt":
    default:
      return {
        transcript: `User: ${params.singlePrompt?.trim() || "(empty)"}`,
        journalMode: true,
        meditationStyle: "General",
      };
  }
}

export async function generateScriptLabScript(params: {
  apiKey: string;
  model: string;
  transcript: string;
  meditationStyle: string;
  journalMode: boolean;
  targetMinutes: number;
  speechSpeed: number;
  segmentTags: Array<{
    name: string;
    scope: ScriptSegmentScope;
    types: string[];
    sampleVariants: string[];
  }>;
}): Promise<{
  script: string;
  usage: { input_tokens: number; output_tokens: number } | null;
}> {
  const words = getFleetScriptWordTargets({
    targetMinutes: params.targetMinutes,
    speechSpeed: params.speechSpeed,
  });

  const styleForScript = params.meditationStyle.trim();
  const styleHint = styleForScript
    ? `Preferred meditation style from the creator: "${styleForScript}".`
    : "The creator has not locked a style label yet — infer an appropriate approach from the input.";
  const styleLocked = creatorChoseSpecificMeditationTechnique({
    journalMode: params.journalMode,
    meditationStyle: styleForScript,
  });
  const lockBlock = styleLocked
    ? [
        "",
        styleAdherenceBlockForPrompt(styleForScript),
        "",
        "Spend a substantial part of the practice on the chosen technique above while reflecting the creator's situation.",
      ].join("\n")
    : "";

  const segmentBlock = scriptSegmentLibraryPromptBlock({
    tags: params.segmentTags,
    meditationType: params.journalMode ? null : styleForScript,
  });

  const userContent = [
    styleHint,
    lockBlock,
    "",
    segmentBlock,
    "",
    "### Conversation / input (chronological)",
    params.transcript.trim() || "(No input yet.)",
    "",
    "### Your task",
    "Write the complete guided meditation script that a human guide would read aloud for recording.",
    `Target length: about **${params.targetMinutes} minutes** at a calm pace (roughly ${words.min}–${words.max} words, plus pauses).`,
    "Use clear sections. Match tone and intentions implied by the input.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Phrase for natural text-to-speech: avoid isolated one-word sentences.",
    SCRIPT_PAUSE_PROMPT_RULES,
    "When you use a reusable segment, output the exact placeholder `[[SEG:TAG_NAME]]` — do not paraphrase the library line inline.",
    "Output **only** spoken words, `[[SEG:…]]` placeholders, and `[[PAUSE …]]` markers — no markdown headings or commentary.",
    scriptDurationPlanningAppendix(params.targetMinutes, {
      speechSpeed: params.speechSpeed,
    }),
  ].join("\n");

  const system = [
    "You are an expert meditation scriptwriter for medimade.io Script Lab.",
    "You write speakable, production-ready guided meditation scripts.",
    "Reusable segments are optional tools — insert only tags that fit; fill the rest with original narration.",
    "Never generate harmful or non-consensual content.",
  ].join(" ");

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(
      `Anthropic script generation failed: ${responseText.slice(0, 2000)}`,
    );
  }

  let parsed: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid response from Anthropic");
  }

  const text =
    parsed.content?.find((c) => c?.type === "text")?.text?.trim() ?? "";
  if (!text) throw new Error("Empty script returned by Anthropic");
  return { script: text, usage: parseAnthropicMessageUsage(responseText) };
}
