import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { S3Client } from "@aws-sdk/client-s3";
import { requireAdminJson } from "../lib/admin-auth";
import { coerceClaudeModel, CLAUDE_HAIKU_45_MODEL_ID } from "../lib/anthropic-pricing";
import { coerceMeditationTargetMinutes } from "../lib/meditation-target-minutes";
import { FIXED_SPEECH_PREVIEW_SPEED } from "../lib/speaker-sample-speed";
import {
  generateScriptLabScript,
} from "../lib/script-lab-generate";
import {
  deleteScriptSegmentTag,
  deleteScriptSegmentVariant,
  exportScriptSegmentLibrary,
  listAllScriptSegmentLibrary,
  listScriptSegmentVariants,
  putScriptSegmentTag,
  putScriptSegmentVariant,
  type ScriptSegmentTagRow,
  type ScriptSegmentVariantRow,
} from "../lib/script-segment-library";
import { buildSegmentTagsForGenerationPrompt } from "../lib/script-segment-tag-metrics";
import { runScriptSegmentImport } from "../lib/script-segment-import";
import { runSegmentMetadataImport } from "../lib/script-segment-metadata-import";
import {
  deleteConstraintVocabularyTag,
  listConstraintVocabulary,
  putConstraintVocabularyTag,
} from "../lib/script-constraint-vocabulary";
import {
  generateScriptSegmentVariantAudio,
  mapWithConcurrency,
  SCRIPT_LAB_TTS_CONCURRENCY,
} from "../lib/script-segment-audio";
import { seedVoiceSpeakersIfEmpty } from "../lib/voice-admin";
import {
  normalizeScriptSegmentTag,
  type ScriptLengthTier,
} from "../lib/script-segment-tags";

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});
let cachedFishKey: string | undefined;
let cachedClaudeKey: string | undefined;

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

