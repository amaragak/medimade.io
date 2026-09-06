/**
 * Vision board scene generation via Gemini "Nano Banana Pro" image models.
 * Uses a self-reference photo (+ optional supporting refs) + text prompt.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import { optionalUserJson } from "../lib/medimade-auth-http";
import { CLAUDE_HAIKU_45_MODEL_ID } from "../lib/anthropic-pricing";

const secrets = new SecretsManagerClient({});
const s3 = new S3Client({});
let cachedGoogleKey: string | undefined;
let cachedClaudeKey: string | undefined;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Default = Nano Banana Pro (Gemini 3 Pro Image). Override with VISION_IMAGE_MODEL. */
const DEFAULT_MODEL = "gemini-3-pro-image";
const MAX_REF_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT_CHARS = 2000;
const MAX_CHANGE_CHARS = 800;
const MAX_EXTRA_REFS = 3;
const MAX_EXTRA_DESC_CHARS = 280;

function json(
  statusCode: number,
  payload: Record<string, unknown>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(payload),
  };
}

function options(): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Medimade-Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

async function getGoogleAiApiKey(): Promise<string> {
  if (cachedGoogleKey) return cachedGoogleKey;
  const arn = process.env.GOOGLE_AI_SECRET_ARN?.trim();
  if (!arn) throw new Error("GOOGLE_AI_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Google AI API key secret is empty");
  cachedGoogleKey = s;
  return cachedGoogleKey;
}

async function getClaudeApiKey(): Promise<string> {
  if (cachedClaudeKey) return cachedClaudeKey;
  const arn = process.env.CLAUDE_SECRET_ARN?.trim();
  if (!arn) throw new Error("CLAUDE_SECRET_ARN is not set");
  const out = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
  const s = out.SecretString?.trim();
  if (!s) throw new Error("Claude API key secret is empty");
  cachedClaudeKey = s;
  return cachedClaudeKey;
}

function modelId(): string {
  return process.env.VISION_IMAGE_MODEL?.trim() || DEFAULT_MODEL;
}

type ExtraRefInput = {
  description: string;
  referenceKey?: string;
  referenceBase64?: string;
  mimeType?: string;
};

type LoadedRefImage = { b64: string; mime: string };

/**
 * Polish a vision-board scene prompt for Gemini image gen (Haiku).
 * Always runs on first pass; optional changeRequest merges a refine note.
 */
