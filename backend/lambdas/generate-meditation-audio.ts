import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { siblingOpusKey } from "../lib/background-audio-keys";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { parseBuffer } from "music-metadata";
import { loudnormMp3Buffer } from "../lib/ffmpeg-loudnorm";
import {
  type KnownMeditationType,
  creatorChoseSpecificMeditationTechnique,
  inferPresetTypeFromScriptHeuristic,
  knownMeditationTypesJsonArrayBlock,
  normalizeMeditationType,
  styleAdherenceBlockForPrompt,
} from "../lib/meditation-types";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";
import {
  GLOBAL_MEDITATION_USER_ID,
  meditationUserPk,
} from "../lib/meditation-user-pk";
import { coerceClaudeModel, parseAnthropicMessageUsage } from "../lib/anthropic-pricing";
import { coerceMeditationTargetMinutes } from "../lib/meditation-target-minutes";
import { estimateCoachChatTokensFromTranscript } from "../lib/claude-coach-chat-estimate";
import { orpheusTtsWav } from "../lib/orpheus-tts-client";
import {
  normalizeTtsProvider,
  type TtsProvider,
} from "../lib/orpheus-voices";
import {
  getFleetScriptWordTargets,
  scriptDurationPlanningAppendix,
} from "../lib/script-duration-planning-prompt";
import {
  parseScriptIntoSegments,
  SCRIPT_PAUSE_PROMPT_RULES,
  stripPauseMarkers as spokenPlainWithoutPauses,
  sumPauseMarkerSeconds,
} from "../lib/script-pause-bands";
import { loadPauseBandSeconds } from "../lib/voice-admin";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_TTS_MODEL =
  (process.env.FISH_TTS_MODEL || "s2.1-pro-free").trim() || "s2.1-pro-free";

/** Allowlisted Fish models for the create-audio quality toggle. */
function normalizeFishTtsModel(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (s === "s1") return "s1";
  // UI “s2.1-pro” maps to the free tier already configured in prod.
  if (s === "s2.1-pro" || s === "s2.1-pro-free" || s === "") {
    return FISH_TTS_MODEL.includes("s2.1") ? FISH_TTS_MODEL : "s2.1-pro-free";
  }
  return FISH_TTS_MODEL;
}
/** Stretch named-band silence slightly at render (1 = as written). */
const PAUSE_RENDER_SCALE = 1.12;

/** Per speech-section + pipeline phase timings (dev flyover / analytics). */
export type GenerationSectionTiming = {
  i: number;
  ttsMs: number;
  fxMs?: number;
  /** Worker-side ffmpeg inside fxMs: loudnorm + the two format conversions. */
  fxFfmpegMs?: number;
  /** S3 put + VoiceFx invoke + S3 get, i.e. fxMs minus the local ffmpeg work. */
  fxInvokeMs?: number;
  /** Pedalboard's own processing, as reported by the FX Lambda. */
  fxBoardMs?: number;
  /** True when that section's FX Lambda had to start a fresh container. */
  fxColdStart?: boolean;
  utf8Bytes?: number;
  pauseSec?: number;
};

export type GenerationPhaseTimings = {
  scriptMs?: number;
  metadataMs?: number;
  concatMs?: number;
  /** Single FX pass over the assembled track: loudnorm + Pedalboard. */
  fxMs?: number;
  /** Worker-side ffmpeg inside fxMs: loudnorm + the two format conversions. */
  fxFfmpegMs?: number;
  /** S3 put + VoiceFx invoke + S3 get, i.e. fxMs minus the local ffmpeg work. */
  fxInvokeMs?: number;
  /** Pedalboard's own processing, as reported by the FX Lambda. */
  fxBoardMs?: number;
  /** True when the FX Lambda had to start a fresh container. */
  fxColdStart?: boolean;
  loudnormMs?: number;
  uploadMs?: number;
};

export type GenerationTimings = {
  phases: GenerationPhaseTimings;
  sections: GenerationSectionTiming[];
};

function elapsedMs(start: number): number {
  return Math.max(0, Date.now() - start);
}

const secrets = new SecretsManagerClient({});
const s3 = new S3Client({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const lambdaClient = new LambdaClient({});
const execFileAsync = promisify(execFile);

async function voiceFxWavViaS3(params: {
  /** Prefers WAV — Pedalboard MP3-from-buffer often truncates mid-phrase. */
  audio: Buffer;
  inputFormat: "wav" | "mp3";
  preset: string;
  bucket: string;
  jobId: string;
  /** Mixer reverb pad; omit for the preset default (2s). */
  tailPadSeconds?: number;
}): Promise<{
  wav: Buffer;
  /** Split of the round trip, plus whatever the FX Lambda reported about itself. */
  timings: {
    s3PutMs: number;
    invokeMs: number;
    s3GetMs: number;
    lambda?: Record<string, number>;
    coldStart?: boolean;
  };
}> {
  // Worker fans out one VoiceFx Lambda per section (IAM invoke). HTTP remains for
  // short preview/sample scripts that only have MEDIMADE_API_URL.
  const functionName = process.env.VOICE_FX_FUNCTION_NAME?.trim();
  const apiBase = process.env.MEDIMADE_API_URL?.trim().replace(/\/$/, "");
  if (!functionName && !apiBase) {
    throw new Error(
      "VOICE_FX_FUNCTION_NAME or MEDIMADE_API_URL is required for voice-fx",
    );
  }

  const ext = params.inputFormat === "wav" ? "wav" : "mp3";
  const inKey = `tmp/voice-fx/${params.jobId}/in.${ext}`;
  const outKey = `tmp/voice-fx/${params.jobId}/out.wav`;
  const requestBody: Record<string, unknown> = {
    bucket: params.bucket,
    s3KeyIn: inKey,
    s3KeyOut: outKey,
    preset: params.preset,
    inputFormat: params.inputFormat,
  };
  if (params.tailPadSeconds !== undefined) {
    requestBody.tailPadSeconds = params.tailPadSeconds;
  }

  const putStarted = Date.now();
  await s3.send(
    new PutObjectCommand({
      Bucket: params.bucket,
      Key: inKey,
      Body: params.audio,
      ContentType: params.inputFormat === "wav" ? "audio/wav" : "audio/mpeg",
      CacheControl: "no-store",
    }),
  );
  const s3PutMs = elapsedMs(putStarted);

  let statusCode = 0;
  let responseBody = "";
  const invokeStarted = Date.now();

  if (functionName) {
    // RequestResponse: each call is its own concurrent VoiceFx execution; the
    // master awaits all section promises together (true fan-out, not Event
    // invoke — Event cannot return errors/results to the caller).
    const invoke = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: "RequestResponse",
        Payload: Buffer.from(
          JSON.stringify({
            body: JSON.stringify(requestBody),
          }),
        ),
      }),
    );
    const rawPayload = invoke.Payload
      ? Buffer.from(invoke.Payload).toString("utf8")
      : "";
    if (invoke.FunctionError) {
      throw new Error(
        `voice-fx Lambda ${invoke.FunctionError}: ${rawPayload.slice(0, 2000)}`,
      );
    }
    let parsed: { statusCode?: number; body?: string } | null = null;
    try {
      parsed = JSON.parse(rawPayload) as { statusCode?: number; body?: string };
    } catch {
      throw new Error(
        `voice-fx Lambda returned non-JSON: ${rawPayload.slice(0, 2000)}`,
      );
    }
    statusCode = Number(parsed.statusCode ?? 500);
    responseBody =
      typeof parsed.body === "string" ? parsed.body : rawPayload;
  } else {
    const res = await fetch(`${apiBase}/audio/voice-fx`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    statusCode = res.status;
    responseBody = await res.text();
  }
  const invokeMs = elapsedMs(invokeStarted);

  type VoiceFxResponse = {
    s3KeyOut?: string;
    error?: string;
    timingsMs?: Record<string, number>;
    coldStart?: boolean;
  };
  let data: VoiceFxResponse | null = null;
  try {
    data = JSON.parse(responseBody) as VoiceFxResponse;
  } catch {
    data = null;
  }
  if (statusCode < 200 || statusCode >= 300) {
    const detail = data?.error ?? responseBody.slice(0, 2000);
    throw new Error(`voice-fx failed (${statusCode}): ${detail}`);
  }

  const getStarted = Date.now();
  const fxObj = await s3.send(
    new GetObjectCommand({ Bucket: params.bucket, Key: outKey }),
  );
  const wav = Buffer.from(await fxObj.Body!.transformToByteArray());
  return {
    wav,
    timings: {
      s3PutMs,
      invokeMs,
      s3GetMs: elapsedMs(getStarted),
      lambda: data?.timingsMs,
      coldStart: data?.coldStart,
    },
  };
}

