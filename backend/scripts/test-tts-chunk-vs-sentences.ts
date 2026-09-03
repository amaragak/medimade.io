/**
 * Compare Fish TTS intonation: one 3–4 sentence chunk vs each sentence
 * synthesized separately and concatenated with a short silence.
 *
 * Usage (from backend/):
 *   AWS_PROFILE=mm npx tsx scripts/test-tts-chunk-vs-sentences.ts
 *   AWS_PROFILE=mm npx tsx scripts/test-tts-chunk-vs-sentences.ts --pause 0.35
 *   AWS_PROFILE=mm npx tsx scripts/test-tts-chunk-vs-sentences.ts --speaker "Deep Soothing"
 *
 * Writes MP3s under backend/tmp/tts-chunk-vs-sentences/ and opens the folder.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { FISH_SPEAKERS } from "../lib/fish-speakers";
import { loudnormMp3Buffer } from "../lib/ffmpeg-loudnorm";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";

const execFileAsync = promisify(execFile);
const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_TTS_MODEL =
  (process.env.FISH_TTS_MODEL || "s2.1-pro-free").trim() || "s2.1-pro-free";
const DEFAULT_SECRET_NAME = "medimade/FISH_AUDIO_API_KEY";

const DEFAULT_SENTENCES = [
  "Now bring your attention down through the body, all the way to the lower back.",
  "This is where you have been holding that tension, and we will give it unhurried attention here.",
  "There is no need to change anything you notice.",
  "Just let the breath move through this space, and stay with whatever is here.",
];

function parseArgs(argv: string[]): {
  pauseSec: number;
  speakerName: string;
  speed: number;
  sentences: string[];
} {
  let pauseSec = 0.35;
  let speakerName = "Deep Soothing";
  let speed = FIXED_SPEECH_PREVIEW_SPEED;
  let textArg: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--pause" && argv[i + 1]) {
      pauseSec = Number(argv[++i]);
      continue;
    }
    if (a === "--speaker" && argv[i + 1]) {
      speakerName = argv[++i]!;
      continue;
    }
    if (a === "--speed" && argv[i + 1]) {
      speed = Number(argv[++i]);
      continue;
    }
    if (a === "--text" && argv[i + 1]) {
      textArg = argv[++i]!;
    }
  }
  if (!Number.isFinite(pauseSec) || pauseSec < 0) {
    throw new Error(`Invalid --pause ${pauseSec}`);
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error(`Invalid --speed ${speed}`);
  }
  const sentences = textArg
    ? textArg
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_SENTENCES;
  if (sentences.length < 2) {
    throw new Error("Need at least two sentences to compare.");
  }
  return { pauseSec, speakerName, speed, sentences };
}

function resolveSpeaker(name: string) {
  const found = FISH_SPEAKERS.find(
    (s) => s.name.toLowerCase() === name.toLowerCase(),
  );
  if (!found) {
    throw new Error(
      `Unknown speaker "${name}". Options: ${FISH_SPEAKERS.map((s) => s.name).join(", ")}`,
    );
  }
  return found;
}

async function getFishApiKey(): Promise<string> {
  const direct = process.env.FISH_AUDIO_API_KEY?.trim();
  if (direct) return direct;
  const secretId =
    process.env.FISH_AUDIO_SECRET_ARN?.trim() ||
    process.env.FISH_AUDIO_SECRET_NAME?.trim() ||
    DEFAULT_SECRET_NAME;
  const out = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  const s = out.SecretString?.trim();
  if (!s) throw new Error(`Secret ${secretId} is empty`);
  return s;
}

async function fishTtsMp3(params: {
  apiKey: string;
  referenceId: string;
  text: string;
  speed: number;
}): Promise<Buffer> {
  const text = params.text.trim();
  if (!text) throw new Error("Empty TTS text");
  const upstream = await fetch(FISH_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      model: FISH_TTS_MODEL,
    },
    body: JSON.stringify({
      text,
      reference_id: params.referenceId,
      format: "mp3",
      latency: "normal",
      normalize: true,
      prosody: { speed: params.speed, normalize_loudness: true },
    }),
  });
  if (!upstream.ok) {
    const err = await upstream.text();
    throw new Error(`Fish TTS failed (${upstream.status}): ${err.slice(0, 400)}`);
  }
  return Buffer.from(await upstream.arrayBuffer());
}

async function silenceMp3(seconds: number, sampleRate = 44100): Promise<Buffer> {
  if (seconds <= 0) return Buffer.alloc(0);
  const id = randomUUID();
  const outPath = `/tmp/tts-silence-${id}.mp3`;
  try {
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `anullsrc=r=${sampleRate}:cl=stereo`,
      "-t",
      String(seconds),
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* */
    }
  }
}

