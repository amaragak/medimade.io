/**
 * Moves pre–per-user library rows from DynamoDB pk `meditation` → `USER#_`
 * (`GLOBAL_MEDITATION_USER_ID`), and backfills `userId = "_"` on meditation jobs
 * that have no `userId` (so workers and GET job treat them as shared).
 *
 * Run once per environment after deploying auth. Safe to re-run: skips rows that
 * already exist under `USER#_` with the same sort key.
 *
 *   export MEDITATION_ANALYTICS_TABLE_NAME=…
 *   export MEDITATION_JOBS_TABLE_NAME=…   # optional; omit to skip jobs
 *   npm run migrate-meditation-legacy-partition -- --dry-run
 *   npm run migrate-meditation-legacy-partition
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  GLOBAL_MEDITATION_USER_ID,
  LEGACY_MEDITATION_PARTITION_PK,
  meditationGlobalUserPk,
} from "../lib/meditation-user-pk";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const destPk = meditationGlobalUserPk();
const dryRun = process.argv.includes("--dry-run");

async function migrateAnalyticsTable(tableName: string): Promise<number> {
  let migrated = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": LEGACY_MEDITATION_PARTITION_PK },
        ExclusiveStartKey: startKey,
      }),
    );
    const items = page.Items ?? [];
    for (const raw of items) {
      const item = raw as Record<string, unknown>;
      const sk = typeof item.sk === "string" ? item.sk : "";
      if (!sk) continue;

      const existing = await ddb.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk: destPk, sk },
        }),
      );
      if (existing.Item) {
        if (dryRun) {
          console.log("[dry-run] would delete legacy duplicate", sk);
        } else {
          await ddb.send(
            new DeleteCommand({
              TableName: tableName,
              Key: { pk: LEGACY_MEDITATION_PARTITION_PK, sk },
            }),
          );
        }
        console.warn("[heal] removed legacy row; dest already had", sk);
        continue;
      }

      const newItem = { ...item, pk: destPk };
      if (dryRun) {
        console.log("[dry-run] would migrate", sk);
        migrated += 1;
        continue;
      }

      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            { Put: { TableName: tableName, Item: newItem } },
            {
              Delete: {
                TableName: tableName,
                Key: { pk: LEGACY_MEDITATION_PARTITION_PK, sk },
              },
            },
          ],
        }),
      );
      migrated += 1;
      console.log("[ok]", sk);
    }
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return migrated;
}

async function migrateJobsTable(tableName: string): Promise<number> {
  let updated = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "attribute_not_exists(userId)",
        ProjectionExpression: "jobId",
        ExclusiveStartKey: startKey,
      }),
    );
    for (const raw of page.Items ?? []) {
      const jobId = typeof raw.jobId === "string" ? raw.jobId : "";
      if (!jobId) continue;
      if (dryRun) {
        console.log("[dry-run] would set userId on job", jobId);
        updated += 1;
        continue;
      }
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { jobId },
            UpdateExpression: "SET userId = :u",
            ExpressionAttributeValues: { ":u": GLOBAL_MEDITATION_USER_ID },
            ConditionExpression: "attribute_not_exists(userId)",
          }),
        );
        updated += 1;
        console.log("[job]", jobId);
      } catch (e: unknown) {
        const name =
          e && typeof e === "object" && "name" in e
            ? String((e as { name: string }).name)
            : "";
        if (name === "ConditionalCheckFailedException") continue;
        throw e;
      }
    }
    startKey = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return updated;
}

async function main(): Promise<void> {
  const analytics = process.env.MEDITATION_ANALYTICS_TABLE_NAME?.trim();
  const jobs = process.env.MEDITATION_JOBS_TABLE_NAME?.trim();
  if (!analytics) {
    throw new Error("Set MEDITATION_ANALYTICS_TABLE_NAME");
  }
  console.log(
    dryRun ? "DRY RUN — no writes" : "LIVE — writing",
    "\nlegacy pk:",
    LEGACY_MEDITATION_PARTITION_PK,
    "→",
    destPk,
  );
  const nLib = await migrateAnalyticsTable(analytics);
  console.log("Library rows migrated:", nLib);
  if (jobs) {
    const nJobs = await migrateJobsTable(jobs);
    console.log("Jobs updated:", nJobs);
  } else {
    console.log("Skip jobs (MEDITATION_JOBS_TABLE_NAME unset)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
