/**
 * Dashboard daily habit status + play events + manual day checks.
 *
 * GET  /dashboard/daily-status?dateKey=YYYY-MM-DD&tzOffsetMinutes=
 * PUT  /dashboard/daily-status  { dateKey, pillar, checked }
 * POST /dashboard/play-events   { type, meditationId?, at?, seconds?, dateKey? }
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
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { requireUserJson } from "../lib/medimade-auth-http";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const SK_STORE = "STORE";
const SK_META = "META";

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
      "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Medimade-Authorization",
      "Access-Control-Max-Age": "86400",
    },
    body: "",
  };
}

type DayRecord = {
  pk: string;
  sk: string;
  playStartedAt?: string;
  playProgress60At?: string;
  meditationId?: string;
  manualGratitude?: boolean;
  manualMeditation?: boolean;
  manualLifeArea?: boolean;
  updatedAt?: string;
};

function daySk(dateKey: string): string {
  return `DAY#${dateKey}`;
}

function parseDateKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return t;
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split("-").map((x) => Number(x));
  const utc = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  const dt = new Date(utc);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Map ISO timestamp → local calendar date using client tz offset (minutes, Date.getTimezoneOffset). */
function dateKeyFromIso(iso: string, tzOffsetMinutes: number): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const local = new Date(ms - tzOffsetMinutes * 60_000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
}

async function queryAllPk(
  table: string,
  ownerId: string,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :p",
        ExpressionAttributeValues: { ":p": ownerId },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    );
    for (const it of r.Items ?? []) items.push(it as Record<string, unknown>);
    startKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);
  return items;
}

function gratitudeDaysFromJournal(
  items: Record<string, unknown>[],
  tzOffsetMinutes: number,
): Set<string> {
  const days = new Set<string>();
  for (const item of items) {
    const sk = item.sk;
    if (typeof sk !== "string" || !sk.startsWith("ENTRY#")) continue;
    if (item.kind !== "gratitude") continue;
    const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
    const key = dateKeyFromIso(createdAt, tzOffsetMinutes);
    if (key) days.add(key);
  }
  return days;
}

function lifeAreaDaysFromIdeate(
  storeRaw: unknown,
  tzOffsetMinutes: number,
): Set<string> {
  const days = new Set<string>();
  if (!storeRaw || typeof storeRaw !== "object") return days;
  const bundle = storeRaw as Record<string, unknown>;
  const ideate = bundle.ideate;
  if (!ideate || typeof ideate !== "object") return days;
  const o = ideate as Record<string, unknown>;

  const mark = (iso: unknown) => {
    if (typeof iso !== "string") return;
    const key = dateKeyFromIso(iso, tzOffsetMinutes);
    if (key) days.add(key);
  };

  for (const todo of Array.isArray(o.todos) ? o.todos : []) {
    if (!todo || typeof todo !== "object") continue;
    const t = todo as Record<string, unknown>;
    if (t.isChecked === true) mark(t.checkedAt);
  }
  for (const sub of Array.isArray(o.subtasks) ? o.subtasks : []) {
    if (!sub || typeof sub !== "object") continue;
    mark((sub as Record<string, unknown>).completedAt);
  }
  for (const dream of Array.isArray(o.dreams) ? o.dreams : []) {
    if (!dream || typeof dream !== "object") continue;
    const d = dream as Record<string, unknown>;
    for (const listName of ["dreamEntries", "obstacleEntries", "visionEntries"] as const) {
      const list = d[listName];
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        mark((entry as Record<string, unknown>).createdAt);
      }
    }
  }
  return days;
}

function habitsByDate(items: Record<string, unknown>[]): Map<string, DayRecord> {
  const map = new Map<string, DayRecord>();
  for (const item of items) {
    const sk = item.sk;
    if (typeof sk !== "string" || !sk.startsWith("DAY#")) continue;
    const dateKey = sk.slice("DAY#".length);
    map.set(dateKey, item as DayRecord);
  }
  return map;
}

function dayFlags(
  dateKey: string,
  gratitudeDays: Set<string>,
  lifeAreaDays: Set<string>,
  habits: Map<string, DayRecord>,
): { gratitude: boolean; meditation: boolean; lifeArea: boolean } {
  const day = habits.get(dateKey);
  return {
    gratitude: Boolean(day?.manualGratitude) || gratitudeDays.has(dateKey),
    meditation:
      Boolean(day?.manualMeditation) || Boolean(day?.playProgress60At),
    lifeArea: Boolean(day?.manualLifeArea) || lifeAreaDays.has(dateKey),
  };
}