async function mp3ToWavBuffer(mp3Buf: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inPath = `/tmp/mp3wav-in-${id}.mp3`;
  const outPath = `/tmp/mp3wav-out-${id}.wav`;
  try {
    fs.writeFileSync(inPath, mp3Buf);
    // Match pause-segment format so concat stays coherent after per-section FX.
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-i",
      inPath,
      "-ac",
      "1",
      "-ar",
      "44100",
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

async function loudnormThenVoiceFxMp3(params: {
  mp3: Buffer;
  preset: string;
  bucket: string;
  jobId: string;
  tailPadSeconds?: number;
}): Promise<{
  mp3: Buffer;
  ms: number;
  split: Pick<
    GenerationSectionTiming,
    "fxFfmpegMs" | "fxInvokeMs" | "fxBoardMs" | "fxColdStart"
  >;
}> {
  const started = Date.now();
  const loudStarted = Date.now();
  const loud = await loudnormMp3Buffer(params.mp3);
  const loudnormMs = elapsedMs(loudStarted);
  // Decode with ffmpeg first — Pedalboard MP3 decode was clipping phrases short.
  const toWavStarted = Date.now();
  const wavIn = await mp3ToWavBuffer(loud);
  const mp3ToWavMs = elapsedMs(toWavStarted);
  const fx = await voiceFxWavViaS3({
    audio: wavIn,
    inputFormat: "wav",
    preset: params.preset,
    bucket: params.bucket,
    jobId: params.jobId,
    tailPadSeconds: params.tailPadSeconds,
  });
  const toMp3Started = Date.now();
  const mp3 = await wavToMp3Buffer(fx.wav);
  const wavToMp3Ms = elapsedMs(toMp3Started);
  const split = {
    fxFfmpegMs: loudnormMs + mp3ToWavMs + wavToMp3Ms,
    fxInvokeMs:
      fx.timings.s3PutMs + fx.timings.invokeMs + fx.timings.s3GetMs,
    ...(fx.timings.lambda?.boardProcessMs != null
      ? { fxBoardMs: fx.timings.lambda.boardProcessMs }
      : {}),
    ...(fx.timings.coldStart != null ? { fxColdStart: fx.timings.coldStart } : {}),
  };
  console.log("voice-fx timing", {
    jobId: params.jobId,
    totalMs: elapsedMs(started),
    workerLoudnormMs: loudnormMs,
    workerMp3ToWavMs: mp3ToWavMs,
    workerWavToMp3Ms: wavToMp3Ms,
    ...fx.timings,
  });
  return { mp3, ms: elapsedMs(started), split };
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
      "-ac",
      "1",
      "-ar",
      "44100",
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
let cachedRunpodApiKey: string | undefined;
let cachedRunpodUpstreamUrl: string | undefined;

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

const BED_GAIN_PEAK_VOLUME = 0.5;

/**
 * Mix speech (input 0) with one or more looped background beds.
 * Each layer gain is 0–100; mixer peak (100) is volume 0.5 so speech at 1.0 stays louder.
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
      // Beds are looped by `aloop` below, so prefer the gapless Opus sibling —
      // MP3 carries encoder padding that would land on every loop seam.
      const requested = layers[i].key.trim();
      const opus = siblingOpusKey(requested);
      let sourceKey = requested;
      let ext = "mp3";
      if (opus) {
        try {
          await s3.send(
            new HeadObjectCommand({ Bucket: params.bucket, Key: opus }),
          );
          sourceKey = opus;
          ext = "opus";
        } catch {
          /* not backfilled yet — fall back to the MP3 */
        }
      }
      const bgObj = await s3.send(
        new GetObjectCommand({
          Bucket: params.bucket,
          Key: sourceKey,
        }),
      );
      const bgBuf = Buffer.from(await bgObj.Body!.transformToByteArray());
      const p = `/tmp/bg-${id}-${i}.${ext}`;
      fs.writeFileSync(p, bgBuf);
      bgPaths.push(p);
    }

    const dur =
      params.durationSeconds && params.durationSeconds > 0
        ? params.durationSeconds
        : undefined;

    // Desired structure:
    // - 1.5s background-only intro
    // - speech starts after 1.5s
    // - 8s tail after speech ends, with background fading out over the tail
    const introSeconds = 1.5;
    const tailSeconds = 8;
    const totalDurSeconds =
      dur !== undefined ? dur + introSeconds + tailSeconds : undefined;
    const bedFadeOut =
      totalDurSeconds !== undefined && totalDurSeconds > tailSeconds + 0.06
        ? `,afade=t=out:st=${Math.max(
            0,
            totalDurSeconds - tailSeconds,
          ).toFixed(2)}:d=${tailSeconds.toFixed(2)}`
        : "";

    const vols = layers.map((l) => (clampGain(l.gain) / 100) * BED_GAIN_PEAK_VOLUME);
    const chainParts: string[] = [];
    const bedLabels: string[] = [];

    for (let i = 0; i < layers.length; i++) {
      const inp = i + 1;
      const label = `b${i}`;
      bedLabels.push(`[${label}]`);
      chainParts.push(
        `[${inp}:a]aloop=loop=-1:size=2e+09,afade=t=in:st=0:d=0.03${bedFadeOut},volume=${vols[i].toFixed(4)}[${label}]`,
      );
    }

    let filter: string;
    if (layers.length === 1) {
      // Delay speech so background starts first.
      // If we know the duration, trim/pad the delayed speech so the mixed output can extend into the tail.
      const speechChain =
        totalDurSeconds !== undefined
          ? `[0:a]adelay=${(introSeconds * 1000).toFixed(0)}|${(
              introSeconds * 1000
            ).toFixed(0)},apad,atrim=0:${totalDurSeconds.toFixed(2)}[sp]`
          : `[0:a]adelay=${(introSeconds * 1000).toFixed(0)}|${(
              introSeconds * 1000
            ).toFixed(0)}[sp]`;
      // Use a limiter on the final bus to prevent clipping without auto-attenuating beds.
      filter = `${chainParts.join(";")};${speechChain};[sp][b0]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95`;
    } else {
      const speechChain =
        totalDurSeconds !== undefined
          ? `[0:a]adelay=${(introSeconds * 1000).toFixed(0)}|${(
              introSeconds * 1000
            ).toFixed(0)},apad,atrim=0:${totalDurSeconds.toFixed(2)}[sp]`
          : `[0:a]adelay=${(introSeconds * 1000).toFixed(0)}|${(
              introSeconds * 1000
            ).toFixed(0)}[sp]`;
      // IMPORTANT: don't use amix normalize=1 here — it makes beds quieter than the UI preview.
      // Instead, mix at the intended per-layer volumes and apply a limiter.
      filter = `${chainParts.join(";")};${bedLabels.join("")}amix=inputs=${layers.length}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95[bed];${speechChain};[sp][bed]amix=inputs=2:duration=longest:dropout_transition=0,alimiter=limit=0.95`;
    }

    const args = ["-y", "-i", speechPath, ...bgPaths.flatMap((p) => ["-i", p]), "-filter_complex", filter];
    if (totalDurSeconds !== undefined) {
      args.push("-t", totalDurSeconds.toFixed(2));
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

async function getRunpodApiKey(): Promise<string> {
  if (cachedRunpodApiKey) return cachedRunpodApiKey;
  const arn = process.env.RUNPODS_SECRET_ARN;
  if (!arn) throw new Error("RUNPODS_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("RunPod API key secret is empty");
  cachedRunpodApiKey = s;
  return cachedRunpodApiKey;
}

async function getRunpodUpstreamUrl(): Promise<string> {
  if (cachedRunpodUpstreamUrl) return cachedRunpodUpstreamUrl;
  const arn = process.env.RUNPODS_URL_SECRET_ARN;
  if (!arn) throw new Error("RUNPODS_URL_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("RunPod URL secret is empty");
  cachedRunpodUpstreamUrl = s;
  return cachedRunpodUpstreamUrl;
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
  model: string;
  meditationStyle?: string;
  transcript: string;
  speechSpeed: number;
  journalMode: boolean;
  /** Guided length target (2, 5, or 10 minutes); scales word targets from the 5‑minute baseline. */
  targetMinutes: number;
}): Promise<{
  script: string;
  usage: { input_tokens: number; output_tokens: number } | null;
}> {
  const words = getFleetScriptWordTargets({
    targetMinutes: params.targetMinutes,
    speechSpeed: params.speechSpeed,
  });
  const wordsMin = words.min;
  const wordsMax = words.max;

  const styleForScript = params.meditationStyle?.trim() ?? "";
  const styleHint = styleForScript
    ? `Preferred meditation style from the creator: "${styleForScript}".`
    : "The creator has not locked a style label yet — infer an appropriate approach from the chat.";
  const styleLocked = creatorChoseSpecificMeditationTechnique({
    journalMode: params.journalMode,
    meditationStyle: styleForScript,
  });
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
    params.transcript?.trim() || "(No messages yet.)",
    "",
    "### Your task",
    "Write the complete guided meditation script that a human guide would read aloud for recording.",
    `Target length: about **${params.targetMinutes} minutes** at a calm, unhurried speaking pace (roughly ${wordsMin}–${wordsMax} words).`,
    "Use clear sections (e.g. opening/arrival, main practice, gentle closing).",
    "Match the emotional tone, intentions, and imagery implied by the conversation.",
    "Use second person or gentle imperatives; warm, inclusive, non-clinical language.",
    "Phrase for natural text-to-speech: avoid single-word sentences or standalone one-word lines (they often get wrong stress or intonation). Prefer multi-word phrases and full sentences—for example, instead of ending with “Sleep.” alone, close with something like “When you’re ready, let yourself drift into sleep.”",
    SCRIPT_PAUSE_PROMPT_RULES,
    "Output **only** the words the guide speaks and these [[PAUSE …]] named-band markers; do not output other markdown or commentary.",
    scriptDurationPlanningAppendix(params.targetMinutes, {
      speechSpeed: params.speechSpeed,
    }),
  ].join("\n");

  const system = [
    "You are an expert meditation scriptwriter for medimade.io.",
    "You write speakable, production-ready guided meditation scripts.",
    "If the creator is joking or playful, it is OK to include whimsical subject matter, but the meditation itself must remain genuinely calming, coherent, and high-quality—not a joke script. Use playful imagery as a vehicle for grounding, breath, and emotional regulation.",
    "Never generate hate/harassment, sexual content involving minors, non-consensual sexual content, graphic sexual content, instructions for wrongdoing, or glorification of self-harm. If the creator asks for something socially unacceptable, refuse briefly and produce a safe alternative meditation topic.",
    "You phrase lines for natural TTS: avoid isolated one-word sentences; use multi-word phrases where possible.",
    "You place pauses **generously and often** for clarity and pacing—especially spacious where self-paced work needs room—while keeping each silence **motivated** (never mechanical fillers). For **guided** in-then-out breath pairs, keep the gap between steps **short**; reserve long silences for open practice without an immediate next cue.",
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
  return { script: text, usage: parseAnthropicMessageUsage(responseText) };
}

/** Keep DynamoDB item under 400 KB (UTF-8 bytes, incl. other attributes). */
const MAX_SCRIPT_BYTES_FOR_LIBRARY = 320_000;

function parseMetadataJsonFromAnthropicText(responseText: string): {
  title: string;
  meditationType: string;
  description: string;
} {
  let parsedApi: { content?: Array<{ type?: string; text?: string }> };
  try {
    parsedApi = JSON.parse(responseText);
  } catch {
    throw new Error("Invalid JSON from Anthropic (metadata transport)");
  }

  let raw =
    parsedApi.content?.find((c) => c?.type === "text")?.text?.trim() ?? "";
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let obj: { title?: unknown; meditationType?: unknown; description?: unknown };
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("Metadata assistant payload was not JSON");
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
  if (typeof obj.description === "string") {
    descriptionRaw = obj.description.trim();
  }
  descriptionRaw = descriptionRaw.replace(/\s+/g, " ");
  if (descriptionRaw.length > 300) {
    descriptionRaw = descriptionRaw.slice(0, 300).trim();
  }

  return { title, meditationType, description: descriptionRaw };
}

async function callAnthropicMetadataJson(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
}): Promise<{
  responseText: string;
  usage: { input_tokens: number; output_tokens: number } | null;
}> {
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": params.apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: 512,
      system: params.system,
      messages: [{ role: "user", content: params.user } satisfies ChatTurn],
    }),
  });

  const responseText = await upstream.text();
  if (!upstream.ok) {
    throw new Error(
      `Anthropic metadata failed: ${responseText.slice(0, 500)}`,
    );
  }
  return {
    responseText,
    usage: parseAnthropicMessageUsage(responseText),
  };
}

