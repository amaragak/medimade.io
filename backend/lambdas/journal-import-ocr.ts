import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import {
  DetectDocumentTextCommand,
  TextractClient,
} from "@aws-sdk/client-textract";
import { optionalUserJson } from "../lib/medimade-auth-http";

const textract = new TextractClient({});
const MAX_BYTES = 4_500_000;

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
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

function decodeImage(raw: string): Buffer | null {
  const trimmed = raw.trim().replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
  if (!trimmed) return null;
  try {
    const buf = Buffer.from(trimmed, "base64");
    return buf.length ? buf : null;
  } catch {
    return null;
  }
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method.toUpperCase();
  if (method === "OPTIONS") return options();
  if (method !== "POST") return json(405, { error: "Method not allowed" });

  let body: { imageBase64?: unknown; sessionToken?: string };
  try {
    body = JSON.parse(event.body || "{}") as {
      imageBase64?: unknown;
      sessionToken?: string;
    };
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );

  if (typeof body.imageBase64 !== "string") {
    return json(400, { error: "Field `imageBase64` is required" });
  }
  const bytes = decodeImage(body.imageBase64);
  if (!bytes) return json(400, { error: "Could not read that image." });
  if (bytes.length > MAX_BYTES) {
    return json(413, {
      error: "That photo is too large to read in one go. Try a closer crop.",
    });
  }

  let out;
  try {
    out = await textract.send(
      new DetectDocumentTextCommand({ Document: { Bytes: bytes } }),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Textract failed";
    return json(502, { error: "Could not read that photo.", detail: msg.slice(0, 800) });
  }

  const blocks = out.Blocks ?? [];
  const lines = blocks
    .filter((b) => b.BlockType === "LINE" && typeof b.Text === "string")
    .sort((a, b) => {
      const at = a.Geometry?.BoundingBox?.Top ?? 0;
      const bt = b.Geometry?.BoundingBox?.Top ?? 0;
      if (Math.abs(at - bt) > 0.015) return at - bt;
      return (a.Geometry?.BoundingBox?.Left ?? 0) - (b.Geometry?.BoundingBox?.Left ?? 0);
    });
  const text = lines
    .map((b) => (b.Text ?? "").trim())
    .filter(Boolean)
    .join("\n");

  const words: Array<{ text: string; confidence: number | null }> = [];
  for (const b of blocks) {
    if (b.BlockType !== "WORD" || typeof b.Text !== "string") continue;
    const t = b.Text.trim();
    if (!t) continue;
    words.push({
      text: t,
      confidence: typeof b.Confidence === "number" ? b.Confidence : null,
    });
  }

  return json(200, {
    engine: "textract",
    text,
    words,
  });
}
