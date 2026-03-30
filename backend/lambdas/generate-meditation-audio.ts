import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const MODEL = "claude-haiku-4-5";

const secrets = new SecretsManagerClient({});
const s3 = new S3Client({});

let cachedClaudeKey: string | undefined;
let cachedFishKey: string | undefined;

// Dev-friendly prompt: shorter output so iteration is fast.
// Default to true unless explicitly set `DEV_MODE=false`.
// (Lambda runtimes often set NODE_ENV=production, but for our "dev mode" we
// still want short scripts unless the deploy explicitly disables it.)
const DEV_MODE =
  process.env.DEV_MODE === undefined
    ? true
    : !["false", "0"].includes(process.env.DEV_MODE);

async function getClaudeApiKey(): Promise<string> {
  if (cachedClaudeKey) return cachedClaudeKey;
  const arn = process.env.CLAUDE_SECRET_ARN;
  if (!arn) throw new Error("CLAUDE_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Claude API key secret is empty");
  cachedClaudeKey = s;
  return cachedClaudeKey;
}

async function getFishApiKey(): Promise<string> {
  if (cachedFishKey) return cachedFishKey;
  const arn = process.env.FISH_AUDIO_SECRET_ARN;
  if (!arn) throw new Error("FISH_AUDIO_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Fish Audio API key secret is empty");
  cachedFishKey = s;
  return cachedFishKey;
}

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

type Role = "user" | "assistant";
type ChatTurn = { role: Role; content: string };

async function generateScriptFromClaude(params: {
  apiKey: string;
  meditationStyle?: string;
  transcript: string;
}): Promise<string> {
  const styleForScript = params.meditationStyle?.trim() ?? "";
  const styleHint = styleForScript
    ? `Preferred meditation style from the creator: "${styleForScript}".`
    : "The creator has not locked a style label yet — infer an appropriate approach from the chat.";

  // Non-dev prompt (kept intact):
  const NON_DEV_USER_CONTENT = [
    styleHint,
    "",
    "### Conversation between creator and guide (chronological)",
    params.transcript?.trim() || "(No messages yet.)",
    "",
    "### Your task",
    "Write the complete guided meditation script that a human guide would read aloud for recording.",
    "Target length: about **5 minutes** at a calm, unhurried speaking pace (roughly 700–950 words).",
    "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
    "Match the emotional tone, intentions, and imagery implied by the conversation.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Output **only** the words the guide speaks (and brief optional [pause] cues if helpful).",
    "Do not add meta-commentary, titles like 'Script:', or markdown formatting unless it is meant to be read aloud.",
  ].join("\n");

  // Dev prompt: generate a shorter (~1 minute) script that still covers the user’s topic,
  // even if generic opening/closing are omitted.
  const DEV_USER_CONTENT = [
    styleHint,
    "",
    "### Conversation between creator and guide (chronological)",
    params.transcript?.trim() || "(No messages yet.)",
    "",
    "### Your task (DEV MODE)",
    "Write a short guided meditation script a human guide would read aloud for recording.",
    "Topic coverage: focus on the topic implied by the most recent creator/guide exchange in the transcript (don’t drift into generic content).",
    "Target length: about **1 minute** at a calm, unhurried speaking pace (roughly 140–220 words).",
    "You may omit the usual generic beginning and ending for now. Skip arrival/closing boilerplate unless it is directly needed to cover the topic.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Output **only** the words the guide speaks (and brief optional [pause] cues if helpful).",
    "Do not add meta-commentary, titles like 'Script:', or markdown formatting unless it is meant to be read aloud.",
  ].join("\n");

  // Choose prompt based on dev flag.
  const userContent = DEV_MODE ? DEV_USER_CONTENT : NON_DEV_USER_CONTENT;

  const system = [
    "You are an expert meditation scriptwriter for medimade.io.",
    "You write speakable, production-ready guided meditation scripts.",
  ].join(" ");

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userContent } satisfies ChatTurn],
    }),
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    return Promise.reject(
      new Error(
        `Anthropic script generation failed: ${responseText.slice(
          0,
          2000,
        )}`,
      ),
    );
  }

  let parsed: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return Promise.reject(new Error("Invalid response from Anthropic"));
  }

  const text = parsed.content?.find((c) => c?.type === "text")?.text?.trim() ?? "";
  if (!text) {
    return Promise.reject(new Error("Empty script returned by Anthropic"));
  }
  return text;
}