async function deriveLibraryMetadataFromClaude(params: {
  apiKey: string;
  model: string;
  meditationStyle: string;
  transcript: string;
  scriptPreview: string;
  /** Journal / free-form: no real style label — type must be inferred from chat + script only. */
  journalMode: boolean;
}): Promise<{
  title: string;
  meditationType: string;
  description: string;
  claudeUsage: { input_tokens: number; output_tokens: number } | null;
}> {
  const scriptPreview = params.scriptPreview.slice(0, 1200);
  const allowedJson = knownMeditationTypesJsonArrayBlock();

  const system = [
    "You output exactly one JSON object and nothing else: keys title, meditationType, description.",
    'Field "meditationType" MUST be identical to one string in the ALLOWED_MEDITATION_TYPES JSON array from the user message — copy it character-for-character (including spaces and hyphens).',
    "Pick the **single best-matching** category for this meditation; if several fit, choose the strongest overall fit.",
    "Never invent labels: no synonyms or paraphrases (e.g. not Mindfulness, Zen, Guided meditation, Calm, General).",
    "No markdown code fences.",
  ].join(" ");

  const modeBlock = params.journalMode
    ? [
        "### Task",
        "The creator used journal / free-form mode. Ignore placeholder style labels like “General”.",
        "Read the chat + script, then choose the **single best-matching** meditationType from ALLOWED_MEDITATION_TYPES only (verbatim copy).",
      ].join("\n")
    : [
        "### Task",
        `Creator style label (tone/context only): ${params.meditationStyle.trim() || "(none)"}.`,
        "Choose the **single best-matching** meditationType from ALLOWED_MEDITATION_TYPES for what the script actually does (verbatim copy).",
        "If the style label exactly matches one allowed string and the script fits it, you may use that same string.",
      ].join("\n");

  const userMain = [
    "### ALLOWED_MEDITATION_TYPES",
    "You MUST set JSON key meditationType to EXACTLY one of these strings (copy from the array below, unchanged):",
    allowedJson,
    "",
    modeBlock,
    "",
    "### Planning / chat context",
    params.transcript.trim().slice(0, 2500) || "(none)",
    "",
    "### Beginning of the final spoken script",
    scriptPreview || "(empty)",
    "",
    'Return: {"title":"~10 words, evocative","meditationType":"<one allowed string exactly>","description":"200-300 characters, one line, what the listener will experience"}',
  ].join("\n");

  const { responseText, usage } = await callAnthropicMetadataJson({
    apiKey: params.apiKey,
    model: params.model,
    system,
    user: userMain,
  });

  let { title, meditationType, description } =
    parseMetadataJsonFromAnthropicText(responseText);

  if (description.length < 200) {
    throw new Error("Missing or too-short description in metadata JSON");
  }
  if (!title || !meditationType) {
    throw new Error("Missing title or meditationType in metadata JSON");
  }

  const normalizedFromLlm = normalizeMeditationType(meditationType);
  const normalizedType: KnownMeditationType =
    normalizedFromLlm ??
    inferPresetTypeFromScriptHeuristic(params.scriptPreview) ??
    "Reflection";

  return {
    title,
    meditationType: normalizedType,
    description,
    claudeUsage: usage,
  };
}

