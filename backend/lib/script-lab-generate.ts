import { buildMeditationScriptGenerationPrompt } from "./meditation-script-generate-prompt";
import { parseAnthropicMessageUsage } from "./anthropic-pricing";
import { verifyScriptLabBeats } from "./script-lab-beat-verification";
import {
  extractBeatsFromAnthropicMessage,
  findDuplicateBeatTypeWarnings,
  scriptLabBeatsToolDefinition,
  type ScriptLabBeat,
  type ScriptLabBeatDuplicateWarning,
} from "./script-lab-beats";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type ScriptLabFlow = "by-type" | "guide-chat" | "journal" | "single-prompt";

function mergeUsage(
  primary: { input_tokens: number; output_tokens: number } | null,
  secondary: { input_tokens: number; output_tokens: number } | null,
): { input_tokens: number; output_tokens: number } | null {
  if (!primary && !secondary) return null;
  return {
    input_tokens: (primary?.input_tokens ?? 0) + (secondary?.input_tokens ?? 0),
    output_tokens: (primary?.output_tokens ?? 0) + (secondary?.output_tokens ?? 0),
  };
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
    scope: import("./script-segment-tags").ScriptSegmentScope;
    types: string[];
    sampleVariants: string[];
  }>;
  generalTagVariants: Array<{
    name: string;
    variants: Array<{ variantId: string; text: string }>;
  }>;
}): Promise<{
  beats: ScriptLabBeat[];
  beatsBeforeVerification: ScriptLabBeat[];
  verificationNewBeatIndices: number[];
  verificationCorrectionsApplied: boolean;
  beatWarnings: ScriptLabBeatDuplicateWarning[];
  usage: { input_tokens: number; output_tokens: number } | null;
}> {
  const { system, userContent } = buildMeditationScriptGenerationPrompt({
    transcript: params.transcript,
    meditationStyle: params.meditationStyle,
    journalMode: params.journalMode,
    targetMinutes: params.targetMinutes,
    speechSpeed: params.speechSpeed,
    includeSegmentPlaceholders: true,
    segmentTags: params.segmentTags,
  });

  const tool = scriptLabBeatsToolDefinition();

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
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [{ role: "user", content: userContent }],
    }),
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(
      `Anthropic script generation failed: ${responseText.slice(0, 2000)}`,
    );
  }

  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid response from Anthropic");
  }

  const beatsBeforeVerification = extractBeatsFromAnthropicMessage(parsed.content);
  const primaryUsage = parseAnthropicMessageUsage(responseText);

  const verified = await verifyScriptLabBeats({
    apiKey: params.apiKey,
    transcript: params.transcript,
    beatsBefore: beatsBeforeVerification,
    generalTags: params.generalTagVariants,
  });

  const beatWarnings = findDuplicateBeatTypeWarnings(verified.beats);

  return {
    beats: verified.beats,
    beatsBeforeVerification: verified.beatsBeforeVerification,
    verificationNewBeatIndices: verified.newBeatIndices,
    verificationCorrectionsApplied: verified.correctionsApplied,
    beatWarnings,
    usage: mergeUsage(primaryUsage, verified.usage),
  };
}