function isComplete(flags: {
  gratitude: boolean;
  meditation: boolean;
  lifeArea: boolean;
}): boolean {
  return flags.gratitude && flags.meditation && flags.lifeArea;
}

function isPartial(flags: {
  gratitude: boolean;
  meditation: boolean;
  lifeArea: boolean;
}): boolean {
  return flags.gratitude || flags.meditation || flags.lifeArea;
}

type DayPredicate = (flags: {
  gratitude: boolean;
  meditation: boolean;
  lifeArea: boolean;
}) => boolean;

/** Consecutive qualifying days ending yesterday if today does not qualify, else including today. */
function computeStreak(
  todayKey: string,
  gratitudeDays: Set<string>,
  lifeAreaDays: Set<string>,
  habits: Map<string, DayRecord>,
  predicate: DayPredicate,
): number {
  let cursor = todayKey;
  if (!predicate(dayFlags(cursor, gratitudeDays, lifeAreaDays, habits))) {
    cursor = shiftDateKey(todayKey, -1);
  }
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    if (!predicate(dayFlags(cursor, gratitudeDays, lifeAreaDays, habits))) {
      break;
    }
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
}

/** Longest consecutive run in the trailing window (includes broken streaks). */
function computeRecord(
  todayKey: string,
  gratitudeDays: Set<string>,
  lifeAreaDays: Set<string>,
  habits: Map<string, DayRecord>,
  predicate: DayPredicate,
  windowDays = 730,
): number {
  let best = 0;
  let run = 0;
  const start = shiftDateKey(todayKey, -(windowDays - 1));
  for (let i = 0; i < windowDays; i++) {
    const key = shiftDateKey(start, i);
    if (predicate(dayFlags(key, gratitudeDays, lifeAreaDays, habits))) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

async function loadDay(
  table: string,
  ownerId: string,
  dateKey: string,
): Promise<DayRecord | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: table,
      Key: { pk: ownerId, sk: daySk(dateKey) },
    }),
  );
  return (out.Item as DayRecord | undefined) ?? null;
}

async function putDay(table: string, record: DayRecord): Promise<void> {
  await ddb.send(
    new PutCommand({
      TableName: table,
      Item: { ...record, updatedAt: new Date().toISOString() },
    }),
  );
}

