/** Shared library / analytics partition for pre-auth and migrated legacy rows. */
export const GLOBAL_MEDITATION_USER_ID = "_";

/** Legacy single-partition key before per-user `USER#…` rows. */
export const LEGACY_MEDITATION_PARTITION_PK = "meditation";

/** DynamoDB partition key for per-user library / analytics rows in the shared table. */
export function meditationUserPk(userId: string): string {
  const u = userId.trim();
  if (!u) throw new Error("empty user id");
  return `USER#${u}`;
}

export function meditationGlobalUserPk(): string {
  return meditationUserPk(GLOBAL_MEDITATION_USER_ID);
}
