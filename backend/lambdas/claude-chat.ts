import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  creatorChoseSpecificMeditationTechnique,
  styleAdherenceBlockForPrompt,
} from "../lib/meditation-types";
import { buildClaudeCoachSystemPrompt } from "../lib/claude-coach-system-prompt";
import {
  getFleetScriptWordTargets,
  scriptDurationPlanningAppendix,
} from "../lib/script-duration-planning-prompt";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-haiku-4-5";

const secrets = new SecretsManagerClient({});
let cachedKey: string | undefined;

async function getClaudeApiKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const arn = process.env.CLAUDE_SECRET_ARN;
  if (!arn) throw new Error("CLAUDE_SECRET_ARN is not set");
  const out = await secrets.send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Claude API key secret is empty");
  cachedKey = s;
  return cachedKey;
}

type ChatTurn = { role: "user" | "assistant"; content: string };

function writeJsonError(
  responseStream: awslambda.HttpResponseStream,
  statusCode: number,
  payload: Record<string, unknown>,
): void {
  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode,
    headers: { "content-type": "application/json" },
  });
  stream.write(JSON.stringify(payload));
  stream.end();
}

async function pipeAnthropicSseToClient(
  upstream: ReadableStream<Uint8Array>,
  out: awslambda.HttpResponseStream,
): Promise<void> {
  const reader = upstream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const json = line.replace(/^data:\s*/, "").trim();
        if (!json || json === "[DONE]") continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(json) as Record<string, unknown>;
        } catch {
          continue;
        }
        if (data.type === "content_block_delta") {
          const delta = data.delta as Record<string, unknown> | undefined;
          if (
            delta?.type === "text_delta" &&
            typeof delta.text === "string" &&
            delta.text.length > 0
          ) {
            out.write(
              `data: ${JSON.stringify({ d: delta.text })}\n\n`,
            );
          }
        }
        if (data.type === "error") {
          const err = data.error as Record<string, unknown> | undefined;
          const msg =
            typeof err?.message === "string"
              ? err.message
              : "Anthropic stream error";
          out.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
        }
      }
    }
  }
  out.write(`data: ${JSON.stringify({ done: true })}\n\n`);
}

