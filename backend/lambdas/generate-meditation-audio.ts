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

async function mixSpeechWithBackground(params: {
  speechBuf: Buffer;
  backgroundKey: string;
  durationSeconds: number | null;
  bucket: string;
}): Promise<Buffer> {
  if (!params.backgroundKey) return params.speechBuf;
  if (!process.env.AWS_EXECUTION_ENV) {
    // Likely running locally without ffmpeg in PATH; skip mixing.
    return params.speechBuf;
  }

  try {
    const bgObj = await s3.send(
      new GetObjectCommand({
        Bucket: params.bucket,
        Key: params.backgroundKey,
      }),
    );
    const bgBuf = Buffer.from(await bgObj.Body!.transformToByteArray());

    const id = randomUUID();
    const speechPath = `/tmp/speech-${id}.mp3`;
    const bgPath = `/tmp/bg-${id}.mp3`;
    const outPath = `/tmp/mix-${id}.mp3`;

    fs.writeFileSync(speechPath, params.speechBuf);
    fs.writeFileSync(bgPath, bgBuf);

    const dur = params.durationSeconds && params.durationSeconds > 0
      ? params.durationSeconds
      : undefined;

    const fadeOut =
      dur !== undefined && dur > 0.06
        ? `,afade=t=out:st=${Math.max(0, dur - 0.03).toFixed(2)}:d=0.03`
        : "";
    // Background: looped, quick fade in/out, modestly lower volume.
    const bgChain =
      `[1:a]aloop=loop=-1:size=2e+09,` +
      `afade=t=in:st=0:d=0.03${fadeOut},` +
      `volume=0.4[bg]`;
    // Mix: keep speech as input 0 (dry or sox-processed), background as low bed.
    const filter = `${bgChain};[0:a][bg]amix=inputs=2:duration=first:dropout_transition=0`;

    const args = [
      "-y",
      "-i",
      speechPath,
      "-i",
      bgPath,
      "-filter_complex",
      filter,
    ];
    if (dur !== undefined) {
      args.push("-t", dur.toFixed(2));
    }
    args.push(outPath);

    await execFileAsync("ffmpeg", args);
    const mixed = fs.readFileSync(outPath);
    return mixed;
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
    "Include natural spoken pauses using inline markers of the form [[PAUSE 1s]] or [[PAUSE 2.5s]] between phrases where a human guide would actually pause.",
    "Vary the pause lengths (for example 0.5s, 1s, 2s, 3s) depending on the emotional weight or visualization load; keep them reasonable and never absurdly long.",
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
    "Include natural spoken pauses using inline markers of the form [[PAUSE 1s]] or [[PAUSE 2.5s]] between phrases where a human guide would actually pause.",
    "Vary the pause lengths (for example 0.5s, 1s, 2s, 3s) depending on the emotional weight or visualization load; keep them reasonable and never absurdly long.",
    "Place pause markers on their own or immediately after a sentence, never splitting words.",
    "Output **only** the words the guide speaks and these [[PAUSE xs]] markers; do not output other markdown or commentary.",
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
          latency: "balanced",
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
    backgroundSoundKey?: string;
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
    backgroundSoundKey?: string;
  } = {
    transcript: jobItem.transcript,
    meditationStyle: jobItem.meditationStyle,
    scriptText: jobItem.scriptText,
    reference_id: jobItem.referenceId,
    speed: jobItem.speed,
    backgroundSoundKey: jobItem.backgroundSoundKey,
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
  const backgroundSoundKey =
    typeof body.backgroundSoundKey === "string" &&
    body.backgroundSoundKey.trim().length > 0
      ? body.backgroundSoundKey.trim()
      : "";

  console.log("inputs", {
    transcriptChars: transcript.length,
    meditationStylePresent: Boolean(meditationStyle?.trim()),
    scriptTextChars: scriptText.length,
    reference_id: referenceId,
    speechSpeed,
    speedWasOverridden: speedOverride !== undefined,
    backgroundSoundKeyPresent: Boolean(backgroundSoundKey),
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fish TTS failed";
    console.error("Fish TTS failed", { msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  const key = `meditations/${randomUUID()}.mp3`;
  const durationSeconds = await getMp3DurationSeconds(mp3Buf);

  if (backgroundSoundKey) {
    mp3Buf = await mixSpeechWithBackground({
      speechBuf: mp3Buf,
      backgroundKey: backgroundSoundKey,
      durationSeconds,
      bucket: mediaBucketName,
    });
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

  // Best-effort analytics write (don’t fail the main job if analytics fails).
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