function routePath(event: APIGatewayProxyEventV2): string {
  const raw =
    event.rawPath ||
    event.requestContext.http.path ||
    "";
  return raw.replace(/\/+$/, "") || "/";
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const method = event.requestContext.http.method;
  if (method === "OPTIONS") return options();

  const habitsTable = process.env.HABITS_TABLE_NAME?.trim();
  const journalTable = process.env.JOURNAL_TABLE_NAME?.trim();
  const ideateTable = process.env.IDEATE_TABLE_NAME?.trim();
  if (!habitsTable || !journalTable || !ideateTable) {
    return json(500, { error: "Daily status tables are not configured" });
  }

  const path = routePath(event);
  const isPlayEvents = path.endsWith("/dashboard/play-events");
  const isDailyStatus =
    path.endsWith("/dashboard/daily-status") ||
    path.endsWith("/api/dashboard/daily-status");

  if (!isPlayEvents && !isDailyStatus) {
    return json(404, { error: "Not found" });
  }

  if (method === "GET" && isDailyStatus) {
    const auth = await requireUserJson(event);
    if ("statusCode" in auth) return auth;
    const ownerId = (auth as { sub: string }).sub.trim();

    const qs = event.queryStringParameters ?? {};
    const todayKey =
      parseDateKey(qs.dateKey) ??
      new Date().toISOString().slice(0, 10);
    const tzRaw = Number(qs.tzOffsetMinutes);
    const tzOffsetMinutes = Number.isFinite(tzRaw) ? tzRaw : 0;

    try {
      const [journalItems, habitsItems, ideateOut] = await Promise.all([
        queryAllPk(journalTable, ownerId),
        queryAllPk(habitsTable, ownerId),
        ddb.send(
          new GetCommand({
            TableName: ideateTable,
            Key: { pk: ownerId, sk: SK_STORE },
          }),
        ),
      ]);

      const gratitudeDays = gratitudeDaysFromJournal(
        journalItems.filter((i) => i.sk !== SK_META),
        tzOffsetMinutes,
      );
      const lifeAreaDays = lifeAreaDaysFromIdeate(
        (ideateOut.Item as { store?: unknown } | undefined)?.store,
        tzOffsetMinutes,
      );
      const habits = habitsByDate(habitsItems);
      const flags = dayFlags(todayKey, gratitudeDays, lifeAreaDays, habits);
      const fullStreak = computeStreak(
        todayKey,
        gratitudeDays,
        lifeAreaDays,
        habits,
        isComplete,
      );
      const partialStreak = computeStreak(
        todayKey,
        gratitudeDays,
        lifeAreaDays,
        habits,
        isPartial,
      );
      const fullStreakRecord = computeRecord(
        todayKey,
        gratitudeDays,
        lifeAreaDays,
        habits,
        isComplete,
      );
      const partialStreakRecord = computeRecord(
        todayKey,
        gratitudeDays,
        lifeAreaDays,
        habits,
        isPartial,
      );

      return json(200, {
        gratitude: flags.gratitude,
        meditation: flags.meditation,
        lifeArea: flags.lifeArea,
        // Legacy alias — full (all three) streak.
        streak: fullStreak,
        fullStreak,
        partialStreak,
        fullStreakRecord,
        partialStreakRecord,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load daily status";
      return json(500, { error: msg });
    }
  }

  if (method === "PUT" && isDailyStatus) {
    const auth = await requireUserJson(event);
    if ("statusCode" in auth) return auth;
    const ownerId = (auth as { sub: string }).sub.trim();

    let bodyRaw = event.body ?? "";
    if (event.isBase64Encoded && bodyRaw) {
      bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyRaw || "{}") as Record<string, unknown>;
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const dateKey = parseDateKey(body.dateKey);
    const pillar = body.pillar;
    const checked = body.checked === true;
    if (!dateKey) return json(400, { error: "`dateKey` YYYY-MM-DD required" });
    if (
      pillar !== "gratitude" &&
      pillar !== "meditation" &&
      pillar !== "lifeArea"
    ) {
      return json(400, { error: "`pillar` must be gratitude|meditation|lifeArea" });
    }

    try {
      const existing = (await loadDay(habitsTable, ownerId, dateKey)) ?? {
        pk: ownerId,
        sk: daySk(dateKey),
      };
      const next: DayRecord = { ...existing, pk: ownerId, sk: daySk(dateKey) };
      if (pillar === "gratitude") next.manualGratitude = checked || undefined;
      if (pillar === "meditation") next.manualMeditation = checked || undefined;
      if (pillar === "lifeArea") next.manualLifeArea = checked || undefined;
      if (!checked) {
        if (pillar === "gratitude") delete next.manualGratitude;
        if (pillar === "meditation") delete next.manualMeditation;
        if (pillar === "lifeArea") delete next.manualLifeArea;
      }
      await putDay(habitsTable, next);
      return json(200, { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to save manual check";
      return json(500, { error: msg });
    }
  }

  if (method === "POST" && isPlayEvents) {
    const auth = await requireUserJson(event);
    if ("statusCode" in auth) return auth;
    const ownerId = (auth as { sub: string }).sub.trim();

    let bodyRaw = event.body ?? "";
    if (event.isBase64Encoded && bodyRaw) {
      bodyRaw = Buffer.from(bodyRaw, "base64").toString("utf-8");
    }
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(bodyRaw || "{}") as Record<string, unknown>;
    } catch {
      return json(400, { error: "Invalid JSON body" });
    }

    const type = body.type;
    if (type !== "play_started" && type !== "play_progress") {
      return json(400, { error: "`type` must be play_started|play_progress" });
    }
    const at =
      typeof body.at === "string" && body.at.trim()
        ? body.at.trim()
        : new Date().toISOString();
    const dateKey =
      parseDateKey(body.dateKey) ??
      (dateKeyFromIso(at, Number(body.tzOffsetMinutes) || 0) ||
        new Date().toISOString().slice(0, 10));
    const meditationId =
      typeof body.meditationId === "string"
        ? body.meditationId.slice(0, 200)
        : undefined;
    try {
      const existing = (await loadDay(habitsTable, ownerId, dateKey)) ?? {
        pk: ownerId,
        sk: daySk(dateKey),
      };
      const next: DayRecord = { ...existing, pk: ownerId, sk: daySk(dateKey) };
      if (meditationId) next.meditationId = meditationId;
      if (type === "play_started") {
        if (!next.playStartedAt) next.playStartedAt = at;
      } else {
        if (!next.playStartedAt) next.playStartedAt = at;
        if (!next.playProgress60At) next.playProgress60At = at;
      }
      await putDay(habitsTable, next);
      return json(200, { ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to log play event";
      return json(500, { error: msg });
    }
  }

  return json(405, { error: "Method not allowed" });
}
