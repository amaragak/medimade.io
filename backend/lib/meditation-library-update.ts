import {
  DynamoDBDocumentClient,
  UpdateCommand,
  type UpdateCommandInput,
} from "@aws-sdk/lib-dynamodb";

/**
 * Runs `UpdateCommand` against the first partition key where the row exists
 * (`ConditionExpression` satisfied). Used so PATCH hits either the caller’s
 * `USER#<id>` row or a shared `USER#_` / legacy `meditation` row.
 */
export async function updateMeditationRowFirstMatchingPartition(params: {
  ddb: DynamoDBDocumentClient;
  tableName: string;
  partitionKeys: string[];
  sk: string;
  update: Omit<UpdateCommandInput, "TableName" | "Key">;
}): Promise<boolean> {
  const { ddb, tableName, partitionKeys, sk, update } = params;
  for (const pk of partitionKeys) {
    try {
      await ddb.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk, sk },
          ...update,
        }),
      );
      return true;
    } catch (e: unknown) {
      const name =
        e && typeof e === "object" && "name" in e
          ? String((e as { name: string }).name)
          : "";
      if (name === "ConditionalCheckFailedException") continue;
      throw e;
    }
  }
  return false;
}