async function fishTtsMp3(params: {
  apiKey: string;
  text: string;
  reference_id: string;
}): Promise<Buffer> {
  const maxAttempts = 3;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const upstream = await fetch(FISH_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          model: "s1",
        },
        body: JSON.stringify({
          text: params.text,
          reference_id: params.reference_id,
          format: "mp3",
        }),
      });

      if (!upstream.ok) {
        const detail = await upstream.text();
        const msg = `Fish Audio request failed (attempt ${attempt}, status ${upstream.status}): ${detail.slice(
          0,
          2000,
        )}`;
        lastErr = msg;

        // Retry on transient failures (503/502/504/429).
        if ([429, 502, 503, 504].includes(upstream.status) && attempt < maxAttempts) {
          const backoffMs = 500 * attempt * attempt;
          console.warn("Fish transient failure, retrying", {
            attempt,
            status: upstream.status,
            backoffMs,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        throw new Error(msg);
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      return buf;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      if (attempt < maxAttempts) {
        const backoffMs = 500 * attempt * attempt;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(lastErr ?? "Fish Audio request failed");
}

function sanitizeScriptForTts(markdown: string): string {
  let t = markdown ?? "";
  // Normalize newlines.
  t = t.replace(/\r\n/g, "\n");

  // Strip markdown heading markers like "# Title" (remove only prefix, keep the title).
  t = t.replace(/^\s*#{1,6}\s+/gm, "");

  // Convert bold **text** -> text (single-line only).
  t = t.replace(/\*\*([^\n*]+)\*\*/g, "$1");
  // Convert italics *text* -> text (single-line only).
  t = t.replace(/\*([^\n*]+)\*/g, "$1");

  // Remove any leftover literal delimiters that Fish would otherwise speak.
  t = t.replace(/[*#]/g, "");

  // Cleanup whitespace around lines; keep [pause] cues intact.
  t = t.replace(/[ \t]+\n/g, "\n");
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  console.log("generate-meditation-audio: start", {
    reqMethod: event.requestContext?.http?.method,
    devMode: DEV_MODE,
  });

  let body: {
    transcript?: string;
    meditationStyle?: string;
    scriptText?: string;
    reference_id?: string;
  };
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const referenceId =
    typeof body.reference_id === "string" && body.reference_id.trim()
      ? body.reference_id.trim()
      : "";
  if (!referenceId) {
    return json(400, { error: "`reference_id` (voice model id) is required" });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const meditationStyle =
    typeof body.meditationStyle === "string" ? body.meditationStyle : "";
  const scriptText =
    typeof body.scriptText === "string" ? body.scriptText.trim() : "";

  console.log("inputs", {
    transcriptChars: transcript.length,
    meditationStylePresent: Boolean(meditationStyle?.trim()),
    scriptTextChars: scriptText.length,
    reference_id: referenceId,
  });

  const mediaBucketName = process.env.MEDIA_BUCKET_NAME;
  const mediaCloudFrontDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN;
  if (!mediaBucketName) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });
  if (!mediaCloudFrontDomain)
    return json(500, { error: "MEDIA_CLOUDFRONT_DOMAIN is not set" });

  let scriptTextUsed = scriptText;
  const shouldGenerateScript = !scriptTextUsed;
  try {
    if (shouldGenerateScript) {
      console.log("generating script from Claude", {
        meditationStylePresent: Boolean(meditationStyle?.trim()),
      });
      const claudeKey = await getClaudeApiKey();
      scriptTextUsed = await generateScriptFromClaude({
        apiKey: claudeKey,
        meditationStyle,
        transcript,
      });
      console.log("generated script", {
        chars: scriptTextUsed.length,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Script generation failed";
    console.error("script generation failed", { msg });
    return json(500, { error: msg });
  }

  if (!scriptTextUsed) {
    return json(500, { error: "No script text available to synthesize" });
  }

  let fishKey: string;
  try {
    fishKey = await getFishApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fish secret lookup failed";
    console.error("fish secret lookup failed", { msg });
    return json(500, { error: msg });
  }

  let mp3Buf: Buffer;
  const scriptForTts = sanitizeScriptForTts(scriptTextUsed);
  try {
    console.log("calling Fish TTS", {
      reference_id: referenceId,
      textChars: scriptForTts.length,
    });
    mp3Buf = await fishTtsMp3({
      apiKey: fishKey,
      text: scriptForTts,
      reference_id: referenceId,
    });
    console.log("Fish TTS success", { bytes: mp3Buf.byteLength });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fish TTS failed";
    console.error("Fish TTS failed", { msg });
    return json(500, { error: msg });
  }

  const key = `meditations/${randomUUID()}.mp3`;
  try {
    console.log("putting to S3", { bucket: mediaBucketName, key, bytes: mp3Buf.byteLength });
    await s3.send(
      new PutObjectCommand({
        Bucket: mediaBucketName,
        Key: key,
        Body: mp3Buf,
        ContentType: "audio/mpeg",
        CacheControl: "no-store",
      }),
    );
    console.log("S3 PutObject success", { key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "S3 PutObject failed";
    console.error("S3 PutObject failed", { msg });
    return json(500, { error: msg });
  }

  const audioUrl = `https://${mediaCloudFrontDomain}/${key}`;
  console.log("done", { audioUrl });
  return json(200, { audioUrl, scriptTextUsed, audioKey: key });
}

