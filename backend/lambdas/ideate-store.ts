/**
 * Cloud Ideate store — dreams / vision board metadata / reflection questions.
 * Mirror journal: GET optional (null for guests), PUT requires JWT.
 */

import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { optionalUserJson, requireUserJson } from "../lib/medimade-auth-http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const SK_STORE = "STORE";
/** DynamoDB item limit is 400 KB; leave margin. */
const MAX_STORE_BYTES = 350 * 1024;

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
      "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Medimade-Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

type IdeateCloudBundle = {
  version: 1;
  updatedAt: string;
  ideate: unknown;
  visionBoard: unknown;
  reflectionQuestions: unknown;
};

function isBundle(x: unknown): x is IdeateCloudBundle {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return o.version === 1 && typeof o.updatedAt === "string";
}

function stripDemoDreams(ideate: unknown): unknown {
  if (!ideate || typeof ideate !== "object") return ideate;
  const o = ideate as Record<string, unknown>;
  const dreams = Array.isArray(o.dreams) ? o.dreams : [];
  const kept = dreams.filter((d) => {
    if (!d || typeof d !== "object") return false;
    const r = d as Record<string, unknown>;
    if (r.demo === true) return false;
    if (typeof r.id === "string" && r.id.startsWith("demo-ideate-")) return false;
    return true;
  });
  const keepIds = new Set(
    kept
      .map((d) =>
        d && typeof d === "object" && typeof (d as { id?: unknown }).id === "string"
          ? (d as { id: string }).id
          : null,
      )
      .filter((id): id is string => Boolean(id)),
  );
  const subtasks = Array.isArray(o.subtasks)
    ? o.subtasks.filter(
        (s) =>
          s &&
          typeof s === "object" &&
          keepIds.has(String((s as { projectId?: unknown }).projectId ?? "")),
      )
    : [];
  const subIds = new Set(
    subtasks
      .map((s) =>
        s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string"
          ? (s as { id: string }).id
          : null,
      )
      .filter((id): id is string => Boolean(id)),
  );
  const todos = Array.isArray(o.todos)
    ? o.todos.filter(
        (t) =>
          t &&
          typeof t === "object" &&
          subIds.has(String((t as { subtaskId?: unknown }).subtaskId ?? "")),
      )
    : [];
  const resistanceEntries = Array.isArray(o.resistanceEntries)
    ? o.resistanceEntries.filter(
        (r) =>
          r &&
          typeof r === "object" &&
          keepIds.has(String((r as { projectId?: unknown }).projectId ?? "")),
      )
    : [];
  return {
    ...o,
    v: 2,
    dreams: kept.slice(0, 200),
    subtasks: subtasks.slice(0, 500),
    todos: todos.slice(0, 2000),
    resistanceEntries: resistanceEntries.slice(0, 1000),
  };
}

function stripDemoVision(vision: unknown): unknown {
  if (!vision || typeof vision !== "object") return { v: 2, items: [], selfReference: null };
  const o = vision as Record<string, unknown>;
  const items = Array.isArray(o.items)
    ? o.items.filter((i) => {
        if (!i || typeof i !== "object") return false;
        const id = (i as { id?: unknown }).id;
        return typeof id === "string" && !id.startsWith("demo-vb-") && !id.startsWith("demo-");
      })
    : [];
  let selfReference = o.selfReference ?? null;
  if (selfReference && typeof selfReference === "object") {
    const mid = (selfReference as { mediaId?: unknown }).mediaId;
    if (typeof mid === "string" && mid.startsWith("demo-")) selfReference = null;
  }
  return { v: 2, items: items.slice(0, 48), selfReference };
}

function stripDemoQuestions(qs: unknown): unknown {
  if (!qs || typeof qs !== "object") return { v: 1, questions: [] };
  const o = qs as Record<string, unknown>;
  const questions = Array.isArray(o.questions)
    ? o.questions.filter((q) => {
        if (!q || typeof q !== "object") return false;
        const id = (q as { id?: unknown }).id;
        return typeof id === "string" && !id.startsWith("demo-rq-");
      })
    : [];
  return { v: 1, questions: questions.slice(0, 50) };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();

  const table = process.env.IDEATE_TABLE_NAME?.trim();
  if (!table) return json(500, { error: "IDEATE_TABLE_NAME is not set" });

  if (method === "GET") {
    const auth = await optionalUserJson(event, null);
    if (!auth?.sub) {
      return json(200, { store: null });
    }
    const ownerId = auth.sub.trim();
    try {
      const out = await ddb.send(
        new GetCommand({
          TableName: table,
          Key: { pk: ownerId, sk: SK_STORE },
        }),
      );
      const row = out.Item as { store?: unknown } | undefined;
      if (!row?.store || !isBundle(row.store)) {
        return json(200, { store: null });
      }
      return json(200, { store: row.store });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DynamoDB read failed";
      return json(500, { error: msg });
    }
  }

  if (method === "PUT") {
    const auth = await requireUserJson(event);
    if ("statusCode" in auth) return auth;
    const ownerId = (auth as { sub: string }).sub.trim();

    let bodyRaw = event.body ?? "";
    if (event.isBase64Encoded && bodyRaw) {
      bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
    }
    if (Buffer.byteLength(bodyRaw, "utf8") > MAX_STORE_BYTES) {
      return json(413, {
        error: `Ideate store exceeds max size (${MAX_STORE_BYTES} bytes)`,
      });
    }

    let body: { store?: unknown };
    try {
      body = JSON.parse(bodyRaw || "{}") as { store?: unknown };
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const incoming = body.store;
    if (!incoming || typeof incoming !== "object") {
      return json(400, { error: "`store` object is required" });
    }
    const o = incoming as Record<string, unknown>;
    const bundle: IdeateCloudBundle = {
      version: 1,
      updatedAt:
        typeof o.updatedAt === "string" && o.updatedAt.trim()
          ? o.updatedAt.trim()
          : new Date().toISOString(),
      ideate: stripDemoDreams(o.ideate),
      visionBoard: stripDemoVision(o.visionBoard),
      reflectionQuestions: stripDemoQuestions(o.reflectionQuestions),
    };

    const encoded = JSON.stringify(bundle);
    if (Buffer.byteLength(encoded, "utf8") > MAX_STORE_BYTES) {
      return json(413, {
        error: `Ideate store exceeds max size (${MAX_STORE_BYTES} bytes)`,
      });
    }

    try {
      await ddb.send(
        new PutCommand({
          TableName: table,
          Item: {
            pk: ownerId,
            sk: SK_STORE,
            store: bundle,
            updatedAt: bundle.updatedAt,
          },
        }),
      );
      return json(200, { ok: true, store: bundle });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "DynamoDB write failed";
      return json(500, { error: msg });
    }
  }

  return json(405, { error: "Method not allowed" });
}
