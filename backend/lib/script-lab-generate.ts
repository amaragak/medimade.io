import { buildMeditationScriptGenerationPrompt } from "./meditation-script-generate-prompt";
import { parseAnthropicMessageUsage } from "./anthropic-pricing";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export type ScriptLabFlow = "by-type" | "guide-chat" | "journal" | "single-prompt";

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
}): Promise<{
  script: string;
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
