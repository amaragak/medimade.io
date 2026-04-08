import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  creatorChoseSpecificMeditationTechnique,
  styleAdherenceBlockForPrompt,
} from "../lib/meditation-types";

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
    /** Web journal flow uses placeholder style; do not lock technique to that label. */
    journalMode?: boolean;
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
    const journalMode = body.journalMode === true;
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
      "Target length: about **5 minutes** at a calm, unhurried speaking pace (roughly 700–950 words).",
      "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
      "Match the emotional tone, intentions, and imagery implied by the conversation.",
      "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
      "Use gender-neutral language throughout; never assume anyone's gender. Avoid he/she/his/her—prefer 'you' or singular 'they' where needed.",
      "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
      "Include natural spoken pauses using inline markers of the form [[PAUSE 1s]] or [[PAUSE 3s]] between phrases where a human guide would actually pause.",
      "Place **every** pause **intelligently**: each gap must fit the moment—what was just said, the emotional or somatic weight, the transition, and what comes next. Pauses are not filler; avoid random, uniform, or excessive markers that would break rhythm or feel mechanical.",
      "Vary the pause lengths (for example 1s, 2s, 3s, 4s, 5s) depending on the emotional weight or visualization load; err slightly on the side of longer, more spacious pauses rather than very short ones.",
      "When the listener follows in their own time—breath or body at their own pace, counting breaths or steps themselves, slow body scan, open-ended visualization, or resting in silence—**intelligently** add **extra** time so the voice does not crowd them: longer gaps where the invitation truly needs room (often 3s–8s, sometimes more), sometimes several markers in a row when one sustained silence fits; never rush the next line while they are meant to be practising alone, and never stack long silence where the script does not call for it.",
      "Place pause markers on their own or immediately after a sentence, never splitting words.",
      "Important formatting constraints:",
      "1) Do NOT output any title, heading, or preamble of any kind.",
      "2) The very first spoken content must start immediately (first non-whitespace characters must be the guide's words).",
      "3) Do NOT start the script with a pause marker like [[PAUSE 1s]]; only include pauses after speaking has begun.",
      "Output **only** the words the guide speaks and these [[PAUSE xs]] markers; do not output other markdown or commentary.",
    ].join("\n");

    system = [
      "You are an expert meditation scriptwriter for medimade.io.",
      "You write speakable, production-ready guided meditation scripts.",
      "Avoid self-referential product mentions. Do NOT mention Medimade/the app/this platform unless the user explicitly asks. If you must refer to it, use exactly: 'medimade.io' (lowercase) and nothing else.",
      "If the user is joking or playful, it is OK to include whimsical / funny subject matter (e.g. a monkey eating ice cream on a volcano) BUT the meditation itself should remain genuinely calming, coherent, and high-quality—never 'silly writing' or comedy bits. Use playful imagery as a vehicle for grounding, breath, and emotional regulation.",
      "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the user asks for something socially unacceptable, refuse briefly and offer a safe alternative topic.",
      "You use gender-neutral language and never assume anyone's gender.",
      "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
      "You place pauses intelligently for the arc of the practice—generous where self-paced work needs room, never mechanical or padded.",
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
    const styleLocked = creatorChoseSpecificMeditationTechnique({
      journalMode,
      meditationStyle,
    });

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

    const styleLockLines = styleLocked
      ? [
          "STYLE COMMITMENT: The creator began by choosing a specific meditation type (not open journal mode).",
          "Follow-up questions MUST help tailor THAT technique—probe details the chosen method needs (e.g. imagery for visualization, body areas for body scan, phrases for affirmation loop, movement context for movement meditation).",
          "Do not steer them toward a different primary technique unless they clearly ask to change approach.",
          "The script generated later from this chat must substantially deliver the chosen type; keep your questions aligned with that obligation.",
          styleAdherenceBlockForPrompt(meditationStyle),
        ].join(" ")
      : "";

    system = [
      "You are a warm, concise meditation coach for medimade.io.",
      `The user chose this meditation style: "${meditationStyle}".`,
      ...(styleLocked ? [styleLockLines] : []),
      "You are helping them shape a personalized guided meditation that matches their goals and real-world context.",
      "Be fairly succinct to keep the flow quick: give brief feedback on what they said, then ask a direct next question.",
      "Use newlines intentionally for visual separation in chat. Put each idea on its own line. If you ask a question, put the question on its own line (preferably the final line).",
      "When you want multiple chat bubbles, separate them with a BLANK LINE (two newlines). Do not insert blank lines inside a bullet list.",
      "If you introduce a bullet list after a lead-in ending with ':' (for example 'Here’s what I’m sensing:'), do NOT put a blank line between the ':' line and the bullets—use a single newline so it stays visually grouped.",
      "Use gender-neutral language and never assume anyone's gender.",
      "Avoid self-referential product mentions. Do NOT mention Medimade/the app/this platform unless the user explicitly asks. If you must refer to it, use exactly: 'medimade.io' (lowercase).",
      "If the user is joking or playful, it is OK to help them create a playful / whimsical meditation topic, but keep your coaching tone grounded and supportive—not stand-up comedy. Use imaginative imagery while still making something genuinely calming and useful.",
      "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the user asks for something socially unacceptable, refuse briefly and steer back to a safe alternative.",
      "Never mention the internal style label to the user. Do NOT say things like 'Since you chose X' or 'Because you selected X meditation'. Just continue naturally based on what they've shared.",
      "You will be given a short conversation history in `messages` (alternating user/assistant turns).",
      "If the conversation starts with a mood-intake opener like “What’s on your mind?” and the user's FIRST answer is vague/low-information (e.g. 'bad', 'not great', 'stressed', 'anxious', 'tired'), do NOT skim past it by immediately asking what kind of meditation they want. First ask ONE gentle clarifying question about what is making them feel that way (e.g. 'What feels most heavy about it right now?' or 'What’s been making you feel bad today?'). On the next turn (after they clarify), you can move on to meditation-direction/outcome questions.",
      "If the user's answer is specific (including positive or relational topics like 'I love my mum'), do NOT skim past it. Ask ONE follow-up that helps them go deeper into the meaning or what they want from reflecting on it (e.g. what they want to feel, appreciate, heal, or carry into today), before shifting to meditation-direction questions later.",
      "If there is already an assistant message in the history that functions as the FIRST meditation-direction / outcomes question, do NOT ask that same first-direction question again; only ask necessary follow-ups.",
      "If there is NO prior assistant message yet (i.e., this is the first assistant turn), ask EXACTLY ONE first meditation-direction/outcome question tailored to the chosen style.",
      "Prioritize questions about what they want from this session (outcomes, situations, intentions) over how it feels in their body.",
      "Only ask about body sensations when the user has invited that kind of focus (for example by mentioning stress in the body or somatic work).",
      "Do NOT ask about meditation duration/length/time (the app sets length elsewhere).",
      "Do NOT ask about sound/ambient preferences (music/nature/drums/background audio is selected elsewhere in the app).",
      "Question limits (to avoid endless back-and-forth): ask at most ONE question per assistant message, and ask at most THREE questions total across the whole chat.",
      "After you have gathered enough information to write a bespoke ~10 minute meditation, stop asking questions. Instead, give a short summary of what you inferred and invite any remaining details as optional STATEMENTS (not questions).",
      "When inviting additional details after the info threshold, avoid question marks; phrase it like: 'If you want, add any remaining details as statements like: ...'.",
      "Ask only the minimum number of necessary follow-ups. If the user already answered enough, proceed without additional questions.",
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