async function polishVisionPromptWithHaiku(
  basePrompt: string,
  changeRequest?: string,
  extraDescriptions?: string[],
): Promise<string> {
  const apiKey = await getClaudeApiKey();
  const system = [
    "You write image prompts for a personal vision board.",
    "A self-reference photo of the real person is attached to the image model — your job is the TEXT prompt only.",
    "Optional supporting reference photos may also be attached (people, pets, places) — each has a user description.",
    "Output ONE cohesive scene prompt that guides Gemini to place THAT person in the scene looking their absolute best.",
    "",
    "Identity (must keep):",
    "- Same person as the primary self-reference: face identity, age range, hair color/style family, skin tone, body type, distinctive features.",
    "- Do NOT invent a different person, celebrity, or generic stock model for the primary subject.",
    "",
    "Supporting references (when listed):",
    "- If the scene involves someone/something matching a supporting description (e.g. mum, dog), explicitly name them and say to match that supporting reference likeness.",
    "- Do not invent extra people/pets that aren't in the scene idea or supporting refs.",
    "",
    "Complimentary enhancement (critical — this is a glow-up, not a documentary copy):",
    "- Make them clearly MORE attractive than a casual selfie — premium AI portrait / lifestyle campaign quality of the SAME person.",
    "- Actively REMOVE common unflattering cues from everyday photos: dark under-eye circles / patches, eye bags, tiredness, dull or sallow skin, redness, blotchiness, harsh shadows in eye sockets, visible stress lines.",
    "- Eyes: bright, rested, well-slept look with clear whites and soft catchlights — never shadowed, sunken, or heavy under the eyes.",
    "- Skin: even luminous tone, healthy glow, refined texture — like flattering beauty retouching, not plastic/filtered erasure of identity.",
    "- Lighting: soft beauty key + gentle fill that lifts the face; warm highlights; never harsh top light or underexposed under-eyes.",
    "- Flattering jaw/cheek light, good posture, elongated neckline when visible; hair freshly styled and healthy.",
    "- Do NOT amplify or faithfully reproduce facial flaws from the reference. Identity stays; tiredness and dark patches go.",
    "- Avoid: muddy skin, washed-out light, unflattering angles, double-chin camera height, plastic over-airbrush that invents a different face.",
    "",
    "Composition (critical for a vision board — person AND situation):",
    "- Two equal priorities: (1) the person recognizably present, (2) the SITUATION clearly readable.",
    "- Prefer medium-wide / environmental framing: full body or 3/4 figure with space around them so the scene, props, and setting are obvious.",
    "- The person should usually occupy roughly 35–55% of the frame — NOT a tight head-and-shoulders crop.",
    "- Key situational elements from the user's idea (pile of money, beach, kitchen, trail, desk, etc.) must be LARGE and central enough to read at a glance — never tiny strips at the bottom edge or blurred corners.",
    "- Pull the camera back; show where they are and what they are doing. Lifestyle editorial / cinematic still, not a selfie portrait.",
    "- Explicitly state framing in the prompt (e.g. 'medium-wide shot, full body seated on a large visible pile of cash, environment readable').",
    "",
    "Vision-board aesthetic:",
    "- Photorealistic, warm, hopeful, cinematic editorial — aspirational magazine/campaign quality.",
    "- No text overlays, watermarks, logos, or UI chrome.",
    "",
    "Reply with ONLY the prompt text — no quotes, labels, or explanation.",
  ].join("\n");

  const userParts = [`User's scene idea:\n${basePrompt}`];
  if (extraDescriptions?.length) {
    userParts.push(
      "",
      "Supporting reference photos attached (use when the scene involves them):",
      ...extraDescriptions.map((d, i) => `${i + 1}. ${d}`),
    );
  }
  if (changeRequest?.trim()) {
    userParts.push("", `Requested change to apply:\n${changeRequest.trim()}`);
  }
  userParts.push(
    "",
    "Write one improved image prompt that keeps their identity, makes them look more attractive (soften under-eye darkness), AND frames the shot so the situation is clearly visible — not a tight close-up that crops away the scene.",
  );

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: CLAUDE_HAIKU_45_MODEL_ID,
      max_tokens: 500,
      temperature: 0.4,
      system,
      messages: [{ role: "user", content: userParts.join("\n") }],
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`Haiku prompt polish failed: ${raw.slice(0, 400)}`);
  }
  let text = "";
  try {
    const parsed = JSON.parse(raw) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    text = (parsed.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text!.trim())
      .join("\n")
      .trim();
  } catch {
    throw new Error("Haiku returned invalid JSON");
  }
  text = text
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(improved\s+)?prompt\s*:\s*/i, "")
    .trim();
  if (text.length < 3) {
    throw new Error("Haiku returned an empty prompt");
  }
  return text.slice(0, MAX_PROMPT_CHARS);
}

async function loadRefImageFromS3(params: {
  bucket: string;
  key: string;
  userId: string;
}): Promise<LoadedRefImage | { error: APIGatewayProxyStructuredResultV2 }> {
  if (!params.key.startsWith(`ideate/vision/${params.userId}/`)) {
    return {
      error: json(403, { error: "Reference key does not belong to this user" }),
    };
  }
  try {
    const obj = await s3.send(
      new GetObjectCommand({ Bucket: params.bucket, Key: params.key }),
    );
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) {
      return {
        error: json(404, { error: "Reference photo not found in storage" }),
      };
    }
    const buf = Buffer.from(bytes);
    if (buf.length < 64 || buf.length > MAX_REF_BYTES) {
      return {
        error: json(400, {
          error: `Reference image must be between 64 bytes and ${MAX_REF_BYTES} bytes`,
        }),
      };
    }
    let mime = "image/jpeg";
    if (obj.ContentType?.startsWith("image/")) {
      mime = obj.ContentType.split(";")[0]!.toLowerCase();
    }
    return { b64: buf.toString("base64"), mime };
  } catch {
    return {
      error: json(404, { error: "Could not load reference photo from storage" }),
    };
  }
}

