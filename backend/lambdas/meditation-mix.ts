import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { optionalUserJson } from "../lib/medimade-auth-http";
import { updateMeditationRowFirstMatchingPartition } from "../lib/meditation-library-update";
import {
  mixListenerPk,
  mixOverrideSk,
} from "../lib/meditation-listener-mix";
import {
  LEGACY_MEDITATION_PARTITION_PK,
  meditationGlobalUserPk,
  meditationUserPk,
} from "../lib/meditation-user-pk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

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

function optKey(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optGain(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(100, Math.max(0, v));
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  if (event.requestContext.http.method !== "PATCH") {
    return json(405, { error: "Method not allowed" });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}") as Record<string, unknown>;
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const auth = await optionalUserJson(
    event,
    typeof body.sessionToken === "string" ? body.sessionToken : null,
  );
  const partitionKeys = auth?.sub
    ? [
        meditationUserPk(auth.sub),
        meditationGlobalUserPk(),
        LEGACY_MEDITATION_PARTITION_PK,
      ]
    : [meditationGlobalUserPk(), LEGACY_MEDITATION_PARTITION_PK];

  const tableName = process.env.MEDITATION_ANALYTICS_TABLE_NAME;
  if (!tableName) {
    return json(500, { error: "MEDITATION_ANALYTICS_TABLE_NAME is not set" });
  }

  const sk = typeof body.sk === "string" ? body.sk.trim() : "";
  if (!sk) {
    return json(400, { error: "`sk` (sort key from library item) is required" });
  }

  const backgroundNatureKey = optKey(body.backgroundNatureKey);
  const backgroundMusicKey = optKey(body.backgroundMusicKey);
  const backgroundDrumsKey = optKey(body.backgroundDrumsKey);
  const backgroundNoiseKey = optKey(body.backgroundNoiseKey);
  const backgroundNatureGain = optGain(body.backgroundNatureGain, 25);
  const backgroundMusicGain = optGain(body.backgroundMusicGain, 50);
  const backgroundDrumsGain = optGain(body.backgroundDrumsGain, 40);
  const backgroundNoiseGain = optGain(body.backgroundNoiseGain, 10);

  const mixFields = {
    liveMix: true,
    backgroundNatureKey,
    backgroundMusicKey,
    backgroundDrumsKey,
    backgroundNoiseKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundDrumsGain,
    backgroundNoiseGain,
  };

  const community =
    body.community === true ||
    body.community === "1" ||
    body.listenerMix === true;

  if (community) {
    const mixTable = process.env.MEDITATION_LISTENER_MIX_TABLE_NAME;
    if (!mixTable) {
      return json(500, { error: "MEDITATION_LISTENER_MIX_TABLE_NAME is not set" });
    }
    const s3Key = optKey(body.s3Key);
    if (!s3Key) {
      return json(400, { error: "`s3Key` is required for a listener mix" });
    }
    const pk = mixListenerPk({
      userSub: auth?.sub,
      guestListenerId: body.listenerId,
    });
    if (!pk) {
      return json(400, {
        error: "Sign in or pass a `listenerId` to save a personal mix",
      });
    }
    try {
      await ddb.send(
        new PutCommand({
          TableName: mixTable,
          Item: {
            pk,
            sk: mixOverrideSk(s3Key),
            s3Key,
            meditationSk: sk,
            updatedAt: new Date().toISOString(),
            ...mixFields,
          },
        }),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      return json(500, { error: msg });
    }
    return json(200, { ok: true, listenerMix: true, ...mixFields });
  }

  try {
    const ok = await updateMeditationRowFirstMatchingPartition({
      ddb,
      tableName,
      partitionKeys,
      sk,
      update: {
        UpdateExpression:
          "SET liveMix = :lm, backgroundNatureKey = :nk, backgroundMusicKey = :mk, backgroundDrumsKey = :dk, backgroundNoiseKey = :zk, backgroundNatureGain = :ng, backgroundMusicGain = :mg, backgroundDrumsGain = :dg, backgroundNoiseGain = :zg, createdBackgroundNatureKey = if_not_exists(createdBackgroundNatureKey, backgroundNatureKey), createdBackgroundMusicKey = if_not_exists(createdBackgroundMusicKey, backgroundMusicKey), createdBackgroundDrumsKey = if_not_exists(createdBackgroundDrumsKey, backgroundDrumsKey), createdBackgroundNoiseKey = if_not_exists(createdBackgroundNoiseKey, backgroundNoiseKey), createdBackgroundNatureGain = if_not_exists(createdBackgroundNatureGain, backgroundNatureGain), createdBackgroundMusicGain = if_not_exists(createdBackgroundMusicGain, backgroundMusicGain), createdBackgroundDrumsGain = if_not_exists(createdBackgroundDrumsGain, backgroundDrumsGain), createdBackgroundNoiseGain = if_not_exists(createdBackgroundNoiseGain, backgroundNoiseGain)",
        ExpressionAttributeValues: {
          ":lm": true,
          ":nk": backgroundNatureKey,
          ":mk": backgroundMusicKey,
          ":dk": backgroundDrumsKey,
          ":zk": backgroundNoiseKey,
          ":ng": backgroundNatureGain,
          ":mg": backgroundMusicGain,
          ":dg": backgroundDrumsGain,
          ":zg": backgroundNoiseGain,
        },
        ConditionExpression: "attribute_exists(s3Key)",
      },
    });
    if (!ok) {
      return json(404, { error: "Meditation not found" });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Update failed";
    return json(500, { error: msg });
  }

  return json(200, { ok: true, ...mixFields });
}