function mediaBaseUrl(): string | undefined {
  const domain = (process.env.MEDIA_CLOUDFRONT_DOMAIN || "").trim();
  return domain ? `https://${domain}` : undefined;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return json(204, {});

  const admin = await requireAdminJson(event);
  if ("statusCode" in admin) return admin;

  try {
    if (method === "GET") return await handleGet(event);
    if (method === "PATCH") return await handlePatch(event);
    if (method === "POST") return await handlePost(event);
    return json(405, { error: "Method not allowed" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Script Lab admin failed";
    console.error("admin-script-lab", msg);
    return json(500, { error: msg });
  }
}

async function handleGet(event: APIGatewayProxyEventV2) {
  const exportMode = event.queryStringParameters?.export?.trim();
  if (exportMode === "segments") {
    const payload = await exportScriptSegmentLibrary();
    return json(200, payload);
  }

  const [library, speakers, constraintVocabulary] = await Promise.all([
    listAllScriptSegmentLibrary(),
    seedVoiceSpeakersIfEmpty(),
    listConstraintVocabulary(),
  ]);
  const activeSpeakers = speakers
    .filter((s) => !s.hidden)
    .map((s) => ({
      modelId: s.modelId,
      name: s.name,
    }));
  return json(200, {
    baseUrl: mediaBaseUrl(),
    speakers: activeSpeakers,
    constraintVocabulary: constraintVocabulary.map((r) => r.tag),
    tags: library.tags,
    variantsByTag: library.variantsByTag,
    audioByVariantKey: library.audioByVariantKey,
  });
}

async function handlePatch(event: APIGatewayProxyEventV2) {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body || "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  let tag: ScriptSegmentTagRow | undefined;
  if (body.tag && typeof body.tag === "object") {
    const t = body.tag as Record<string, unknown>;
    tag = await putScriptSegmentTag({
      name: String(t.name ?? ""),
      scope:
        t.scope === "types" || t.scope === "restricted"
          ? "types"
          : t.scope === "general"
            ? "general"
            : undefined,
      types: t.types as string[] | undefined,
      lengthTiered: typeof t.lengthTiered === "boolean" ? t.lengthTiered : undefined,
      repeatability:
        t.repeatability === "connective" || t.repeatability === "singular"
          ? t.repeatability
          : undefined,
      description:
        typeof t.description === "string" ? t.description.trim().slice(0, 4000) : undefined,
    });
  }

  let constraintTag: string | undefined;
  if (body.constraintTag && typeof body.constraintTag === "object") {
    const c = body.constraintTag as Record<string, unknown>;
    const row = await putConstraintVocabularyTag(String(c.tag ?? ""));
    constraintTag = row.tag;
  }

  let variant: ScriptSegmentVariantRow | undefined;
  if (body.variant && typeof body.variant === "object") {
    const v = body.variant as Record<string, unknown>;
    const lengthTierRaw = v.lengthTier;
    let lengthTier: ScriptLengthTier | null | undefined;
    if (lengthTierRaw === null) lengthTier = null;
    else if (
      lengthTierRaw === "short" ||
      lengthTierRaw === "medium" ||
      lengthTierRaw === "long"
    ) {
      lengthTier = lengthTierRaw;
    }
    variant = await putScriptSegmentVariant({
      tagName: String(v.tagName ?? ""),
      variantId: typeof v.variantId === "string" ? v.variantId : undefined,
      text: String(v.text ?? ""),
      sort: typeof v.sort === "number" ? v.sort : undefined,
      lengthTier,
      requiredConstraints: Array.isArray(v.requiredConstraints)
        ? (v.requiredConstraints as string[])
        : undefined,
      excludedConstraints: Array.isArray(v.excludedConstraints)
        ? (v.excludedConstraints as string[])
        : undefined,
    });
  }

  return json(200, { tag, variant, constraintTag });
}

async function handlePost(event: APIGatewayProxyEventV2) {
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(event.body || "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";

  if (action === "delete-tag") {
    await deleteScriptSegmentTag(String(body.tagName ?? ""));
    return json(200, { ok: true });
  }

  if (action === "delete-variant") {
    await deleteScriptSegmentVariant({
      tagName: String(body.tagName ?? ""),
      variantId: String(body.variantId ?? ""),
    });
    return json(200, { ok: true });
  }

  if (action === "delete-constraint-tag") {
    await deleteConstraintVocabularyTag(String(body.tag ?? ""));
    return json(200, { ok: true });
  }

  if (action === "generate-script") {
    return await handleGenerateScript(body);
  }

  if (action === "generate-variant-audio") {
    return await handleGenerateVariantAudio(body);
  }

  if (action === "generate-variant-all-speakers") {
    return await handleGenerateVariantAllSpeakers(body);
  }

  if (action === "generate-library-for-speaker") {
    return await handleGenerateLibraryForSpeaker(body);
  }

  if (action === "import-segments") {
    const importPayload =
      body.payload && typeof body.payload === "object" ? body.payload : body;
    const result = await runScriptSegmentImport(importPayload);
    if (!result.ok) {
      return json(400, { error: "Import validation failed", errors: result.errors });
    }
    return json(200, { ok: true, summary: result.result });
  }

  if (action === "import-tag-metadata") {
    const importPayload =
      body.payload !== undefined ? body.payload : body.metadata !== undefined ? body.metadata : body;
    const result = await runSegmentMetadataImport(importPayload);
    if (!result.ok) {
      return json(400, { error: "Metadata import validation failed", errors: result.errors });
    }
    return json(200, { ok: true, summary: result.result });
  }

  return json(400, { error: `Unknown action ${action}` });
}

async function handleGenerateScript(body: Record<string, unknown>) {
  const targetMinutes = coerceMeditationTargetMinutes(body.meditationTargetMinutes);
  const speechSpeed =
    typeof body.speechSpeed === "number" && body.speechSpeed > 0
      ? body.speechSpeed
      : FIXED_SPEECH_PREVIEW_SPEED;
  const claudeModel = coerceClaudeModel(
    body.claudeModel ?? body.modelId ?? CLAUDE_HAIKU_45_MODEL_ID,
  );

  const transcript =
    typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) {
    return json(400, { error: "Field `transcript` (non-empty string) is required" });
  }
  const journalMode = body.journalMode === true;
  const meditationStyle =
    typeof body.meditationStyle === "string" && body.meditationStyle.trim()
      ? body.meditationStyle.trim()
      : "General";

  const library = await listAllScriptSegmentLibrary();
  const segmentTags = buildSegmentTagsForGenerationPrompt({
    tags: library.tags,
    variantsByTag: library.variantsByTag,
  });
  const verificationTagVariants = library.tags
    .map((t) => ({
      name: t.name,
      repeatability: t.repeatability,
      variants: (library.variantsByTag[t.name] ?? []).map((v) => ({
        variantId: v.variantId,
        text: v.text,
      })),
    }))
    .filter((t) => t.variants.length > 0);

  const apiKey = await getClaudeApiKey();
  const result = await generateScriptLabScript({
    apiKey,
    model: claudeModel,
    transcript,
    meditationStyle,
    journalMode,
    targetMinutes,
    speechSpeed,
    segmentTags,
    generalTagVariants: verificationTagVariants,
  });

  return json(200, {
    beats: result.beats,
    beatsBeforeVerification: result.beatsBeforeVerification,
    verificationNewBeatIndices: result.verificationNewBeatIndices,
    verificationCorrectionsApplied: result.verificationCorrectionsApplied,
    beatWarnings: result.beatWarnings,
    transcript,
    meditationStyle,
    journalMode,
    targetMinutes,
    usage: result.usage,
  });
}

async function handleGenerateVariantAudio(body: Record<string, unknown>) {
  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  if (!bucket) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });

  const tagName = normalizeScriptSegmentTag(String(body.tagName ?? ""));
  const variantId = String(body.variantId ?? "").trim();
  const modelId = String(body.modelId ?? "").trim();
  if (!tagName || !variantId || !modelId) {
    return json(400, { error: "tagName, variantId, and modelId are required" });
  }

  const variants = await listScriptSegmentVariants(tagName);
  const variant = variants.find((v) => v.variantId === variantId);
  if (!variant) return json(404, { error: "Variant not found" });

  const apiKey = await getFishApiKey();
  const audio = await generateScriptSegmentVariantAudio({
    s3,
    bucket,
    apiKey,
    tagName,
    variantId,
    modelId,
    text: variant.text,
  });

  return json(200, { audio, baseUrl: mediaBaseUrl() });
}

