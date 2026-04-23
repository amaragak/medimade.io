import {
  CLAUDE_HAIKU_45_MODEL_ID,
  anthropicCountMessageInputTokens,
} from "./anthropic-pricing";
import { buildClaudeCoachSystemPrompt } from "./claude-coach-system-prompt";

export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Parse `User: …` / `Guide: …` blocks (same shape the webapp sends as `transcript`).
 */
export function parseCoachTranscriptToMessages(transcript: string): ChatTurn[] {
  const t = transcript.trim();
  if (!t) return [];
  const blocks = t.split(/\n\n+/);
  const out: ChatTurn[] = [];
  for (const b of blocks) {
    const m = b.match(/^(User|Guide):\s*([\s\S]*)$/i);
    if (!m) continue;
    const role = m[1].toLowerCase() === "user" ? "user" : "assistant";
    out.push({ role, content: m[2].trim() });
  }
  return out;
}

/**
 * Rough output tokens for assistant text when we do not have per-turn usage logs.
 * Anthropic uses a BPE tokenizer; ~4 chars/token is a common English ballpark.
 */
function roughOutputTokensFromText(s: string): number {
  const t = s.trim();
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / 4));
}

const MAX_COUNT_TOKEN_CALLS = 48;

/**
 * Estimates coach-chat Claude usage: for each user turn, **input** tokens match
 * `POST /v1/messages/count_tokens` with the same `system` + message prefix as a real
 * `/v1/messages` call. **Output** tokens are a rough sum over assistant replies (no
 * per-turn completion logs in our stack).
 */
export async function estimateCoachChatTokensFromTranscript(params: {
  apiKey: string;
  meditationStyle: string;
  journalMode: boolean;
  transcript: string;
}): Promise<{ inputTokens: number; outputTokens: number } | null> {
  const messages = parseCoachTranscriptToMessages(params.transcript);
  if (messages.length === 0) {
    return { inputTokens: 0, outputTokens: 0 };
  }

  const system = buildClaudeCoachSystemPrompt({
    meditationStyle: params.meditationStyle,
    journalMode: params.journalMode,
    targetMinutes: 5,
  });

  let calls = 0;
  let inputSum = 0;
  let outputSum = 0;

  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].role !== "user") continue;
    const prefix = messages.slice(0, i + 1);
    if (prefix[prefix.length - 1].role !== "user") continue;

    if (calls >= MAX_COUNT_TOKEN_CALLS) return null;
    calls += 1;
    const c = await anthropicCountMessageInputTokens({
      apiKey: params.apiKey,
      model: CLAUDE_HAIKU_45_MODEL_ID,
      system,
      messages: prefix,
    });
    if (c == null) return null;
    inputSum += c;
  }

  for (const m of messages) {
    if (m.role === "assistant") {
      outputSum += roughOutputTokensFromText(m.content);
    }
  }

  return { inputTokens: inputSum, outputTokens: outputSum };
}