function fallbackLibraryMetadata(params: {
  meditationStyle: string;
  transcript: string;
  scriptPreview: string;
  journalMode: boolean;
}): { title: string; meditationType: KnownMeditationType; description: string } {
  const rawStyle = params.meditationStyle.trim();
  const style =
    rawStyle && rawStyle.toLowerCase() !== "general" ? rawStyle : "";

  // Heuristic: pull the first "User:" line from the transcript to avoid generic titles in Journal mode.
  const firstUserLine = (() => {
    const t = params.transcript || "";
    const m = t.match(/(^|\n)User:\s*([^\n]+)/i);
    return (m?.[2] ?? "").trim();
  })();
  const moodSnippet = firstUserLine
    .replace(/\s+/g, " ")
    .replace(/[“”"]/g, "")
    .trim();
  const shortMood =
    moodSnippet.length > 0 ? moodSnippet.slice(0, 80).replace(/\s+$/g, "") : "";

  const fromScript =
    params.journalMode || !style
      ? inferPresetTypeFromScriptHeuristic(params.scriptPreview)
      : null;

  // Pick a reasonable known type when metadata inference is unavailable.
  const meditationType: KnownMeditationType =
    style && normalizeMeditationType(style)
      ? (normalizeMeditationType(style) as KnownMeditationType)
      : fromScript ?? "Reflection";
  const title = style
    ? `${style} · session`
    : shortMood
      ? `Journal · ${shortMood}`
      : "Guided meditation";

  const base = style
    ? `A ${style} session with gentle guidance to help you soften tension, steady your breath, and reconnect with calm. Expect slow pacing, soothing reminders, and a grounded end-state you can carry into your day.`
    : shortMood
      ? `A gentle guided session shaped around your check-in: ${shortMood}. Expect slow pacing, supportive reminders, and an easy landing that helps you feel more grounded by the end.`
      : "A guided meditation designed to calm your mind and support relaxation. Expect gentle pacing, slow breath cues, and reassuring prompts that help you release tension and return to the present moment.";

  let description = base.replace(/\s+/g, " ").trim();
  if (description.length > 300) description = description.slice(0, 300).trim();
  if (description.length < 200) {
    description = `${description} Let the experience settle in. Breathe, notice, and relax.`
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
  }

  return { title, meditationType, description };
}

async function fishTtsMp3(params: {
  apiKey: string;
  text: string;
  reference_id: string;
  speed: number;
  /** Fish Audio model id (e.g. s2.1-pro-free, s1). */
  model: string;
}): Promise<Buffer> {
  const maxAttempts = 5;
  let lastErr: string | null = null;
  const model =
    typeof params.model === "string" && params.model.trim()
      ? params.model.trim()
      : FISH_TTS_MODEL;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const upstream = await fetch(FISH_TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          model,
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

async function synthesizeSegmentMp3(params: {
  provider: TtsProvider;
  fishApiKey?: string;
  runpod?: { apiKey: string; upstreamUrl: string };
  text: string;
  voiceId: string;
  speed: number;
  fishTtsModel?: string;
}): Promise<Buffer> {
  if (params.provider === "fish") {
    if (!params.fishApiKey) throw new Error("Fish API key is not configured");
    return fishTtsMp3({
      apiKey: params.fishApiKey,
      text: params.text,
      reference_id: params.voiceId,
      speed: params.speed,
      model: params.fishTtsModel ?? FISH_TTS_MODEL,
    });
  }
  if (!params.runpod) throw new Error("RunPod TTS is not configured");
  const wav = await orpheusTtsWav({
    apiKey: params.runpod.apiKey,
    upstreamUrl: params.runpod.upstreamUrl,
    text: params.text,
    voice: params.voiceId,
    speed: params.speed,
  });
  return wavToMp3Buffer(wav);
}

async function synthesizeScriptWithPauses(params: {
  provider: TtsProvider;
  fishApiKey?: string;
  runpod?: { apiKey: string; upstreamUrl: string };
  script: string;
  voiceId: string;
  speed: number;
  fishTtsModel?: string;
  pauseBands?: Awaited<ReturnType<typeof loadPauseBandSeconds>>;
  /** When set, loudnorm + Pedalboard run once over the assembled track. */
  voiceFx?: { preset: string; bucket: string; jobId: string };
}): Promise<{
  audio: Buffer;
  utf8Bytes: number;
  voiceFxApplied: boolean;
  timings: Pick<GenerationTimings, "sections"> & {
    phases: Pick<
      GenerationPhaseTimings,
      "concatMs" | "fxMs" | "fxFfmpegMs" | "fxInvokeMs" | "fxBoardMs" | "fxColdStart"
    >;
  };
}> {
  const segments = parseScriptIntoSegments(params.script, params.pauseBands);
  const fishOpts = { fishTtsModel: params.fishTtsModel };
  const voiceFx = params.voiceFx;
  const sectionTimings: GenerationSectionTiming[] = [];
  const fxPhase: Pick<
    GenerationPhaseTimings,
    "fxMs" | "fxFfmpegMs" | "fxInvokeMs" | "fxBoardMs" | "fxColdStart"
  > = {};

  /**
   * One pass over the finished track. Per-section FX used to fan out a Lambda
   * per segment, which throttled on the account concurrency limit, starved the
   * worker's ffmpeg on CPU, and clipped every reverb tail at a word boundary.
   * Pauses are pure silence and the beds are mixed live in the player, so the
   * assembled track holds exactly the same audio — the tails just get somewhere
   * to decay into.
   */
  async function applyVoiceFx(mp3: Buffer): Promise<Buffer> {
    if (!voiceFx) return mp3;
    const fx = await loudnormThenVoiceFxMp3({
      mp3,
      preset: voiceFx.preset,
      bucket: voiceFx.bucket,
      jobId: `${voiceFx.jobId}-full`,
    });
    fxPhase.fxMs = fx.ms;
    Object.assign(fxPhase, fx.split);
    return fx.mp3;
  }

  if (segments.length === 0) {
    const clean = sanitizeScriptForTts(params.script);
    const ttsStarted = Date.now();
    let audio = await synthesizeSegmentMp3({
      provider: params.provider,
      fishApiKey: params.fishApiKey,
      runpod: params.runpod,
      text: clean,
      voiceId: params.voiceId,
      speed: params.speed,
      ...fishOpts,
    });
    sectionTimings.push({
      i: 0,
      ttsMs: elapsedMs(ttsStarted),
      utf8Bytes: Buffer.byteLength(clean, "utf8"),
    });
    audio = await applyVoiceFx(audio);
    return {
      audio,
      utf8Bytes: Buffer.byteLength(clean, "utf8"),
      voiceFxApplied: Boolean(voiceFx),
      timings: { sections: sectionTimings, phases: { ...fxPhase } },
    };
  }

  const id = randomUUID();
  const files: string[] = [];
  const speechPaths: string[] = [];
  let totalBytes = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const clean = sanitizeScriptForTts(seg.text);
    if (!clean) continue;
    const utf8Bytes = Buffer.byteLength(clean, "utf8");
    totalBytes += utf8Bytes;

    const ttsStarted = Date.now();
    const segBuf = await synthesizeSegmentMp3({
      provider: params.provider,
      fishApiKey: params.fishApiKey,
      runpod: params.runpod,
      text: clean,
      voiceId: params.voiceId,
      speed: params.speed,
      ...fishOpts,
    });
    sectionTimings.push({
      i: sectionTimings.length,
      ttsMs: elapsedMs(ttsStarted),
      utf8Bytes,
      pauseSec: seg.pauseSeconds > 0 ? seg.pauseSeconds * PAUSE_RENDER_SCALE : undefined,
    });
    const segPath = `/tmp/seg-${id}-${i}.mp3`;
    fs.writeFileSync(segPath, segBuf);
    files.push(segPath);
    speechPaths.push(segPath);

    if (seg.pauseSeconds > 0) {
      const pausePath = `/tmp/pause-${id}-${i}.mp3`;
      await execFileAsync("ffmpeg", [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=channel_layout=mono:sample_rate=44100",
        "-t",
        (seg.pauseSeconds * PAUSE_RENDER_SCALE).toFixed(2),
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
    const ttsStarted = Date.now();
    let audio = await synthesizeSegmentMp3({
      provider: params.provider,
      fishApiKey: params.fishApiKey,
      runpod: params.runpod,
      text: clean,
      voiceId: params.voiceId,
      speed: params.speed,
      ...fishOpts,
    });
    sectionTimings.push({
      i: 0,
      ttsMs: elapsedMs(ttsStarted),
      utf8Bytes: Buffer.byteLength(clean, "utf8"),
    });
    audio = await applyVoiceFx(audio);
    return {
      audio,
      utf8Bytes: Buffer.byteLength(clean, "utf8"),
      voiceFxApplied: Boolean(voiceFx),
      timings: { sections: sectionTimings, phases: { ...fxPhase } },
    };
  }

  if (files.length === 1) {
    const only = await applyVoiceFx(fs.readFileSync(files[0]));
    return {
      audio: only,
      utf8Bytes: totalBytes,
      voiceFxApplied: Boolean(voiceFx),
      timings: { sections: sectionTimings, phases: { ...fxPhase } },
    };
  }

  const listPath = `/tmp/concat-${id}.txt`;
  fs.writeFileSync(
    listPath,
    files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
  );
  const outPath = `/tmp/concat-out-${id}.mp3`;

  const concatStarted = Date.now();
  // Every part comes straight from TTS or anullsrc at the same codec/rate now
  // that FX runs after this, so a stream copy is safe (and much cheaper).
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
  const concatMs = elapsedMs(concatStarted);

  const outBuf = await applyVoiceFx(fs.readFileSync(outPath));
  return {
    audio: outBuf,
    utf8Bytes: totalBytes,
    voiceFxApplied: Boolean(voiceFx),
    timings: {
      sections: sectionTimings,
      phases: { concatMs, ...fxPhase },
    },
  };
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
  console.log("meditation-audio worker start", {
    jobId: event.jobId,
  });

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
    userId?: string;
    createdAt?: string;
    transcript?: string;
    meditationStyle?: string;
    journalMode?: boolean;
    meditationTargetMinutes?: number;
    claudeModel?: string;
    scriptText?: string;
    referenceId?: string;
    ttsProvider?: TtsProvider;
    fishTtsModel?: string;
    speed?: number;
    voiceFxPreset?: string;
    backgroundSoundKey?: string;
    backgroundNatureKey?: string;
    backgroundMusicKey?: string;
    backgroundDrumsKey?: string;
    backgroundNoiseKey?: string;
    backgroundNatureGain?: number;
    backgroundMusicGain?: number;
    backgroundDrumsGain?: number;
    backgroundNoiseGain?: number;
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

  const jobUserId =
    typeof jobItem.userId === "string" && jobItem.userId.trim()
      ? jobItem.userId.trim()
      : GLOBAL_MEDITATION_USER_ID;

  const body: {
    transcript?: string;
    meditationStyle?: string;
    journalMode?: boolean;
    meditationTargetMinutes?: number;
    claudeModel?: string;
    scriptText?: string;
    reference_id?: string;
    ttsProvider?: TtsProvider;
    fishTtsModel?: string;
    speed?: number;
    voiceFxPreset?: string;
    backgroundSoundKey?: string;
    backgroundNatureKey?: string;
    backgroundMusicKey?: string;
    backgroundDrumsKey?: string;
    backgroundNoiseKey?: string;
    backgroundNatureGain?: number;
    backgroundMusicGain?: number;
    backgroundDrumsGain?: number;
    backgroundNoiseGain?: number;
  } = {
    transcript: jobItem.transcript,
    meditationStyle: jobItem.meditationStyle,
    journalMode: jobItem.journalMode,
    meditationTargetMinutes: jobItem.meditationTargetMinutes,
    claudeModel: jobItem.claudeModel,
    scriptText: jobItem.scriptText,
    reference_id: jobItem.referenceId,
    ttsProvider: jobItem.ttsProvider,
    fishTtsModel: jobItem.fishTtsModel,
    speed: jobItem.speed,
    voiceFxPreset: jobItem.voiceFxPreset,
    backgroundSoundKey: jobItem.backgroundSoundKey,
    backgroundNatureKey: jobItem.backgroundNatureKey,
    backgroundMusicKey: jobItem.backgroundMusicKey,
    backgroundDrumsKey: jobItem.backgroundDrumsKey,
    backgroundNoiseKey: jobItem.backgroundNoiseKey,
    backgroundNatureGain: jobItem.backgroundNatureGain,
    backgroundMusicGain: jobItem.backgroundMusicGain,
    backgroundDrumsGain: jobItem.backgroundDrumsGain,
    backgroundNoiseGain: jobItem.backgroundNoiseGain,
  };

  const ttsProvider = normalizeTtsProvider(body.ttsProvider ?? jobItem.ttsProvider);
  const fishTtsModel = normalizeFishTtsModel(body.fishTtsModel);

  const referenceId =
    typeof body.reference_id === "string" && body.reference_id.trim()
      ? body.reference_id.trim()
      : "";
  if (!referenceId) {
    const msg =
      ttsProvider === "orpheus"
        ? "`reference_id` (Orpheus voice id) is required"
        : "`reference_id` (Fish voice model id) is required";
    console.error("job missing referenceId", { jobId: event.jobId, ttsProvider });
    await markJobFailed(event.jobId, msg);
    return json(400, { error: msg });
  }

  const transcript = typeof body.transcript === "string" ? body.transcript : "";
  const meditationStyle =
    typeof body.meditationStyle === "string" ? body.meditationStyle : "";
  const journalModeFromJob = body.journalMode === true;
  /** Dev A/B from the create flow; unsupported ids fall back to Haiku. */
  const claudeModel = coerceClaudeModel(body.claudeModel);
  const targetMinutes = coerceMeditationTargetMinutes(
    body.meditationTargetMinutes,
  );
  const styleTrimmed = meditationStyle.trim();
  const isJournalCatalog =
    journalModeFromJob ||
    !styleTrimmed ||
    styleTrimmed.toLowerCase() === "general";
  const scriptText =
    typeof body.scriptText === "string" ? body.scriptText.trim() : "";
  const speechSpeed = FIXED_SPEECH_PREVIEW_SPEED;
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
          : 25,
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
  const zk = trimKey(body.backgroundNoiseKey);
  if (zk) {
    layeredBackground.push({
      key: zk,
      gain: clampGain(
        typeof body.backgroundNoiseGain === "number"
          ? body.backgroundNoiseGain
          : 10,
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
    ttsProvider,
    speechSpeed,
    backgroundLayerCount: backgroundLayers.length,
  });


  let scriptTextUsed = scriptText;
  const shouldGenerateScript = !scriptTextUsed;
  let claudeWorkerInputTokens = 0;
  let claudeWorkerOutputTokens = 0;
  const generationTimings: GenerationTimings = { phases: {}, sections: [] };
  try {
    if (shouldGenerateScript) {
      console.log("generating script from Claude", {
        meditationStylePresent: Boolean(meditationStyle?.trim()),
        targetMinutes,
      });
      const scriptStarted = Date.now();
      const claudeKey = await getClaudeApiKey();
      const gen = await generateScriptFromClaude({
        apiKey: claudeKey,
        model: claudeModel,
        meditationStyle,
        transcript,
        speechSpeed,
        journalMode: journalModeFromJob,
        targetMinutes,
      });
      scriptTextUsed = gen.script;
      generationTimings.phases.scriptMs = elapsedMs(scriptStarted);
      if (gen.usage) {
        claudeWorkerInputTokens += gen.usage.input_tokens;
        claudeWorkerOutputTokens += gen.usage.output_tokens;
      }
      console.log("generated script", {
        chars: scriptTextUsed.length,
        targetMinutes,
        scriptMs: generationTimings.phases.scriptMs,
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
    const metadataStarted = Date.now();
    const claudeKey = await getClaudeApiKey();
    const derived = await deriveLibraryMetadataFromClaude({
      apiKey: claudeKey,
      model: claudeModel,
      meditationStyle,
      transcript,
      scriptPreview: scriptTextUsed,
      journalMode: isJournalCatalog,
    });
    generationTimings.phases.metadataMs = elapsedMs(metadataStarted);
    libraryTitle = derived.title;
    libraryMeditationType = derived.meditationType;
    libraryDescription = derived.description;
    if (derived.claudeUsage) {
      claudeWorkerInputTokens += derived.claudeUsage.input_tokens;
      claudeWorkerOutputTokens += derived.claudeUsage.output_tokens;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "metadata derive failed";
    console.warn("early library metadata derive failed, using fallback", { msg });
    const fb = fallbackLibraryMetadata({
      meditationStyle,
      transcript,
      scriptPreview: scriptTextUsed,
      journalMode: isJournalCatalog,
    });
    libraryTitle = fb.title;
    libraryMeditationType = fb.meditationType;
    libraryDescription = fb.description;
  }

  let claudeChatEstInputTokens: number | null = null;
  let claudeChatEstOutputTokens: number | null = null;
  try {
    const ck = await getClaudeApiKey();
    const est = await estimateCoachChatTokensFromTranscript({
      apiKey: ck,
      model: claudeModel,
      meditationStyle,
      transcript,
      journalMode: journalModeFromJob,
    });
    if (est) {
      claudeChatEstInputTokens = est.inputTokens;
      claudeChatEstOutputTokens = est.outputTokens;
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.warn("coach chat Claude token estimate skipped", { m });
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

  let fishKey: string | undefined;
  let runpodCreds: { apiKey: string; upstreamUrl: string } | undefined;
  try {
    if (ttsProvider === "orpheus") {
      runpodCreds = {
        apiKey: await getRunpodApiKey(),
        upstreamUrl: await getRunpodUpstreamUrl(),
      };
    } else {
      fishKey = await getFishApiKey();
    }
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : ttsProvider === "orpheus"
          ? "RunPod secret lookup failed"
          : "Fish secret lookup failed";
    console.error("tts secret lookup failed", { msg, ttsProvider });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  let mp3Buf: Buffer;
  let scriptUtf8Bytes = 0;
  let pauseSecondsTotal = 0;
  let spokenUtf8Bytes = 0;
  let spokenWordCount = 0;
  try {
    console.log("calling TTS with pause-aware synthesis", {
      reference_id: referenceId,
      ttsProvider,
      fishTtsModel,
    });
    // Script already includes the spoken title when the writer put one in.
    const ttsScript = scriptTextUsed;
    const pauseBands = await loadPauseBandSeconds().catch(() => undefined);
    pauseSecondsTotal = sumPauseMarkerSeconds(ttsScript, pauseBands) * PAUSE_RENDER_SCALE;
    const spokenPlain = spokenPlainWithoutPauses(ttsScript);
    spokenUtf8Bytes = Buffer.byteLength(spokenPlain, "utf8");
    spokenWordCount = spokenPlain
      ? spokenPlain.split(/\s+/).filter(Boolean).length
      : 0;
    const { audio, utf8Bytes, voiceFxApplied, timings: synthTimings } =
      await synthesizeScriptWithPauses({
      provider: ttsProvider,
      fishApiKey: fishKey,
      runpod: runpodCreds,
      script: ttsScript,
      voiceId: referenceId,
      speed: speechSpeed,
      fishTtsModel,
      pauseBands,
      ...(voiceFxPreset
        ? {
            voiceFx: {
              preset: voiceFxPreset,
              bucket: mediaBucketName,
              jobId: event.jobId,
            },
          }
        : {}),
    });
    generationTimings.sections = synthTimings.sections;
    Object.assign(generationTimings.phases, synthTimings.phases);
    mp3Buf = audio;
    scriptUtf8Bytes = utf8Bytes;
    console.log("TTS success", {
      bytes: mp3Buf.byteLength,
      ttsProvider,
      voiceFxApplied,
    });
    if (!voiceFxApplied) {
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
    } else {
      console.log("voice-fx already applied per speech section", {
        preset: voiceFxPreset,
        bytes: mp3Buf.byteLength,
      });
    }
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.message
        : ttsProvider === "orpheus"
          ? "Orpheus TTS failed"
          : "Fish TTS failed";
    const kind = /voice-fx/i.test(msg) ? "voice-fx" : "TTS";
    console.error(`${kind} failed`, { msg, ttsProvider });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  const key = `meditations/${jobUserId}/${randomUUID()}.mp3`;
  const durationSeconds = await getMp3DurationSeconds(mp3Buf);

  // Background beds are mixed live in the Library player (not baked into this MP3).

  // Final loudness normalization for the speech stem.
  try {
    const loudnormStarted = Date.now();
    mp3Buf = await loudnormMp3Buffer(mp3Buf);
    generationTimings.phases.loudnormMs = elapsedMs(loudnormStarted);
    console.log("loudnorm -16 LUFS applied to final output", {
      bytes: mp3Buf.byteLength,
      loudnormMs: generationTimings.phases.loudnormMs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "final loudnorm failed";
    console.error("final loudnorm failed", { msg });
    await markJobFailed(event.jobId, msg);
    return json(500, { error: msg });
  }

  try {
    console.log("putting to S3", { bucket: mediaBucketName, key, bytes: mp3Buf.byteLength });
    const uploadStarted = Date.now();
    await s3.send(
      new PutObjectCommand({
        Bucket: mediaBucketName,
        Key: key,
        Body: mp3Buf,
        ContentType: "audio/mpeg",
        CacheControl: "no-store",
      }),
    );
    generationTimings.phases.uploadMs = elapsedMs(uploadStarted);
    console.log("S3 PutObject success", { key, uploadMs: generationTimings.phases.uploadMs });
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
    const jobCreatedAt =
      typeof jobItem.createdAt === "string" && jobItem.createdAt.trim()
        ? jobItem.createdAt.trim()
        : null;
    const jobStartedMs = jobCreatedAt ? Date.parse(jobCreatedAt) : NaN;
    const generationElapsedMs =
      Number.isFinite(jobStartedMs) && jobStartedMs > 0
        ? Math.max(0, Date.parse(createdAt) - jobStartedMs)
        : null;
    await ddb.send(
      new PutCommand({
        TableName: analyticsTableName,
        Item: {
          pk: meditationUserPk(jobUserId),
          sk: `${createdAt}#${id}`,
          id,
          createdAt,
          ...(jobCreatedAt ? { jobCreatedAt } : {}),
          ...(generationElapsedMs != null ? { generationElapsedMs } : {}),
          ...(generationTimings.sections.length > 0 ||
          generationTimings.phases.scriptMs != null ||
          generationTimings.phases.metadataMs != null ||
          generationTimings.phases.concatMs != null ||
          generationTimings.phases.loudnormMs != null ||
          generationTimings.phases.uploadMs != null
            ? { generationTimings }
            : {}),
          ...(event.jobId ? { jobId: event.jobId } : {}),
          s3Key: key,
          audioUrl,
          mp3Bytes: mp3Buf.byteLength,
          durationSeconds: durationSeconds ?? null,
          scriptUtf8Bytes,
          pauseSecondsTotal,
          spokenUtf8Bytes,
          spokenWordCount,
          fishTtsModel,
          claudeHaiku45WorkerInputTokens: claudeWorkerInputTokens,
          claudeHaiku45WorkerOutputTokens: claudeWorkerOutputTokens,
          ...(claudeChatEstInputTokens != null && claudeChatEstOutputTokens != null
            ? {
                claudeHaiku45ChatEstInputTokens: claudeChatEstInputTokens,
                claudeHaiku45ChatEstOutputTokens: claudeChatEstOutputTokens,
              }
            : {}),
          claudeModel,
          speechSpeed,
          referenceId,
          meditationStyle: isJournalCatalog ? null : styleTrimmed || null,
          scriptWasGenerated: shouldGenerateScript,
          title: libraryTitle,
          meditationType: libraryMeditationType,
          description: libraryDescription,
          scriptText: scriptForLibrary,
          scriptTruncated,
          rating: null,
          liveMix: true,
          backgroundNatureKey: nk ?? "",
          backgroundMusicKey: mk ?? "",
          backgroundDrumsKey: dk ?? "",
          backgroundNoiseKey: zk ?? "",
          backgroundNatureGain:
            typeof body.backgroundNatureGain === "number" &&
            Number.isFinite(body.backgroundNatureGain)
              ? Math.min(100, Math.max(0, body.backgroundNatureGain))
              : 25,
          backgroundMusicGain:
            typeof body.backgroundMusicGain === "number" &&
            Number.isFinite(body.backgroundMusicGain)
              ? Math.min(100, Math.max(0, body.backgroundMusicGain))
              : 50,
          backgroundDrumsGain:
            typeof body.backgroundDrumsGain === "number" &&
            Number.isFinite(body.backgroundDrumsGain)
              ? Math.min(100, Math.max(0, body.backgroundDrumsGain))
              : 40,
          backgroundNoiseGain:
            typeof body.backgroundNoiseGain === "number" &&
            Number.isFinite(body.backgroundNoiseGain)
              ? Math.min(100, Math.max(0, body.backgroundNoiseGain))
              : 10,
          createdBackgroundNatureKey: nk ?? "",
          createdBackgroundMusicKey: mk ?? "",
          createdBackgroundDrumsKey: dk ?? "",
          createdBackgroundNoiseKey: zk ?? "",
          createdBackgroundNatureGain:
            typeof body.backgroundNatureGain === "number" &&
            Number.isFinite(body.backgroundNatureGain)
              ? Math.min(100, Math.max(0, body.backgroundNatureGain))
              : 25,
          createdBackgroundMusicGain:
            typeof body.backgroundMusicGain === "number" &&
            Number.isFinite(body.backgroundMusicGain)
              ? Math.min(100, Math.max(0, body.backgroundMusicGain))
              : 50,
          createdBackgroundDrumsGain:
            typeof body.backgroundDrumsGain === "number" &&
            Number.isFinite(body.backgroundDrumsGain)
              ? Math.min(100, Math.max(0, body.backgroundDrumsGain))
              : 40,
          createdBackgroundNoiseGain:
            typeof body.backgroundNoiseGain === "number" &&
            Number.isFinite(body.backgroundNoiseGain)
              ? Math.min(100, Math.max(0, body.backgroundNoiseGain))
              : 10,
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

