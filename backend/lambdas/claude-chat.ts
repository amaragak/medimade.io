import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

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
  };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    writeJsonError(responseStream, 400, { error: "Invalid JSON body" });
    return;
  }

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
    const styleHint = styleForScript
      ? `Preferred meditation style from the creator: "${styleForScript}".`
      : "The creator has not locked a style label yet — infer an appropriate approach from the chat.";

    const userContent = [
      styleHint,
      "",
      "### Conversation between creator and guide (chronological)",
      transcript || "(No messages yet.)",
      "",
      "### Your task",
      "Write the complete guided meditation script that a human guide would read aloud for recording.",
      "Target length: about **5 minutes** at a calm, unhurried speaking pace (roughly 700–950 words).",
      "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
      "Match the emotional tone, intentions, and imagery implied by the conversation.",
      "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
      "Include natural spoken pauses using inline markers of the form [[PAUSE 1s]] or [[PAUSE 2.5s]] between phrases where a human guide would actually pause.",
      "Vary the pause lengths (for example 0.5s, 1s, 2s, 3s) depending on the emotional weight or visualization load; keep them reasonable and never absurdly long.",
      "Place pause markers on their own or immediately after a sentence, never splitting words.",
      "Output **only** the words the guide speaks and these [[PAUSE xs]] markers; do not output other markdown or commentary.",
    ].join("\n");

    system = [
      "You are an expert meditation scriptwriter for medimade.io.",
      "You write speakable, production-ready guided meditation scripts.",
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

    system = [
      "You are a warm, concise meditation coach for medimade.io.",
      `The user chose this meditation style: "${meditationStyle}".`,
      "You are helping them shape a personalized guided meditation that matches their goals and real-world context.",
      "Prioritize questions about what they want from this session (outcomes, situations, intentions) over how it feels in their body.",
      "Only ask about body sensations when the user has invited that kind of focus (for example by mentioning stress in the body or somatic work).",
      "Ask short, caring follow-ups; keep replies brief (a few sentences) unless they ask for depth.",
    ].join(" ");

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