async function concatMp3s(parts: Buffer[]): Promise<Buffer> {
  const id = randomUUID();
  const dir = `/tmp/tts-concat-${id}`;
  fs.mkdirSync(dir, { recursive: true });
  const listPath = path.join(dir, "list.txt");
  const outPath = path.join(dir, "out.mp3");
  try {
    const names: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]!.length === 0) continue;
      const name = `p${String(i).padStart(3, "0")}.mp3`;
      fs.writeFileSync(path.join(dir, name), parts[i]!);
      names.push(name);
    }
    fs.writeFileSync(
      listPath,
      names.map((n) => `file '${n}'`).join("\n"),
    );
    await execFileAsync("ffmpeg", [
      "-hide_banner",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c:a",
      "libmp3lame",
      "-q:a",
      "2",
      outPath,
    ]);
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { pauseSec, speakerName, speed, sentences } = parseArgs(
    process.argv.slice(2),
  );
  const speaker = resolveSpeaker(speakerName);
  const chunk = sentences.join(" ");
  const outDir = path.resolve(
    process.cwd().endsWith("backend")
      ? path.join(process.cwd(), "tmp/tts-chunk-vs-sentences")
      : path.join(process.cwd(), "backend/tmp/tts-chunk-vs-sentences"),
  );
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`Speaker: ${speaker.name} (${speaker.modelId})`);
  console.log(`Speed: ${speed}`);
  console.log(`Join pause: ${pauseSec}s`);
  console.log(`Sentences: ${sentences.length}`);
  console.log(`Out: ${outDir}\n`);
  for (const [i, s] of sentences.entries()) {
    console.log(`  [${i + 1}] ${s}`);
  }

  const apiKey = await getFishApiKey();

  console.log("\nSynthesizing whole chunk…");
  const chunkRaw = await fishTtsMp3({
    apiKey,
    referenceId: speaker.modelId,
    text: chunk,
    speed,
  });
  const chunkNorm = await loudnormMp3Buffer(chunkRaw);
  const chunkPath = path.join(outDir, "01-whole-chunk.mp3");
  fs.writeFileSync(chunkPath, chunkNorm);

  console.log("Synthesizing each sentence…");
  const sentenceBufs: Buffer[] = [];
  for (let i = 0; i < sentences.length; i++) {
    const raw = await fishTtsMp3({
      apiKey,
      referenceId: speaker.modelId,
      text: sentences[i]!,
      speed,
    });
    const norm = await loudnormMp3Buffer(raw);
    const p = path.join(outDir, `sentence-${String(i + 1).padStart(2, "0")}.mp3`);
    fs.writeFileSync(p, norm);
    sentenceBufs.push(norm);
    console.log(`  wrote ${path.basename(p)}`);
  }

  console.log(`Concatenating with ${pauseSec}s silence…`);
  const gap = await silenceMp3(pauseSec);
  const interleaved: Buffer[] = [];
  for (let i = 0; i < sentenceBufs.length; i++) {
    if (i > 0) interleaved.push(gap);
    interleaved.push(sentenceBufs[i]!);
  }
  const joined = await concatMp3s(interleaved);
  const joinedPath = path.join(outDir, "02-sentences-joined.mp3");
  fs.writeFileSync(joinedPath, joined);

  const readme = [
    "TTS intonation comparison",
    `Speaker: ${speaker.name}`,
    `Speed: ${speed}`,
    `Join pause: ${pauseSec}s`,
    "",
    "01-whole-chunk.mp3 — single Fish request with all sentences.",
    "02-sentences-joined.mp3 — each sentence as its own Fish request, then ffmpeg concat with silence.",
    "sentence-NN.mp3 — isolated sentence clips.",
    "",
    "Text:",
    ...sentences.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n");
  fs.writeFileSync(path.join(outDir, "README.txt"), readme);

  console.log("\nDone.");
  console.log(`  ${chunkPath}`);
  console.log(`  ${joinedPath}`);

  try {
    await execFileAsync("open", [outDir]);
  } catch {
    /* non-mac or no UI */
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
