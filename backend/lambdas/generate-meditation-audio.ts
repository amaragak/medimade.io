import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { parseBuffer } from "music-metadata";
import { loudnormMp3Buffer } from "../lib/ffmpeg-loudnorm";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const MODEL = "claude-haiku-4-5";
const FISH_TTS_MODEL = (process.env.FISH_TTS_MODEL || "s2-pro").trim() || "s2-pro";

const secrets = new SecretsManagerClient({});
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const execFileAsync = promisify(execFile);

async function voiceFxWavViaS3(params: {
  mp3: Buffer;
  preset: string;
  bucket: string;
  jobId: string;
}): Promise<Buffer> {
  const base = process.env.MEDIMADE_API_URL?.trim().replace(/\/$/, "");
  if (!base) {
    throw new Error("MEDIMADE_API_URL is not set (needed for /audio/voice-fx)");
  }

  const inKey = `tmp/voice-fx/${params.jobId}/in.mp3`;
  const outKey = `tmp/voice-fx/${params.jobId}/out.wav`;

  await s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: inKey,
      Body: params.mp3,
      ContentType: "audio/mpeg",
      CacheControl: "no-store",
    }),
  );

  const res = await fetch(`${base}/audio/voice-fx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bucket: params.bucket,
      s3KeyIn: inKey,
      s3KeyOut: outKey,
      preset: params.preset,
      inputFormat: "mp3",
    }),
  });
  const raw = await res.text();
  let data: { s3KeyOut?: string; error?: string } | null = null;
  try {
    data = JSON.parse(raw) as { s3KeyOut?: string; error?: string };
  } catch {
    data = null;
  }
  if (!res.ok) {
    const detail = data?.error ?? raw.slice(0, 2000);
    throw new Error(`voice-fx HTTP ${res.status}: ${detail}`);
  }

  const fxObj = await s3.send(
    new GetObjectCommand({ Bucket: params.bucket, Key: outKey }),
  );
  return Buffer.from(await fxObj.Body!.transformToByteArray());
}

async function wavToMp3Buffer(wavBuf: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = `/tmp/voice-fx-${id}.wav`;
  const outPath = `/tmp/voice-fx-${id}.mp3`;
  try {
    fs.writeFileSync(inPath, wavBuf);
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      inPath,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    for (const p of [inPath, outPath]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* */
      }
    }
  }
}

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

// Default Fish prosody speed; request may override (dev UI).
const DEFAULT_SPEECH_SPEED = (() => {
  const raw = process.env.SPEECH_SPEED;
  if (!raw) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  // keep within Fish's documented range (0.5–2.0)
  return Math.min(2, Math.max(0.5, n));
})();

function clampSpeechSpeed(n: number): number {
  return Math.min(2, Math.max(0.5, n));
}

async function getMp3DurationSeconds(buf: Buffer): Promise<number | null> {
  try {
    const m = await parseBuffer(buf, { mimeType: "audio/mpeg", size: buf.byteLength });
    const d = m.format.duration;
    if (typeof d === "number" && Number.isFinite(d) && d > 0) return d;
    return null;
  } catch {
    return null;
  }
}

function clampGain(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Mix speech (input 0) with one or more looped background beds.
 * Each layer gain is 0–100; effective ffmpeg volume is 0.4 * (gain/100) per layer
 * (same peak as the legacy single-track bed when gain=100).
 */
async function mixSpeechWithBackgrounds(params: {
  speechBuf: Buffer;
  layers: { key: string; gain: number }[];
  durationSeconds: number | null;
  bucket: string;
}): Promise<Buffer> {
  const layers = params.layers.filter((l) => l.key?.trim());
  if (layers.length === 0) return params.speechBuf;
  if (!process.env.AWS_EXECUTION_ENV) {
    return params.speechBuf;
  }

  try {
    const id = randomUUID();
    const speechPath = `/tmp/speech-${id}.mp3`;
    const outPath = `/tmp/mix-${id}.mp3`;
    const bgPaths: string[] = [];

    fs.writeFileSync(speechPath, params.speechBuf);

    for (let i = 0; i < layers.length; i++) {
      const bgObj = await s3.send(
        new GetObjectCommand({
          Bucket: params.bucket,
          Key: layers[i].key.trim(),
        }),
      );
      const bgBuf = Buffer.from(await bgObj.Body!.transformToByteArray());
      const p = `/tmp/bg-${id}-${i}.mp3`;
      fs.writeFileSync(p, bgBuf);
      bgPaths.push(p);
    }

    const dur =
      params.durationSeconds && params.durationSeconds > 0
        ? params.durationSeconds
        : undefined;

    const fadeOut =
      dur !== undefined && dur > 0.06
        ? `,afade=t=out:st=${Math.max(0, dur - 0.03).toFixed(2)}:d=0.03`
        : "";

    const vols = layers.map((l) => (0.4 * clampGain(l.gain)) / 100);
    const chainParts: string[] = [];
    const bedLabels: string[] = [];

    for (let i = 0; i < layers.length; i++) {
      const inp = i + 1;
      const label = `b${i}`;
      bedLabels.push(`[${label}]`);
      chainParts.push(
        `[${inp}:a]aloop=loop=-1:size=2e+09,afade=t=in:st=0:d=0.03${fadeOut},volume=${vols[i].toFixed(4)}[${label}]`,
      );
    }

    let filter: string;
    if (layers.length === 1) {
      filter = `${chainParts.join(";")};[0:a][b0]amix=inputs=2:duration=first:dropout_transition=0`;
    } else {
      filter = `${chainParts.join(";")};${bedLabels.join("")}amix=inputs=${layers.length}:duration=longest:dropout_transition=0:normalize=1[bed];[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0`;
    }

    const args = ["-y", "-i", speechPath, ...bgPaths.flatMap((p) => ["-i", p]), "-filter_complex", filter];
    if (dur !== undefined) {
      args.push("-t", dur.toFixed(2));
    }
    args.push(outPath);

    await execFileAsync("ffmpeg", args);
    return fs.readFileSync(outPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ffmpeg mix failed";
    console.warn("background mix failed, returning dry speech", { msg });
    return params.speechBuf;
  }
}

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

type ScriptSegment = {
  text: string;
  pauseSeconds: number;
};

function parseScriptIntoSegments(script: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  if (!script) return segments;
  const re = /\[\[PAUSE\s+([0-9]+(?:\.[0-9])?)s?\]\]/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(script)) !== null) {
    const raw = script.slice(lastIndex, match.index);
    const text = raw.trim();
    const pause = parseFloat(match[1] ?? "0");
    if (text) {
      segments.push({
        text,
        pauseSeconds: Number.isFinite(pause) && pause > 0 ? pause : 0,
      });
    }
    lastIndex = match.index + match[0].length;
  }

  const tail = script.slice(lastIndex).trim();
  if (tail) {
    segments.push({ text: tail, pauseSeconds: 0 });
  }

  return segments;
}

async function generateScriptFromClaude(params: {
  apiKey: string;
  meditationStyle?: string;
  transcript: string;
  speechSpeed: number;
}): Promise<string> {
  // Adjust script word targets inversely with speech speed so total duration is similar.
  // If we slow down (speed < 1), reduce words proportionally.
  const wordScale = params.speechSpeed;
  const devWordsMin = Math.round(140 * wordScale);
  const devWordsMax = Math.round(220 * wordScale);
  const nonDevWordsMin = Math.round(700 * wordScale);
  const nonDevWordsMax = Math.round(950 * wordScale);

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
    `Target length: about **5 minutes** at a calm, unhurried speaking pace (roughly ${nonDevWordsMin}–${nonDevWordsMax} words).`,
    "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
    "Match the emotional tone, intentions, and imagery implied by the conversation.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
    "Include natural spoken pauses using inline markers of the form [[PAUSE 1s]] or [[PAUSE 3s]] between phrases where a human guide would actually pause.",
    "Place **every** pause **intelligently**: each gap must fit the moment—what was just said, the emotional or somatic weight, the transition, and what comes next. Pauses are not filler; avoid random, uniform, or excessive markers that would break rhythm or feel mechanical.",
    "Vary the pause lengths (for example 1s, 2s, 3s, 4s, 5s) depending on the emotional weight or visualization load; err slightly on the side of longer, more spacious pauses rather than very short ones.",
    "When the listener follows in their own time—breath or body at their own pace, counting breaths or steps themselves, slow body scan, open-ended visualization, or resting in silence—**intelligently** add **extra** time so the voice does not crowd them: longer gaps where the invitation truly needs room (often 3s–8s, sometimes more), sometimes several markers in a row when one sustained silence fits; never rush the next line while they are meant to be practising alone, and never stack long silence where the script does not call for it.",
    "Place pause markers on their own or immediately after a sentence, never splitting words.",
    "Output **only** the words the guide speaks and these [[PAUSE xs]] markers; do not output other markdown or commentary.",
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
    `Target length: about **1 minute** at a calm, unhurried speaking pace (roughly ${devWordsMin}–${devWordsMax} words).`,
    "You may omit the usual generic beginning and ending for now. Skip arrival/closing boilerplate unless it is directly needed to cover the topic.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
    "Include natural spoken pauses using inline markers of the form [[PAUSE 1s]] or [[PAUSE 3s]] between phrases where a human guide would actually pause.",
    "Place **every** pause **intelligently**: each gap must fit the moment—what was just said, the emotional or somatic weight, the transition, and what comes next. Pauses are not filler; avoid random, uniform, or excessive markers that would break rhythm or feel mechanical.",
    "Vary the pause lengths (for example 1s, 2s, 3s, 4s, 5s) depending on the emotional weight or visualization load; err slightly on the side of longer, more spacious pauses rather than very short ones.",
    "When the listener follows in their own time—breath or body at their own pace, counting breaths or steps themselves, slow body scan, open-ended visualization, or resting in silence—**intelligently** add **extra** time so the voice does not crowd them: longer gaps where the invitation truly needs room (often 3s–8s, sometimes more), sometimes several markers in a row when one sustained silence fits; never rush the next line while they are meant to be practising alone, and never stack long silence where the script does not call for it.",
    "Place pause markers on their own or immediately after a sentence, never splitting words.",
    "Output **only** the words the guide speaks and these [[PAUSE xs]] markers; do not output other markdown or commentary.",
  ].join("\n");

  // Choose prompt based on dev flag.
  const userContent = DEV_MODE ? DEV_USER_CONTENT : NON_DEV_USER_CONTENT;

  const system = [
    "You are an expert meditation scriptwriter for medimade.io.",
    "You write speakable, production-ready guided meditation scripts.",
    "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
    "You place pauses intelligently for the arc of the practice—generous where self-paced work needs room, never mechanical or padded.",
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

/** Keep DynamoDB item under 400 KB (UTF-8 bytes, incl. other attributes). */
const MAX_SCRIPT_BYTES_FOR_LIBRARY = 320_000;

async function deriveLibraryMetadataFromClaude(params: {
  apiKey: string;
  meditationStyle: string;
  transcript: string;
  scriptPreview: string;
}): Promise<{
  title: string;
  meditationType: string;
  description: string;
}> {
  const scriptPreview = params.scriptPreview.slice(0, 1200);
  const userContent = [
    "Infer a concise library title and a meditation category for this generated meditation.",
    "",
    `Creator style label (may be empty): ${params.meditationStyle.trim() || "(none)"}`,
    "",
    "### Planning / chat context",
    params.transcript.trim().slice(0, 2500) || "(none)",
    "",
    "### Beginning of the final spoken script",
    scriptPreview || "(empty)",
    "",
    "Respond with a single JSON object only (no markdown fences):",
    '{"title":"max 10 words, evocative","meditationType":"short label e.g. Sleep, Body scan, Breath-led, Manifestation","description":"200-300 characters, describing what the meditation is like, no quotes, no newlines"}',
  ].join("\n");

  const system =
    "You output only valid JSON objects. No prose, no code fences.";

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      system,
      messages: [{ role: "user", content: userContent } satisfies ChatTurn],
    }),
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(
      `Anthropic metadata failed: ${responseText.slice(0, 500)}`,
    );
  }

  let parsed: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid JSON from Anthropic (metadata)");
  }

  let raw =
    parsed.content?.find((c) => c?.type === "text")?.text?.trim() ?? "";
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let obj: { title?: unknown; meditationType?: unknown };
  try {
    obj = JSON.parse(raw) as {
      title?: unknown;
      meditationType?: unknown;
      description?: unknown;
    };
  } catch {
    throw new Error("Metadata response was not JSON");
  }

  const title =
    typeof obj.title === "string" && obj.title.trim()
      ? obj.title.trim().slice(0, 120)
      : "";
  const meditationType =
    typeof obj.meditationType === "string" && obj.meditationType.trim()
      ? obj.meditationType.trim().slice(0, 80)
      : "";

  let descriptionRaw = "";
  const d = (obj as { description?: unknown }).description;
  if (typeof d === "string") {
    descriptionRaw = d.trim();
  }
  // Normalize whitespace and enforce the length range.
  descriptionRaw = descriptionRaw.replace(/\s+/g, " ");
  if (descriptionRaw.length > 300) {
    descriptionRaw = descriptionRaw.slice(0, 300).trim();
  }
  if (descriptionRaw.length < 200) {
    throw new Error("Missing or too-short description in metadata JSON");
  }

  if (!title || !meditationType) {
    throw new Error("Missing title or meditationType in metadata JSON");
  }

  return { title, meditationType, description: descriptionRaw };
}

function fallbackLibraryMetadata(params: {
  meditationStyle: string;
}): { title: string; meditationType: string; description: string } {
  const style = params.meditationStyle.trim();
  const type = style || "Meditation";
  const title = style
    ? `${style} · session`
    : "Guided meditation";

  const base =
    style
      ? `A ${style} session with gentle guidance to help you soften tension, steady your breath, and reconnect with calm. Expect slow pacing, soothing reminders, and a grounded end-state you can carry into your day.`
      : "A guided meditation designed to calm your mind and support relaxation. Expect gentle pacing, slow breath cues, and reassuring prompts that help you release tension and return to the present moment.";

  let description = base.replace(/\s+/g, " ").trim();
  if (description.length > 300) description = description.slice(0, 300).trim();
  if (description.length < 200) {
    description = `${description} Let the experience settle in. Breathe, notice, and relax.`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
  }

  return { title, meditationType: type, description };
}

async function fishTtsMp3(params: {
  apiKey: string;
  text: string;
  reference_id: string;
  speed: number;
}): Promise<Buffer> {
  const maxAttempts = 5;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const upstream = await fetch(FISH_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          model: FISH_TTS_MODEL,
        },
        body: JSON.stringify({
          text: params.text,
          reference_id: params.reference_id,
          format: "mp3",
          latency: "normal",
          normalize: true,
          prosody: { speed: params.speed, normalize_loudness: true },
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
          const retryAfter = upstream.headers.get("retry-after");
          const retryAfterMs = retryAfter ? Number(retryAfter) * 1000 : NaN;
          const backoffMsBase = Number.isFinite(retryAfterMs) ? retryAfterMs : 750 * attempt * attempt;
          const backoffMs = Math.min(15_000, Math.max(250, backoffMsBase)) + Math.floor(Math.random() * 250);
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
        const backoffMs = Math.min(15_000, 750 * attempt * attempt) + Math.floor(Math.random() * 250);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }

  throw new Error(lastErr ?? "Fish Audio request failed");
}

async function synthesizeScriptWithPauses(params: {
  apiKey: string;
  script: string;
  reference_id: string;
  speed: number;
}): Promise<{ audio: Buffer; utf8Bytes: number }> {
  const segments = parseScriptIntoSegments(params.script);
  if (segments.length === 0) {
    const clean = sanitizeScriptForTts(params.script);
    const audio = await fishTtsMp3({
      apiKey: params.apiKey,
      text: clean,
      reference_id: params.reference_id,
      speed: params.speed,
    });
    return { audio, utf8Bytes: Buffer.byteLength(clean, "utf8") };
  }

  const id = randomUUID();
  const files: string[] = [];
  let totalBytes = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const clean = sanitizeScriptForTts(seg.text);
    if (!clean) continue;
    totalBytes += Buffer.byteLength(clean, "utf8");

    const segBuf = await fishTtsMp3({
      apiKey: params.apiKey,
      text: clean,
      reference_id: params.reference_id,
      speed: params.speed,
    });
    const segPath = `/tmp/seg-${id}-${i}.mp3`;
    fs.writeFileSync(segPath, segBuf);
    files.push(segPath);

    if (seg.pauseSeconds > 0) {
      const pausePath = `/tmp/pause-${id}-${i}.mp3`;
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=mono:sample_rate=44100",
        "-t",
        seg.pauseSeconds.toFixed(2),
        "-q:a",
        "9",
        "-acodec",
        "libmp3lame",
        pausePath,
      ]);
      files.push(pausePath);
    }
  }

  if (files.length === 0) {
    const clean = sanitizeScriptForTts(params.script);
    const audio = await fishTtsMp3({
      apiKey: params.apiKey,
      text: clean,
      reference_id: params.reference_id,
      speed: params.speed,
    });
    return { audio, utf8Bytes: Buffer.byteLength(clean, "utf8") };
  }

  if (files.length === 1) {
    const only = fs.readFileSync(files[0]);
    return { audio: only, utf8Bytes: totalBytes };
  }

  const listPath = `/tmp/concat-${id}.txt`;
  fs.writeFileSync(
    listPath,
    files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  const outPath = `/tmp/concat-out-${id}.mp3`;

  await execFileAsync("ffmpeg", [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    outPath,
  ]);

  const outBuf = fs.readFileSync(outPath);
  return { audio: outBuf, utf8Bytes: totalBytes };
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

type JobBody = {
  jobId: string;
  transcript?: string;
  meditationStyle?: string;
  scriptText?: string;
  referenceId: string;
  speedOverride?: number;
  backgroundSoundKey?: string;
};

async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  const jobsTableName = process.env.MEDITATION_JOBS_TABLE_NAME;
  if (!jobsTableName) return;
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: jobsTableName,
        Key: { jobId },
        UpdateExpression:
          "SET #status = :s, errorMessage = :e, updatedAt = :u",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":s": "failed",
          ":e": errorMessage,
          ":u": new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "job failure update failed";
    console.warn("markJobFailed update failed", { jobId, msg });
  }
}

export async function handler(event: JobBody): Promise<APIGatewayProxyStructuredResultV2> {
  console.log("meditation-audio worker start", { jobId: event.jobId, devMode: DEV_MODE });

  const jobsTableName = process.env.MEDITATION_JOBS_TABLE_NAME;
  const mediaBucketName = process.env.MEDIA_BUCKET_NAME;
  const mediaCloudFrontDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN;
  const analyticsTableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  if (!jobsTableName || !mediaBucketName || !mediaCloudFrontDomain || !analyticsTableName) {
    console.error("Missing required environment");
    return json(500, { error: "Worker not configured" });
  }

  // Load full job record from Dynamo so the worker doesn't depend on the invoke payload.
  type JobItem = {
    jobId: string;
    transcript?: string;
    meditationStyle?: string;
    scriptText?: string;
    referenceId?: string;
    speed?: number;
    voiceFxPreset?: string;
    backgroundSoundKey?: string;
    backgroundNatureKey?: string;
    backgroundMusicKey?: string;
    backgroundDrumsKey?: string;
    backgroundNatureGain?: number;
    backgroundMusicGain?: number;
    backgroundDrumsGain?: number;
  };

  let jobItem: JobItem | null = null;
  try {
    const out = await ddb.send(
      new GetCommand({
        TableName: jobsTableName,
        Key: { jobId: event.jobId },
      }),
    );
    jobItem = (out.Item as JobItem) ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "job lookup failed";
    console.error("job lookup failed", { jobId: event.jobId, msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  if (!jobItem) {
    const msg = "Job not found";
    console.error("job missing", { jobId: event.jobId });
    await markJobFailed(event.jobId, msg);
    return json(404, { error: msg });
  }

  const body: {
    transcript?: string;
    meditationStyle?: string;
    scriptText?: string;
    reference_id?: string;
    speed?: number;
    voiceFxPreset?: string;
    backgroundSoundKey?: string;
    backgroundNatureKey?: string;
    backgroundMusicKey?: string;
    backgroundDrumsKey?: string;
    backgroundNatureGain?: number;
    backgroundMusicGain?: number;
    backgroundDrumsGain?: number;
  } = {
    transcript: jobItem.transcript,
    meditationStyle: jobItem.meditationStyle,
    scriptText: jobItem.scriptText,
    reference_id: jobItem.referenceId,
    speed: jobItem.speed,
    voiceFxPreset: jobItem.voiceFxPreset,
    backgroundSoundKey: jobItem.backgroundSoundKey,
    backgroundNatureKey: jobItem.backgroundNatureKey,
    backgroundMusicKey: jobItem.backgroundMusicKey,
    backgroundDrumsKey: jobItem.backgroundDrumsKey,
    backgroundNatureGain: jobItem.backgroundNatureGain,
    backgroundMusicGain: jobItem.backgroundMusicGain,
    backgroundDrumsGain: jobItem.backgroundDrumsGain,
  };

  const referenceId =
    typeof body.reference_id === "string" && body.reference_id.trim()
      ? body.reference_id.trim()
      : "";
  if (!referenceId) {
    const msg = "`reference_id` (voice model id) is required";
    console.error("job missing referenceId", { jobId: event.jobId });
    await markJobFailed(event.jobId, msg);
    return json(400, { error: msg });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const meditationStyle =
    typeof body.meditationStyle === "string" ? body.meditationStyle : "";
  const scriptText =
    typeof body.scriptText === "string" ? body.scriptText.trim() : "";
  const speedOverrideRaw = (body as { speed?: unknown })?.speed;
  const speedOverride =
    typeof speedOverrideRaw === "number" && Number.isFinite(speedOverrideRaw)
      ? clampSpeechSpeed(speedOverrideRaw)
      : undefined;
  const speechSpeed = speedOverride ?? DEFAULT_SPEECH_SPEED;
  const voiceFxPreset =
    typeof body.voiceFxPreset === "string" && body.voiceFxPreset.trim().length > 0
      ? body.voiceFxPreset.trim()
      : "";
  const backgroundSoundKey =
    typeof body.backgroundSoundKey === "string" &&
    body.backgroundSoundKey.trim().length > 0
      ? body.backgroundSoundKey.trim()
      : "";

  const trimKey = (k: unknown) =>
    typeof k === "string" && k.trim().length > 0 ? k.trim() : "";

  const layeredBackground: { key: string; gain: number }[] = [];
  const nk = trimKey(body.backgroundNatureKey);
  if (nk) {
    layeredBackground.push({
      key: nk,
      gain: clampGain(
        typeof body.backgroundNatureGain === "number"
          ? body.backgroundNatureGain
          : 80,
      ),
    });
  }
  const mk = trimKey(body.backgroundMusicKey);
  if (mk) {
    layeredBackground.push({
      key: mk,
      gain: clampGain(
        typeof body.backgroundMusicGain === "number"
          ? body.backgroundMusicGain
          : 70,
      ),
    });
  }
  const dk = trimKey(body.backgroundDrumsKey);
  if (dk) {
    layeredBackground.push({
      key: dk,
      gain: clampGain(
        typeof body.backgroundDrumsGain === "number"
          ? body.backgroundDrumsGain
          : 55,
      ),
    });
  }

  const backgroundLayers =
    layeredBackground.length > 0
      ? layeredBackground
      : backgroundSoundKey
        ? [{ key: backgroundSoundKey, gain: 100 }]
        : [];

  console.log("inputs", {
    transcriptChars: transcript.length,
    meditationStylePresent: Boolean(meditationStyle?.trim()),
    scriptTextChars: scriptText.length,
    reference_id: referenceId,
    speechSpeed,
    speedWasOverridden: speedOverride !== undefined,
    backgroundLayerCount: backgroundLayers.length,
  });


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
        speechSpeed,
      });
      console.log("generated script", {
        chars: scriptTextUsed.length,
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Script generation failed";
    console.error("script generation failed", { msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  if (!scriptTextUsed) {
    return json(500, { error: "No script text available to synthesize" });
  }

  // Persist script early so the Library placeholder can show title/description before audio finishes.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: jobsTableName,
        Key: { jobId: event.jobId },
        UpdateExpression:
          "SET #status = :s, scriptTextUsed = :t, updatedAt = :u REMOVE errorMessage",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":s": "running",
          ":t": scriptTextUsed,
          ":u": new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "job early script update failed";
    console.warn("job early script update failed", { jobId: event.jobId, msg });
  }

  // Derive library metadata as early as possible (script is ready; audio may take much longer).
  // This is best-effort and must not fail the job.
  let libraryTitle: string;
  let libraryMeditationType: string;
  let libraryDescription: string;
  try {
    const claudeKey = await getClaudeApiKey();
    const derived = await deriveLibraryMetadataFromClaude({
      apiKey: claudeKey,
      meditationStyle,
      transcript,
      scriptPreview: scriptTextUsed,
    });
    libraryTitle = derived.title;
    libraryMeditationType = derived.meditationType;
    libraryDescription = derived.description;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "metadata derive failed";
    console.warn("early library metadata derive failed, using fallback", { msg });
    const fb = fallbackLibraryMetadata({ meditationStyle });
    libraryTitle = fb.title;
    libraryMeditationType = fb.meditationType;
    libraryDescription = fb.description;
  }

  // Persist derived metadata early so the Library placeholder can populate quickly.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: jobsTableName,
        Key: { jobId: event.jobId },
        UpdateExpression: "SET title = :title, description = :desc, updatedAt = :u",
        ExpressionAttributeValues: {
          ":title": libraryTitle,
          ":desc": libraryDescription,
          ":u": new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "job metadata update failed";
    console.warn("job metadata update failed", { jobId: event.jobId, msg });
  }

  let fishKey: string;
  try {
    fishKey = await getFishApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fish secret lookup failed";
    console.error("fish secret lookup failed", { msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  let mp3Buf: Buffer;
  let scriptUtf8Bytes = 0;
  try {
    console.log("calling Fish TTS with pause-aware synthesis", {
      reference_id: referenceId,
    });
    const { audio, utf8Bytes } = await synthesizeScriptWithPauses({
      apiKey: fishKey,
      script: scriptTextUsed,
      reference_id: referenceId,
      speed: speechSpeed,
    });
    mp3Buf = audio;
    scriptUtf8Bytes = utf8Bytes;
    console.log("Fish TTS success", { bytes: mp3Buf.byteLength });
    try {
      mp3Buf = await loudnormMp3Buffer(mp3Buf);
      console.log("loudnorm -16 LUFS applied to speech", {
        bytes: mp3Buf.byteLength,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "loudnorm failed";
      console.error("loudnorm failed", { msg });
      await markJobFailed(event.jobId, msg);
      return json(500, { error: msg });
    }

    // Optional Pedalboard voice FX (triggered by UI). Requirement: FX runs AFTER loudnorm.
    if (voiceFxPreset) {
      try {
        const fxWav = await voiceFxWavViaS3({
          mp3: mp3Buf,
          preset: voiceFxPreset,
          bucket: mediaBucketName,
          jobId: event.jobId,
        });
        mp3Buf = await wavToMp3Buffer(fxWav);
        console.log("voice-fx applied", { preset: voiceFxPreset, bytes: mp3Buf.byteLength });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "voice-fx failed";
        console.error("voice-fx failed", { msg });
        await markJobFailed(event.jobId, msg);
        return json(500, { error: msg });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fish TTS failed";
    console.error("Fish TTS failed", { msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  const key = `meditations/${randomUUID()}.mp3`;
  const durationSeconds = await getMp3DurationSeconds(mp3Buf);

  if (backgroundLayers.length > 0) {
    mp3Buf = await mixSpeechWithBackgrounds({
      speechBuf: mp3Buf,
      layers: backgroundLayers,
      durationSeconds,
      bucket: mediaBucketName,
    });
  }

  // Final loudness normalization for the actual delivered meditation MP3.
  // This keeps the user-facing output consistently loud even after FX and/or bed mixing.
  try {
    mp3Buf = await loudnormMp3Buffer(mp3Buf);
    console.log("loudnorm -16 LUFS applied to final output", { bytes: mp3Buf.byteLength });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "final loudnorm failed";
    console.error("final loudnorm failed", { msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

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
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  const audioUrl = `https://${mediaCloudFrontDomain}/${key}`;
  console.log("done", { audioUrl });

  let scriptForLibrary = scriptTextUsed;
  let scriptTruncated = false;
  while (
    Buffer.byteLength(scriptForLibrary, "utf8") > MAX_SCRIPT_BYTES_FOR_LIBRARY &&
    scriptForLibrary.length > 0
  ) {
    scriptForLibrary = scriptForLibrary.slice(
      0,
      Math.floor(scriptForLibrary.length * 0.9),
    );
    scriptTruncated = true;
  }

  // Library metadata was already derived above (best-effort) so the Library can show it early.

  // Best-effort analytics / library index write (don’t fail the main job if this fails).
  try {
    const createdAt = new Date().toISOString();
    const id = randomUUID();
    await ddb.send(
      new PutCommand({
        TableName: analyticsTableName,
        Item: {
          pk: "meditation",
          sk: `${createdAt}#${id}`,
          id,
          createdAt,
          s3Key: key,
          audioUrl,
          mp3Bytes: mp3Buf.byteLength,
          durationSeconds: durationSeconds ?? null,
          scriptUtf8Bytes,
          speechSpeed,
          referenceId,
          meditationStyle: meditationStyle || null,
          scriptWasGenerated: shouldGenerateScript,
          title: libraryTitle,
          meditationType: libraryMeditationType,
          description: libraryDescription,
          scriptText: scriptForLibrary,
          scriptTruncated,
          rating: null,
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "analytics write failed";
    console.warn("analytics write failed", { msg });
  }

  // Update job record.
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: jobsTableName,
        Key: { jobId: event.jobId },
        UpdateExpression:
          "SET #status = :s, audioUrl = :a, scriptTextUsed = :t, audioKey = :k, updatedAt = :u",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":s": "completed",
          ":a": audioUrl,
          ":t": scriptTextUsed,
          ":k": key,
          ":u": new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "job update failed";
    console.warn("job update failed", { msg });
  }

  return json(200, { audioUrl, scriptTextUsed, audioKey: key });
}

