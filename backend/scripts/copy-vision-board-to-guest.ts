/**
 * One-shot: copy visionBoard from a real account onto guest@consciously.live.
 * Dynamo STORE only — media stays on the source user's S3 keys (public CF URLs).
 * Guest's previous visionBoard JSON is replaced; other Ideate fields are kept.
 *
 *   AWS_PROFILE=mm npx tsx scripts/copy-vision-board-to-guest.ts
 *   AWS_PROFILE=mm npx tsx scripts/copy-vision-board-to-guest.ts --dry-run
 *   AWS_PROFILE=mm npx tsx scripts/copy-vision-board-to-guest.ts --from you@example.com
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { GUEST_ACCOUNT_EMAIL } from "../lambdas/auth-guest";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const dryRun = process.argv.includes("--dry-run");
const fromFlag = process.argv.indexOf("--from");
const SOURCE_EMAIL =
  (fromFlag >= 0 ? process.argv[fromFlag + 1] : undefined)?.trim() ||
  "alexmaragakis@hotmail.co.uk";

const USERS =
  process.env.USERS_TABLE_NAME?.trim() ||
  "MedimadeBackend-MedimadeUsersTable56DCE6C2-1AXT1LLLN1H4S";
const IDEATE =
  process.env.IDEATE_TABLE_NAME?.trim() ||
  "MedimadeBackend-IdeateTable6FC78D26-M84L0GZB3VFS";

const SK_STORE = "STORE";

async function userIdForEmail(email: string): Promise<string> {
  const out = await ddb.send(
    new GetCommand({
      TableName: USERS,
      Key: { email: email.trim().toLowerCase() },
    }),
  );
  const id = out.Item?.userId;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`No userId for ${email}`);
  }
  return id.trim();
}

async function getStore(userId: string): Promise<Record<string, unknown> | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: IDEATE,
      Key: { pk: userId, sk: SK_STORE },
    }),
  );
  const store = out.Item?.store;
  if (!store || typeof store !== "object") return null;
  return store as Record<string, unknown>;
}

function visionSummary(vb: unknown): string {
  if (!vb || typeof vb !== "object") return "(none)";
  const o = vb as {
    items?: unknown[];
    selfReference?: unknown;
    extraReferences?: unknown[];
  };
  const items = Array.isArray(o.items) ? o.items.length : 0;
  const self = o.selfReference ? "yes" : "no";
  const extra = Array.isArray(o.extraReferences) ? o.extraReferences.length : 0;
  return `${items} items, self=${self}, extra=${extra}`;
}

async function main() {
  console.log(
    dryRun ? "[dry-run]" : "[live]",
    `copy visionBoard ${SOURCE_EMAIL} → ${GUEST_ACCOUNT_EMAIL}`,
  );

  const sourceId = await userIdForEmail(SOURCE_EMAIL);
  const guestId = await userIdForEmail(GUEST_ACCOUNT_EMAIL);
  console.log("source userId:", sourceId);
  console.log("guest userId:", guestId);

  const sourceStore = await getStore(sourceId);
  if (!sourceStore) {
    throw new Error(`No Ideate STORE for ${SOURCE_EMAIL}`);
  }
  const visionBoard = sourceStore.visionBoard;
  if (visionBoard == null) {
    throw new Error(`No visionBoard on ${SOURCE_EMAIL}`);
  }
  console.log("source visionBoard:", visionSummary(visionBoard));

  const guestStore = await getStore(guestId);
  console.log(
    "guest visionBoard (before):",
    visionSummary(guestStore?.visionBoard),
  );

  const now = new Date().toISOString();
  const nextStore: Record<string, unknown> = guestStore
    ? {
        ...guestStore,
        version: 1,
        updatedAt: now,
        visionBoard,
      }
    : {
        version: 1,
        updatedAt: now,
        ideate: {
          v: 2,
          dreams: [],
          subtasks: [],
          todos: [],
          resistanceEntries: [],
        },
        visionBoard,
        reflectionQuestions: { v: 1, questions: [] },
        values: { v: 1, values: [] },
        regrets: { v: 1, regrets: [] },
        quotes: { v: 1, quotes: [] },
        manifesto: { v: 1, text: "", updatedAt: now },
      };

  if (dryRun) {
    console.log("Would write guest STORE with visionBoard:", visionSummary(visionBoard));
    return;
  }

  await ddb.send(
    new PutCommand({
      TableName: IDEATE,
      Item: {
        pk: guestId,
        sk: SK_STORE,
        store: nextStore,
        updatedAt: now,
      },
    }),
  );
  console.log("Wrote guest STORE. visionBoard:", visionSummary(visionBoard));
  console.log(
    "Note: image URLs still point at source S3 keys (no media copy). Guest edits only update guest Dynamo.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