async function streamHandler(
  event: APIGatewayProxyEventV2,
  responseStream: awslambda.HttpResponseStream,
  _context: Context,
): Promise<void> {
  const method = event.requestContext?.http?.method ?? "";
  if (method !== "POST") {
    if (method === "OPTIONS") {
      const s = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 204,
        headers: {},
      });
      s.end();
      return;
    }
    writeJsonError(responseStream, 405, { error: "Method not allowed" });
    return;
  }

  let apiKey: string;
  try {
    apiKey = await getClaudeApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Secret lookup failed";
    writeJsonError(responseStream, 500, { error: msg });
    return;
  }

  let body: {
    mode?: string;
    meditationStyle?: string;
    messages?: ChatTurn[];
    transcript?: string;
    /** Web create flow: 2, 5, or 10 minute guided target. */
    meditationTargetMinutes?: number;
    /** Fish playback speed (1 = default); used with fleet word targets. */
    speechSpeed?: number;
    /** Web journal flow uses placeholder style; do not lock technique to that label. */
    journalMode?: boolean;
  };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    writeJsonError(responseStream, 400, { error: "Invalid JSON body" });
    return;
  }

  const tm = body.meditationTargetMinutes;
  const meditationTargetMinutes =
    tm === 2 || tm === 5 || tm === 10 ? tm : 5;

  const mode =
    body.mode === "generate_script" ? "generate_script" : "chat";

  let system: string;
  let messages: ChatTurn[];
  let maxTokens: number;

  if (mode === "generate_script") {
    const transcript =
      typeof body.transcript === "string" ? body.transcript.trim() : "";
    const styleForScript =
      typeof body.meditationStyle === "string"
        ? body.meditationStyle.trim()
        : "";
    const journalMode = body.journalMode === true;
    const speechSpeed =
      typeof body.speechSpeed === "number" && Number.isFinite(body.speechSpeed)
        ? body.speechSpeed
        : 1;
    const wordT = getFleetScriptWordTargets({
      targetMinutes: meditationTargetMinutes,
      speechSpeed,
    });
    const scriptWordsMin = wordT.min;
    const scriptWordsMax = wordT.max;
    const styleLocked = creatorChoseSpecificMeditationTechnique({
      journalMode,
      meditationStyle: styleForScript,
    });
    const styleHint = styleForScript
      ? `Preferred meditation style from the creator: "${styleForScript}".`
      : "The creator has not locked a style label yet — infer an appropriate approach from the chat.";

    const lockBlock = styleLocked
      ? [
          "",
          styleAdherenceBlockForPrompt(styleForScript),
          "",
          "The script must spend a substantial part of the practice on the chosen technique above (not a brief nod while the rest is a generic unrelated meditation), while still reflecting the user’s situation from the conversation.",
        ].join("\n")
      : "";

    const userContent = [
      styleHint,
      lockBlock,
      "",
      "### Conversation between creator and guide (chronological)",
      transcript || "(No messages yet.)",
      "",
      "### Your task",
      "Write the complete guided meditation script that a human guide would read aloud for recording.",
      `Target length: about **${meditationTargetMinutes} minutes** at a calm, unhurried speaking pace (roughly ${scriptWordsMin}–${scriptWordsMax} words).`,
      "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
      "Match the emotional tone, intentions, and imagery implied by the conversation.",
      "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
      "Use gender-neutral language throughout; never assume anyone's gender. Avoid he/she/his/her—prefer 'you' or singular 'they' where needed.",
      "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
      "Use **liberal** natural pauses with inline markers `[[PAUSE xs]]` (e.g. `[[PAUSE 2s]]`, `[[PAUSE 5s]]`): include them **often**—after most sentences or sense-units, at **every** meaningful transition (arrival → practice, shifts in technique or imagery, closing), and wherever a human guide would breathe or let a phrase land—not only at rare dramatic beats.",
      "Place **every** pause **intelligently**: each gap must fit the moment—what was just said, the emotional or somatic weight, the transition, and what comes next. Pauses are not filler; avoid random, uniform, or excessive markers that would break rhythm or feel mechanical.",
      "Vary pause lengths by context: **short** bridges can be ~1s–2s when momentum matters; **typical** gaps between lines are often **2s–4s**; use **4s–8s** (sometimes longer) after heavier invitations, imagery, or emotional lines. Default toward **longer and slightly more frequent** silence than a dense script—still never gratuitous.",
      "When the listener follows in their own time—breath or body at their own pace, counting breaths or steps themselves, slow body scan, open-ended visualization, or resting in silence—**intelligently** add **extra** time so the voice does not crowd them: longer gaps where the invitation truly needs room (often **4s–12s**, sometimes more), sometimes several markers in a row when one sustained silence fits; never rush the next line while they are meant to be practising alone, and never stack long silence where the script does not call for it.",
      "Place pause markers on their own or immediately after a sentence, never splitting words.",
      "Important formatting constraints:",
      "1) Do NOT output any title, heading, or preamble of any kind.",
      "2) The very first spoken content must start immediately (first non-whitespace characters must be the guide's words).",
      "3) Do NOT start the script with a pause marker like [[PAUSE 1s]]; only include pauses after speaking has begun.",
      "Output **only** the words the guide speaks and these [[PAUSE xs]] markers; do not output other markdown or commentary.",
      scriptDurationPlanningAppendix(meditationTargetMinutes, { speechSpeed }),
    ].join("\n");

    system = [
      "You are an expert meditation scriptwriter for medimade.io.",
      "You write speakable, production-ready guided meditation scripts.",
      "Avoid self-referential product mentions. Do NOT mention Medimade/the app/this platform unless the user explicitly asks. If you must refer to it, use exactly: 'medimade.io' (lowercase) and nothing else.",
      "If the user is joking or playful, it is OK to include whimsical / funny subject matter (e.g. a monkey eating ice cream on a volcano) BUT the meditation itself should remain genuinely calming, coherent, and high-quality—never 'silly writing' or comedy bits. Use playful imagery as a vehicle for grounding, breath, and emotional regulation.",
      "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the user asks for something socially unacceptable, refuse briefly and offer a safe alternative topic.",
      "You use gender-neutral language and never assume anyone's gender.",
      "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
      "You place pauses **generously and often** for clarity and pacing—especially spacious where self-paced work needs room—while keeping each silence **motivated** (never mechanical fillers).",
    ].join(" ");

    messages = [{ role: "user", content: userContent }];
    maxTokens = 8192;
  } else {
    const meditationStyle =
      typeof body.meditationStyle === "string"
        ? body.meditationStyle.trim()
        : "";
    if (!meditationStyle) {
      writeJsonError(responseStream, 400, {
        error: "Field `meditationStyle` (string) is required",
      });
      return;
    }

    const journalMode = body.journalMode === true;

    const raw = body.messages;
    if (!Array.isArray(raw) || raw.length === 0) {
      writeJsonError(responseStream, 400, {
        error: "Field `messages` (non-empty array) is required",
      });
      return;
    }

    messages = [];
    for (const m of raw) {
      if (
        !m ||
        typeof m !== "object" ||
        (m.role !== "user" && m.role !== "assistant") ||
        typeof m.content !== "string" ||
        !m.content.trim()
      ) {
        writeJsonError(responseStream, 400, {
          error:
            "Each message must be { role: 'user' | 'assistant', content: string }",
        });
        return;
      }
      messages.push({ role: m.role, content: m.content.trim() });
    }

    if (messages[messages.length - 1].role !== "user") {
      writeJsonError(responseStream, 400, {
        error: "Last message must be from the user",
      });
      return;
    }

    system = buildClaudeCoachSystemPrompt({
      meditationStyle,
      journalMode,
      targetMinutes: meditationTargetMinutes,
    });

    maxTokens = 1024;
  }

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      stream: true,
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    writeJsonError(responseStream, upstream.status, {
      error: "Anthropic request failed",
      detail: detail.slice(0, 2000),
    });
    return;
  }

  if (!upstream.body) {
    writeJsonError(responseStream, 502, { error: "Empty body from Anthropic" });
    return;
  }

  const out = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });

  try {
    await pipeAnthropicSseToClient(upstream.body, out);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Stream failed";
    out.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
  } finally {
    out.end();
  }
}

export const handler = awslambda.streamifyResponse(streamHandler);