function parseExtraReferences(raw: unknown): ExtraRefInput[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraRefInput[] = [];
  for (const item of raw.slice(0, MAX_EXTRA_REFS)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const description =
      typeof o.description === "string"
        ? o.description.trim().slice(0, MAX_EXTRA_DESC_CHARS)
        : "";
    if (!description) continue;
    const referenceKey =
      typeof o.referenceKey === "string" ? o.referenceKey.trim() : undefined;
    const referenceBase64 =
      typeof o.referenceBase64 === "string"
        ? o.referenceBase64.trim()
        : undefined;
    if (!referenceKey && !referenceBase64) continue;
    const mimeType =
      typeof o.mimeType === "string" && o.mimeType.trim()
        ? o.mimeType.trim().split(";")[0]!.toLowerCase()
        : undefined;
    out.push({
      description,
      ...(referenceKey ? { referenceKey } : {}),
      ...(referenceBase64 ? { referenceBase64 } : {}),
      ...(mimeType ? { mimeType } : {}),
    });
  }
  return out;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  let body: {
    prompt?: unknown;
    changeRequest?: unknown;
    /** When false, use `prompt` as-is (e.g. regenerate from stored polished prompt). Default true. */
    polishPrompt?: unknown;
    referenceBase64?: unknown;
    referenceKey?: unknown;
    mimeType?: unknown;
    extraReferences?: unknown;
    sessionToken?: unknown;
  };
  try {
    body = JSON.parse(event.body || "{}") as typeof body;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const auth = await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );
  const userId = auth?.sub?.trim() || "guest";

  let prompt =
    typeof body.prompt === "string"
      ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS)
      : "";
  if (prompt.length < 3) {
    return json(400, { error: "Write a short scene description first." });
  }

  const changeRequest =
    typeof body.changeRequest === "string"
      ? body.changeRequest.trim().slice(0, MAX_CHANGE_CHARS)
      : "";
  const extrasIn = parseExtraReferences(body.extraReferences);
  const polishPrompt = body.polishPrompt !== false;
  if (polishPrompt) {
    try {
      prompt = await polishVisionPromptWithHaiku(
        prompt,
        changeRequest || undefined,
        extrasIn.map((e) => e.description),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Prompt polish failed";
      return json(502, {
        error: changeRequest
          ? "Could not refine that scene description."
          : "Could not prepare that scene description.",
        detail: msg.slice(0, 800),
      });
    }
  }

  const bucket = process.env.MEDIA_BUCKET_NAME?.trim();
  const referenceKey =
    typeof body.referenceKey === "string" ? body.referenceKey.trim() : "";
  let b64 =
    typeof body.referenceBase64 === "string" ? body.referenceBase64.trim() : "";
  let mime =
    typeof body.mimeType === "string" && body.mimeType.trim()
      ? body.mimeType.trim().split(";")[0]!.toLowerCase()
      : "image/jpeg";

  if (!b64 && referenceKey) {
    if (!bucket) {
      return json(500, { error: "MEDIA_BUCKET_NAME is not set" });
    }
    const loaded = await loadRefImageFromS3({
      bucket,
      key: referenceKey,
      userId,
    });
    if ("error" in loaded) return loaded.error;
    b64 = loaded.b64;
    mime = loaded.mime;
  }

  if (!b64) {
    return json(400, {
      error: "Upload a reference photo of yourself before generating a scene.",
    });
  }

  let refBuf: Buffer;
  try {
    refBuf = Buffer.from(b64, "base64");
  } catch {
    return json(400, { error: "Invalid base64 reference image" });
  }
  if (refBuf.length < 64 || refBuf.length > MAX_REF_BYTES) {
    return json(400, {
      error: `Reference image must be between 64 bytes and ${MAX_REF_BYTES} bytes`,
    });
  }

  if (!mime.startsWith("image/")) {
    return json(400, { error: "Reference must be an image" });
  }

  const loadedExtras: Array<{ description: string; b64: string; mime: string }> =
    [];
  for (const extra of extrasIn) {
    let eb64 = extra.referenceBase64 || "";
    let emime = extra.mimeType || "image/jpeg";
    if (!eb64 && extra.referenceKey) {
      if (!bucket) {
        return json(500, { error: "MEDIA_BUCKET_NAME is not set" });
      }
      const loaded = await loadRefImageFromS3({
        bucket,
        key: extra.referenceKey,
        userId,
      });
      if ("error" in loaded) return loaded.error;
      eb64 = loaded.b64;
      emime = loaded.mime;
    }
    if (!eb64) continue;
    try {
      const buf = Buffer.from(eb64, "base64");
      if (buf.length < 64 || buf.length > MAX_REF_BYTES) continue;
    } catch {
      continue;
    }
    if (!emime.startsWith("image/")) continue;
    loadedExtras.push({
      description: extra.description,
      b64: eb64,
      mime: emime,
    });
  }

  let apiKey: string;
  try {
    apiKey = await getGoogleAiApiKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Secret lookup failed";
    return json(500, {
      error:
        "Vision image generation is not configured (set medimade/GOOGLE_AI_API_KEY).",
      detail: msg,
    });
  }

  const model = modelId();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const instructionLines = [
    "Create a single cohesive vision-board image.",
    "IMAGE 1 is the PRIMARY SUBJECT (vision-board owner). Keep their identity (same face, age range, hair family, skin tone, body type) — recognizably them, not a different model.",
    "CRITICAL GLOW-UP: they must look MORE physically attractive than IMAGE 1 — like a flattering beauty-retouched campaign portrait of the same person, never a less-attractive or more-tired version.",
    "Actively correct unflattering cues that often appear in selfies/reference photos:",
    "- Remove or strongly soften dark under-eye circles, patches, bags, and shadowing in the eye sockets.",
    "- Remove tired / sleep-deprived look; eyes bright, rested, clear whites, soft catchlights.",
    "- Even out blotchy or dull skin; healthy luminous glow; refined texture (not muddy, grey, or sallow).",
    "- Soften harsh wrinkles/shadows caused by bad lighting; keep natural bone structure.",
    "Do NOT copy dark under-eye patches, hollow tired eyes, or other facial flaws from the reference. Identity yes — flaws no.",
    "Beauty lighting: soft key + gentle fill that lifts the midface and under-eyes; warm highlights; flattering angle and posture; healthy hair.",
    "If the output would look less attractive than the reference, revise toward a complimentary glow-up instead.",
    "",
    "COMPOSITION (vision board = person + situation, both must read clearly):",
    "- Do NOT crop as a tight head-and-shoulders or selfie close-up. Pull the camera back.",
    "- Prefer medium-wide / environmental framing: full body or three-quarter figure with readable setting and props.",
    "- Person roughly 35–55% of the frame; the rest shows the situation they are in.",
    "- Every important situational element in the scene description (e.g. a pile of money they are sitting on) must be LARGE, sharp, and clearly visible — not tiny scraps at the bottom edge or buried in blur.",
    "- If they are sitting on / interacting with something, show that object fully enough that a viewer instantly understands the story.",
  ];
  if (loadedExtras.length) {
    instructionLines.push(
      `Additional supporting reference image(s) follow (${loadedExtras.length}). Each has a description — when the scene involves that person/pet/place, match their likeness from that image. Do not invent unrelated extras.`,
      ...loadedExtras.map(
        (e, i) => `SUPPORTING REFERENCE ${i + 1}: ${e.description}`,
      ),
    );
  }
  instructionLines.push(
    "Photorealistic, warm, hopeful, cinematic editorial. No text overlays, watermarks, or logos.",
    `Scene: ${prompt}`,
  );

  type GeminiPart =
    | { text: string }
    | { inline_data: { mime_type: string; data: string } };

  const parts: GeminiPart[] = [
    { text: instructionLines.join("\n") },
    {
      text: "PRIMARY SUBJECT reference photo (use for identity only — improve attractiveness; do not reproduce under-eye darkness or tired facial flaws):",
    },
    { inline_data: { mime_type: mime, data: b64 } },
  ];
  for (let i = 0; i < loadedExtras.length; i++) {
    const e = loadedExtras[i]!;
    parts.push({
      text: `SUPPORTING REFERENCE ${i + 1} (${e.description}):`,
    });
    parts.push({
      inline_data: { mime_type: e.mime, data: e.b64 },
    });
  }

  const upstream = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  const rawText = await upstream.text();
  if (!upstream.ok) {
    let detail = rawText.slice(0, 1500);
    try {
      const parsed = JSON.parse(rawText) as {
        error?: { message?: string };
      };
      if (parsed.error?.message) detail = parsed.error.message;
    } catch {
      /* keep */
    }
    return json(upstream.status >= 400 ? upstream.status : 502, {
      error: "Image generation failed",
      detail,
    });
  }

  let outB64 = "";
  let outMime = "image/png";
  try {
    const data = JSON.parse(rawText) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
    };
    const outParts = data.candidates?.[0]?.content?.parts ?? [];
    for (const p of outParts) {
      const inline = p.inlineData ?? p.inline_data;
      if (inline?.data) {
        outB64 = inline.data;
        const mimeGuess =
          "mimeType" in inline
            ? inline.mimeType
            : "mime_type" in inline
              ? inline.mime_type
              : undefined;
        outMime = mimeGuess || "image/png";
        break;
      }
    }
  } catch {
    return json(502, { error: "Invalid JSON from image model" });
  }

  if (!outB64) {
    return json(502, {
      error: "Model returned no image — try a clearer scene description.",
    });
  }

  const outBuf = Buffer.from(outB64, "base64");
  const cfDomain = process.env.MEDIA_CLOUDFRONT_DOMAIN?.trim();
  let urlOut: string | undefined;
  let key: string | undefined;

  if (bucket && cfDomain) {
    const ext =
      outMime.includes("jpeg") || outMime.includes("jpg") ? "jpg" : "png";
    key = `ideate/vision/${userId}/${randomUUID()}.${ext}`;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: outBuf,
          ContentType: outMime,
        }),
      );
      urlOut = `https://${cfDomain}/${key}`;
    } catch (e) {
      console.error("vision-generate S3", e);
      /* still return base64 */
    }
  }

  return json(200, {
    imageBase64: outB64,
    mimeType: outMime,
    prompt,
    ...(urlOut && key ? { url: urlOut, key } : {}),
    model,
  });
}