async function handleGenerateVariantAllSpeakers(body: Record<string, unknown>) {
  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  if (!bucket) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });

  const tagName = normalizeScriptSegmentTag(String(body.tagName ?? ""));
  const variantId = String(body.variantId ?? "").trim();
  if (!tagName || !variantId) {
    return json(400, { error: "tagName and variantId are required" });
  }

  const variants = await listScriptSegmentVariants(tagName);
  const variant = variants.find((v) => v.variantId === variantId);
  if (!variant) return json(404, { error: "Variant not found" });

  const speakers = (await seedVoiceSpeakersIfEmpty()).filter((s) => !s.hidden);
  const apiKey = await getFishApiKey();

  const results = await mapWithConcurrency(
    speakers,
    SCRIPT_LAB_TTS_CONCURRENCY,
    async (speaker) =>
      generateScriptSegmentVariantAudio({
        s3,
        bucket,
        apiKey,
        tagName,
        variantId,
        modelId: speaker.modelId,
        text: variant.text,
      }),
  );

  return json(200, { audio: results, baseUrl: mediaBaseUrl() });
}

async function handleGenerateLibraryForSpeaker(body: Record<string, unknown>) {
  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  if (!bucket) return json(500, { error: "MEDIA_BUCKET_NAME is not set" });

  const modelId = String(body.modelId ?? "").trim();
  if (!modelId) return json(400, { error: "modelId is required" });

  const library = await listAllScriptSegmentLibrary();
  const jobs: Array<{ tagName: string; variantId: string; text: string }> = [];
  for (const tag of library.tags) {
    for (const v of library.variantsByTag[tag.name] ?? []) {
      jobs.push({ tagName: tag.name, variantId: v.variantId, text: v.text });
    }
  }

  const apiKey = await getFishApiKey();
  const results = await mapWithConcurrency(
    jobs,
    SCRIPT_LAB_TTS_CONCURRENCY,
    async (job) =>
      generateScriptSegmentVariantAudio({
        s3,
        bucket,
        apiKey,
        tagName: job.tagName,
        variantId: job.variantId,
        modelId,
        text: job.text,
      }),
  );

  return json(200, {
    generated: results.length,
    audio: results,
    baseUrl: mediaBaseUrl(),
  });
}
