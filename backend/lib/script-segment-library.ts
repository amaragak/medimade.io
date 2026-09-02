import { randomUUID } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  isValidScriptSegmentTag,
  normalizeScriptSegmentTag,
  coerceStoredSegmentRepeatability,
  effectiveSegmentRepeatability,
  type ScriptLengthTier,
  type ScriptSegmentRepeatability,
  type ScriptSegmentScope,
} from "./script-segment-tags";
import { coerceConstraintTagList } from "./script-constraint-tags";
import { ensureConstraintVocabularyTags } from "./script-constraint-vocabulary";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/** One DynamoDB item per tag; variants and per-speaker audio nested inside. */
export const SCRIPT_SEGMENT_PK = "SCRIPT_SEGMENT";

/** Legacy partition keys — migrated on read when present. */
const LEGACY_TAG_PK = "SCRIPT_TAG";
const LEGACY_VARIANT_PK = "SCRIPT_VARIANT";
const LEGACY_VARIANT_AUDIO_PK = "SCRIPT_VARIANT_AUDIO";

export type ScriptSegmentAudioState = {
  status: "not_generated" | "generating" | "generated" | "failed";
  s3Key: string | null;
  durationMs: number | null;
  updatedAt: string;
};

export type ScriptSegmentVariant = {
  id: string;
  text: string;
  lengthTier: ScriptLengthTier | null;
  requiredConstraints: string[];
  excludedConstraints: string[];
  /** Body-tour / scan ordering hint (e.g. ascending, descending). */
  direction?: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
  audio: Record<string, ScriptSegmentAudioState>;
};

/** Identity / server-managed keys — not part of segment import field diff. */
const VARIANT_OWN_KEYS = new Set([
  "id",
  "variantId",
  "sort",
  "createdAt",
  "updatedAt",
  "audio",
]);

const VARIANT_KNOWN_KEYS = new Set([
  ...VARIANT_OWN_KEYS,
  "text",
  "lengthTier",
  "requiredConstraints",
  "excludedConstraints",
  "direction",
]);

export type ScriptSegmentDocument = {
  tag: string;
  scope: ScriptSegmentScope;
  types: string[];
  lengthTiered: boolean;
  /** Null until explicitly set via admin or import. */
  repeatability: ScriptSegmentRepeatability | null;
  description: string;
  variants: ScriptSegmentVariant[];
  createdAt: string;
  updatedAt: string;
};

/** Flattened row shapes returned to the admin API (derived from documents). */
export type ScriptSegmentTagRow = {
  name: string;
  scope: ScriptSegmentScope;
  types: string[];
  lengthTiered: boolean;
  /** Effective repeatability (stored value or inferred default). */
  repeatability: ScriptSegmentRepeatability;
  repeatabilityExplicit: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type ScriptSegmentVariantRow = {
  tagName: string;
  variantId: string;
  text: string;
  lengthTier: ScriptLengthTier | null;
  requiredConstraints: string[];
  excludedConstraints: string[];
  direction?: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

export type ScriptSegmentVariantAudioRow = {
  tagName: string;
  variantId: string;
  modelId: string;
  status: ScriptSegmentAudioState["status"];
  s3Key: string;
  durationSeconds: number;
  updatedAt: string;
};

function tableName(): string | null {
  const n = process.env.VOICE_ADMIN_TABLE_NAME?.trim();
  return n || null;
}

function requireTable(): string {
  const n = tableName();
  if (!n) throw new Error("VOICE_ADMIN_TABLE_NAME is not set");
  return n;
}

function coerceScope(raw: unknown): ScriptSegmentScope {
  if (raw === "types" || raw === "restricted") return "types";
  return "general";
}

function coerceLengthTier(raw: unknown): ScriptLengthTier | null {
  if (raw === "short" || raw === "medium" || raw === "long") return raw;
  return null;
}

function coerceTypes(raw: unknown): string[] {
  const parts =
    typeof raw === "string"
      ? raw.split(",")
      : Array.isArray(raw)
        ? raw.map((x) => (typeof x === "string" ? x : ""))
        : [];
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim().slice(0, 80);
    if (!t) continue;
    if (out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}

function emptyAudioState(): ScriptSegmentAudioState {
  return {
    status: "not_generated",
    s3Key: null,
    durationMs: null,
    updatedAt: "",
  };
}

function coerceAudioState(raw: unknown): ScriptSegmentAudioState {
  if (!raw || typeof raw !== "object") return emptyAudioState();
  const o = raw as Record<string, unknown>;
  const status =
    o.status === "generating" ||
    o.status === "generated" ||
    o.status === "failed" ||
    o.status === "not_generated"
      ? o.status
      : o.s3Key
        ? "generated"
        : "not_generated";
  return {
    status,
    s3Key: typeof o.s3Key === "string" ? o.s3Key : null,
    durationMs: typeof o.durationMs === "number" ? o.durationMs : null,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : "",
  };
}

function normalizeVariantConstraintFields(
  requiredConstraints: string[] | undefined,
  excludedConstraints: string[] | undefined,
): { requiredConstraints: string[]; excludedConstraints: string[] } {
  return {
    requiredConstraints: coerceConstraintTagList(requiredConstraints ?? []),
    excludedConstraints: coerceConstraintTagList(excludedConstraints ?? []),
  };
}

function coerceVariantDirection(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

function isImportableVariantFieldValue(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "string" || typeof val === "boolean" || typeof val === "number") {
    return true;
  }
  if (Array.isArray(val) && val.every((x) => typeof x === "string")) return true;
  return false;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

/** Build normalized import-field map from a variant JSON object (shared by validator + import). */
export function buildVariantImportFieldsFromJson(params: {
  raw: Record<string, unknown>;
  lengthTiered: boolean;
  text: string;
  lengthTier: ScriptLengthTier | null;
  requiredConstraints: string[];
  excludedConstraints: string[];
}): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    text: params.text,
    lengthTier: params.lengthTiered ? params.lengthTier : null,
    requiredConstraints: params.requiredConstraints,
    excludedConstraints: params.excludedConstraints,
  };
  if (params.raw.direction !== undefined) {
    fields.direction = coerceVariantDirection(params.raw.direction);
  }
  for (const [key, val] of Object.entries(params.raw)) {
    if (VARIANT_KNOWN_KEYS.has(key)) continue;
    if (isImportableVariantFieldValue(val)) fields[key] = val;
  }
  return fields;
}

function variantImportFieldsFromStored(variant: ScriptSegmentVariant): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(variant)) {
    if (VARIANT_OWN_KEYS.has(key)) continue;
    if (!isImportableVariantFieldValue(val)) continue;
    fields[key] = val;
  }
  return fields;
}

function normalizeImportFieldsForCompare(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...fields };
  if (Array.isArray(out.requiredConstraints)) {
    out.requiredConstraints = [...out.requiredConstraints].sort();
  }
  if (Array.isArray(out.excludedConstraints)) {
    out.excludedConstraints = [...out.excludedConstraints].sort();
  }
  return out;
}

function variantImportFieldsEqual(
  stored: ScriptSegmentVariant,
  incoming: Record<string, unknown>,
): boolean {
  const storedFields = normalizeImportFieldsForCompare(variantImportFieldsFromStored(stored));
  const incomingFields = normalizeImportFieldsForCompare(incoming);
  const keys = new Set([...Object.keys(storedFields), ...Object.keys(incomingFields)]);
  for (const key of keys) {
    const a = storedFields[key];
    const b = incomingFields[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (!arraysEqual(a as string[], b as string[])) return false;
      continue;
    }
    if (a !== b) return false;
  }
  return true;
}

function resetVariantAudio(variant: ScriptSegmentVariant, now: string): void {
  for (const speakerId of Object.keys(variant.audio)) {
    variant.audio[speakerId] = {
      status: "not_generated",
      s3Key: null,
      durationMs: null,
      updatedAt: now,
    };
  }
}

function applyVariantImportFields(
  variant: ScriptSegmentVariant,
  incoming: Record<string, unknown>,
  now: string,
): { changed: boolean; textChanged: boolean } {
  if (variantImportFieldsEqual(variant, incoming)) {
    return { changed: false, textChanged: false };
  }
  const textChanged =
    typeof incoming.text === "string" && variant.text !== incoming.text;
  if (textChanged) resetVariantAudio(variant, now);
  for (const [key, val] of Object.entries(incoming)) {
    (variant as Record<string, unknown>)[key] = val;
  }
  variant.updatedAt = now;
  return { changed: true, textChanged };
}

function coerceVariant(raw: unknown, tagName: string): ScriptSegmentVariant | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id =
    typeof o.id === "string"
      ? o.id.trim()
      : typeof o.variantId === "string"
        ? o.variantId.trim()
        : "";
  const text = typeof o.text === "string" ? o.text.trim() : "";
  if (!id || !text) return null;
  const now = new Date().toISOString();
  const audioRaw = o.audio && typeof o.audio === "object" ? (o.audio as Record<string, unknown>) : {};
  const audio: Record<string, ScriptSegmentAudioState> = {};
  for (const [speakerId, state] of Object.entries(audioRaw)) {
    if (!speakerId.trim()) continue;
    audio[speakerId] = coerceAudioState(state);
  }
  const { requiredConstraints, excludedConstraints } = normalizeVariantConstraintFields(
    Array.isArray(o.requiredConstraints)
      ? (o.requiredConstraints as string[])
      : undefined,
    Array.isArray(o.excludedConstraints)
      ? (o.excludedConstraints as string[])
      : undefined,
  );
  const variant: ScriptSegmentVariant = {
    id,
    text: text.slice(0, 4000),
    lengthTier: coerceLengthTier(o.lengthTier),
    requiredConstraints,
    excludedConstraints,
    direction: coerceVariantDirection(o.direction),
    sort: typeof o.sort === "number" ? o.sort : Date.now(),
    createdAt: typeof o.createdAt === "string" ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : now,
    audio,
  };
  for (const [key, val] of Object.entries(o)) {
    if (VARIANT_KNOWN_KEYS.has(key)) continue;
    if (isImportableVariantFieldValue(val)) {
      (variant as Record<string, unknown>)[key] = val;
    }
  }
  return variant;
}

function documentFromItem(item: Record<string, unknown>): ScriptSegmentDocument | null {
  const tag =
    typeof item.tag === "string"
      ? normalizeScriptSegmentTag(item.tag)
      : typeof item.sk === "string"
        ? normalizeScriptSegmentTag(item.sk)
        : typeof item.name === "string"
          ? normalizeScriptSegmentTag(item.name)
          : "";
  if (!tag) return null;
  const variantsRaw = Array.isArray(item.variants) ? item.variants : [];
  const variants: ScriptSegmentVariant[] = [];
  for (const v of variantsRaw) {
    const row = coerceVariant(v, tag);
    if (row) variants.push(row);
  }
  variants.sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
  return {
    tag,
    scope: coerceScope(item.scope),
    types: coerceTypes(item.types),
    lengthTiered: item.lengthTiered === true,
    repeatability: coerceStoredSegmentRepeatability(item.repeatability),
    description:
      typeof item.description === "string" ? item.description.trim().slice(0, 4000) : "",
    variants,
    createdAt: String(item.createdAt ?? new Date().toISOString()),
    updatedAt: String(item.updatedAt ?? new Date().toISOString()),
  };
}

function documentToItem(doc: ScriptSegmentDocument): Record<string, unknown> {
  return {
    pk: SCRIPT_SEGMENT_PK,
    sk: doc.tag,
    tag: doc.tag,
    scope: doc.scope,
    types: doc.types,
    lengthTiered: doc.lengthTiered,
    repeatability: doc.repeatability,
    description: doc.description,
    variants: doc.variants,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function scriptSegmentAudioS3Key(
  tagName: string,
  variantId: string,
  modelId: string,
): string {
  return `script-lab/segments/${encodeURIComponent(tagName)}/${variantId}/${encodeURIComponent(modelId)}.mp3`;
}

function flattenDocument(doc: ScriptSegmentDocument): {
  tag: ScriptSegmentTagRow;
  variants: ScriptSegmentVariantRow[];
  audioByVariantKey: Record<string, ScriptSegmentVariantAudioRow[]>;
} {
  const tag: ScriptSegmentTagRow = {
    name: doc.tag,
    scope: doc.scope,
    types: doc.types,
    lengthTiered: doc.lengthTiered,
    repeatability: effectiveSegmentRepeatability({
      tag: doc.tag,
      repeatability: doc.repeatability,
    }),
    repeatabilityExplicit: doc.repeatability !== null,
    description: doc.description,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
  const variants: ScriptSegmentVariantRow[] = [];
  const audioByVariantKey: Record<string, ScriptSegmentVariantAudioRow[]> = {};
  for (const v of doc.variants) {
    variants.push({
      tagName: doc.tag,
      variantId: v.id,
      text: v.text,
      lengthTier: v.lengthTier,
      requiredConstraints: v.requiredConstraints,
      excludedConstraints: v.excludedConstraints,
      direction: v.direction ?? null,
      sort: v.sort,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    });
    const key = `${doc.tag}#${v.id}`;
    audioByVariantKey[key] = Object.entries(v.audio).map(([modelId, a]) => ({
      tagName: doc.tag,
      variantId: v.id,
      modelId,
      status: a.status,
      s3Key: a.s3Key ?? "",
      durationSeconds: a.durationMs != null ? a.durationMs / 1000 : 0,
      updatedAt: a.updatedAt,
    }));
  }
  return { tag, variants, audioByVariantKey };
}

export async function getScriptSegmentDocument(tagName: string): Promise<ScriptSegmentDocument | null> {
  const TableName = requireTable();
  const name = normalizeScriptSegmentTag(tagName);
  const res = await ddb.send(
    new GetCommand({ TableName, Key: { pk: SCRIPT_SEGMENT_PK, sk: name } }),
  );
  if (res.Item) return documentFromItem(res.Item as Record<string, unknown>);
  return null;
}

async function putScriptSegmentDocument(doc: ScriptSegmentDocument): Promise<void> {
  const TableName = requireTable();
  await ddb.send(
    new PutCommand({
      TableName,
      Item: documentToItem(doc),
    }),
  );
}

async function queryAllPk(pk: string): Promise<Record<string, unknown>[]> {
  const TableName = requireTable();
  const out: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new QueryCommand({
        TableName,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": pk },
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      out.push(item as Record<string, unknown>);
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return out;
}

/** Migrate legacy SCRIPT_TAG / SCRIPT_VARIANT / SCRIPT_VARIANT_AUDIO rows into nested documents. */
async function migrateLegacySegmentsIfNeeded(): Promise<void> {
  const TableName = requireTable();
  const existing = await queryAllPk(SCRIPT_SEGMENT_PK);
  if (existing.length > 0) return;

  const legacyTags = await queryAllPk(LEGACY_TAG_PK);
  if (legacyTags.length === 0) return;

  const legacyVariants = await queryAllPk(LEGACY_VARIANT_PK);
  const legacyAudio = await queryAllPk(LEGACY_VARIANT_AUDIO_PK);

  const variantsByTag = new Map<string, ScriptSegmentVariant[]>();
  for (const item of legacyVariants) {
    const sk = String(item.sk ?? "");
    const hash = sk.indexOf("#");
    if (hash <= 0) continue;
    const tagName = sk.slice(0, hash);
    const variantId = sk.slice(hash + 1);
    const text = typeof item.text === "string" ? item.text : "";
    if (!text) continue;
    const now = String(item.createdAt ?? new Date().toISOString());
    const list = variantsByTag.get(tagName) ?? [];
    list.push({
      id: variantId,
      text,
      lengthTier: null,
      requiredConstraints: [],
      excludedConstraints: [],
      sort: typeof item.sort === "number" ? item.sort : Date.now(),
      createdAt: now,
      updatedAt: String(item.updatedAt ?? now),
      audio: {},
    });
    variantsByTag.set(tagName, list);
  }

  for (const item of legacyAudio) {
    const sk = String(item.sk ?? "");
    const parts = sk.split("#");
    if (parts.length < 3) continue;
    const tagName = parts[0];
    const variantId = parts[1];
    const modelId = parts.slice(2).join("#");
    const variants = variantsByTag.get(tagName);
    const variant = variants?.find((v) => v.id === variantId);
    if (!variant) continue;
    const durationSeconds =
      typeof item.durationSeconds === "number" ? item.durationSeconds : 0;
    variant.audio[modelId] = {
      status: "generated",
      s3Key: typeof item.s3Key === "string" ? item.s3Key : null,
      durationMs: durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null,
      updatedAt: String(item.updatedAt ?? new Date().toISOString()),
    };
  }

  for (const item of legacyTags) {
    const name = typeof item.name === "string" ? item.name : String(item.sk ?? "");
    if (!name) continue;
    const doc: ScriptSegmentDocument = {
      tag: normalizeScriptSegmentTag(name),
      scope: coerceScope(item.scope),
      types: coerceTypes(item.types),
      lengthTiered: false,
      repeatability: coerceStoredSegmentRepeatability(item.repeatability),
      description:
        typeof item.description === "string" ? item.description.trim().slice(0, 4000) : "",
      variants: (variantsByTag.get(name) ?? []).sort(
        (a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt),
      ),
      createdAt: String(item.createdAt ?? new Date().toISOString()),
      updatedAt: String(item.updatedAt ?? new Date().toISOString()),
    };
    await putScriptSegmentDocument(doc);
  }

  for (const item of legacyTags) {
    const sk = String(item.sk ?? item.name ?? "");
    if (!sk) continue;
    await ddb.send(
      new DeleteCommand({ TableName, Key: { pk: LEGACY_TAG_PK, sk } }),
    );
  }
  for (const item of legacyVariants) {
    const sk = String(item.sk ?? "");
    if (!sk) continue;
    await ddb.send(
      new DeleteCommand({ TableName, Key: { pk: LEGACY_VARIANT_PK, sk } }),
    );
  }
  for (const item of legacyAudio) {
    const sk = String(item.sk ?? "");
    if (!sk) continue;
    await ddb.send(
      new DeleteCommand({ TableName, Key: { pk: LEGACY_VARIANT_AUDIO_PK, sk } }),
    );
  }
}

/** One-time backfill: persist empty constraint arrays; drop legacy type-specific fields. */
async function backfillVariantConstraintFieldsIfNeeded(
  items: Record<string, unknown>[],
  docs: ScriptSegmentDocument[],
): Promise<void> {
  const itemByTag = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const doc = documentFromItem(item);
    if (doc) itemByTag.set(doc.tag, item);
  }
  for (const doc of docs) {
    const item = itemByTag.get(doc.tag);
    if (!item) continue;
    const variantsRaw = Array.isArray(item.variants) ? item.variants : [];
    let changed = false;
    for (let j = 0; j < doc.variants.length; j += 1) {
      const raw = variantsRaw[j];
      const rawObj =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
      const needsBackfill =
        !rawObj ||
        !Array.isArray(rawObj.requiredConstraints) ||
        !Array.isArray(rawObj.excludedConstraints) ||
        rawObj.excludedTypes !== undefined ||
        rawObj.restrictedToTypes !== undefined;
      if (needsBackfill) {
        doc.variants[j].requiredConstraints = doc.variants[j].requiredConstraints ?? [];
        doc.variants[j].excludedConstraints = doc.variants[j].excludedConstraints ?? [];
        changed = true;
      }
    }
    if (changed) {
      doc.updatedAt = new Date().toISOString();
      await putScriptSegmentDocument(doc);
    }
  }
}

/** One-time backfill: persist repeatability on segment documents missing the field. */
async function backfillRepeatabilityIfNeeded(
  _items: Record<string, unknown>[],
  _docs: ScriptSegmentDocument[],
): Promise<void> {
  // Intentionally no-op: repeatability stays unset until authored in Script Lab properties.
}

export async function listScriptSegmentDocuments(): Promise<ScriptSegmentDocument[]> {
  await migrateLegacySegmentsIfNeeded();
  const items = await queryAllPk(SCRIPT_SEGMENT_PK);
  const out: ScriptSegmentDocument[] = [];
  for (const item of items) {
    const doc = documentFromItem(item);
    if (doc) out.push(doc);
  }
  out.sort((a, b) => a.tag.localeCompare(b.tag));
  await backfillVariantConstraintFieldsIfNeeded(items, out);
  await backfillRepeatabilityIfNeeded(items, out);
  return out;
}

export async function listAllScriptSegmentLibrary(): Promise<{
  tags: ScriptSegmentTagRow[];
  variantsByTag: Record<string, ScriptSegmentVariantRow[]>;
  audioByVariantKey: Record<string, ScriptSegmentVariantAudioRow[]>;
}> {
  const docs = await listScriptSegmentDocuments();
  const tags: ScriptSegmentTagRow[] = [];
  const variantsByTag: Record<string, ScriptSegmentVariantRow[]> = {};
  const audioByVariantKey: Record<string, ScriptSegmentVariantAudioRow[]> = {};
  for (const doc of docs) {
    const flat = flattenDocument(doc);
    tags.push(flat.tag);
    variantsByTag[doc.tag] = flat.variants;
    Object.assign(audioByVariantKey, flat.audioByVariantKey);
  }
  return { tags, variantsByTag, audioByVariantKey };
}

export async function listScriptSegmentTags(): Promise<ScriptSegmentTagRow[]> {
  const { tags } = await listAllScriptSegmentLibrary();
  return tags;
}

export async function listScriptSegmentVariants(
  tagName: string,
): Promise<ScriptSegmentVariantRow[]> {
  const doc = await getScriptSegmentDocument(tagName);
  if (!doc) return [];
  return flattenDocument(doc).variants;
}

export async function putScriptSegmentTag(params: {
  name: string;
  scope?: ScriptSegmentScope;
  types?: string[];
  lengthTiered?: boolean;
  repeatability?: ScriptSegmentRepeatability;
  description?: string;
}): Promise<ScriptSegmentTagRow> {
  const name = normalizeScriptSegmentTag(params.name);
  if (!isValidScriptSegmentTag(name)) {
    throw new Error("Tag name must be at least 2 characters (A-Z, 0-9, _).");
  }
  const existing = await getScriptSegmentDocument(name);
  const now = new Date().toISOString();
  const scope = coerceScope(params.scope ?? existing?.scope);
  const types =
    params.types != null ? coerceTypes(params.types) : coerceTypes(existing?.types);
  if (scope === "types" && types.length === 0) {
    throw new Error("Type-restricted tags need at least one meditation type.");
  }
  const repeatability =
    params.repeatability === "connective" || params.repeatability === "singular"
      ? params.repeatability
      : (existing?.repeatability ?? null);
  const description =
    params.description !== undefined
      ? params.description.trim().slice(0, 4000)
      : (existing?.description ?? "");
  const doc: ScriptSegmentDocument = {
    tag: name,
    scope,
    types,
    lengthTiered: params.lengthTiered ?? existing?.lengthTiered ?? false,
    repeatability,
    description,
    variants: existing?.variants ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  if (params.lengthTiered === false) {
    doc.variants = doc.variants.map((v) => ({ ...v, lengthTier: null }));
  }
  await putScriptSegmentDocument(doc);
  return flattenDocument(doc).tag;
}

export async function putScriptSegmentVariant(params: {
  tagName: string;
  variantId?: string;
  text: string;
  lengthTier?: ScriptLengthTier | null;
  requiredConstraints?: string[];
  excludedConstraints?: string[];
  sort?: number;
}): Promise<ScriptSegmentVariantRow> {
  const tagName = normalizeScriptSegmentTag(params.tagName);
  const doc = await getScriptSegmentDocument(tagName);
  if (!doc) throw new Error(`Unknown tag ${tagName}`);

  const variantId = params.variantId?.trim() || randomUUID();
  const now = new Date().toISOString();
  const text = params.text.trim().slice(0, 4000);
  if (!text) throw new Error("Variant text is required.");

  const idx = doc.variants.findIndex((v) => v.id === variantId);
  const existing = idx >= 0 ? doc.variants[idx] : null;
  const lengthTier =
    params.lengthTier !== undefined
      ? params.lengthTier
      : existing?.lengthTier ?? (doc.lengthTiered ? "medium" : null);

  if (doc.lengthTiered && !lengthTier) {
    throw new Error("Length-tiered tags require a length tier on each variant.");
  }

  const { requiredConstraints, excludedConstraints } = normalizeVariantConstraintFields(
    params.requiredConstraints ?? existing?.requiredConstraints,
    params.excludedConstraints ?? existing?.excludedConstraints,
  );

  const variant: ScriptSegmentVariant = {
    id: variantId,
    text,
    lengthTier: doc.lengthTiered ? lengthTier : null,
    requiredConstraints,
    excludedConstraints,
    sort: typeof params.sort === "number" ? params.sort : existing?.sort ?? Date.now(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    audio: existing?.audio ?? {},
  };

  if (idx >= 0) doc.variants[idx] = variant;
  else doc.variants.push(variant);
  doc.updatedAt = now;
  await putScriptSegmentDocument(doc);
  return flattenDocument(doc).variants.find((v) => v.variantId === variantId)!;
}

export async function setScriptSegmentVariantAudioStatus(params: {
  tagName: string;
  variantId: string;
  modelId: string;
  status: ScriptSegmentAudioState["status"];
  s3Key?: string | null;
  durationMs?: number | null;
}): Promise<void> {
  const doc = await getScriptSegmentDocument(params.tagName);
  if (!doc) throw new Error(`Unknown tag ${params.tagName}`);
  const variant = doc.variants.find((v) => v.id === params.variantId);
  if (!variant) throw new Error("Variant not found");
  const now = new Date().toISOString();
  variant.audio[params.modelId] = {
    status: params.status,
    s3Key: params.s3Key ?? variant.audio[params.modelId]?.s3Key ?? null,
    durationMs:
      params.durationMs !== undefined
        ? params.durationMs
        : variant.audio[params.modelId]?.durationMs ?? null,
    updatedAt: now,
  };
  variant.updatedAt = now;
  doc.updatedAt = now;
  await putScriptSegmentDocument(doc);
}

/** @deprecated Use setScriptSegmentVariantAudioStatus — kept for script-segment-audio.ts */
export async function putScriptSegmentVariantAudio(
  row: ScriptSegmentVariantAudioRow,
): Promise<void> {
  await setScriptSegmentVariantAudioStatus({
    tagName: row.tagName,
    variantId: row.variantId,
    modelId: row.modelId,
    status: "generated",
    s3Key: row.s3Key,
    durationMs: row.durationSeconds > 0 ? Math.round(row.durationSeconds * 1000) : null,
  });
}

export async function deleteScriptSegmentVariant(params: {
  tagName: string;
  variantId: string;
}): Promise<void> {
  const tagName = normalizeScriptSegmentTag(params.tagName);
  const doc = await getScriptSegmentDocument(tagName);
  if (!doc) return;
  doc.variants = doc.variants.filter((v) => v.id !== params.variantId);
  doc.updatedAt = new Date().toISOString();
  await putScriptSegmentDocument(doc);
}

export async function deleteScriptSegmentTag(name: string): Promise<void> {
  const TableName = requireTable();
  const tagName = normalizeScriptSegmentTag(name);
  await ddb.send(
    new DeleteCommand({
      TableName,
      Key: { pk: SCRIPT_SEGMENT_PK, sk: tagName },
    }),
  );
}

export type ScriptSegmentImportResult = {
  tagsCreated: number;
  tagsUpdated: number;
  variantsAdded: number;
  variantsUpdatedById: number;
  variantsUpdatedByTextMatch: number;
  variantsUnchanged: number;
  variantsIdNotFound: Array<{ tag: string; id: string }>;
  variantsAudioInvalidated: number;
  /** Present when `fresh` import cleared the library before loading variants. */
  variantsRemoved?: number;
  freshImport?: boolean;
  constraintTagsAdded: string[];
};

export type ScriptSegmentExportPayload = {
  segments: Array<{
    tag: string;
    scope: "general" | "restricted";
    types: string[];
    lengthTiered: boolean;
    repeatability?: ScriptSegmentRepeatability;
    description?: string;
    variants: Array<{ id: string } & Record<string, unknown>>;
  }>;
};

export async function exportScriptSegmentLibrary(): Promise<ScriptSegmentExportPayload> {
  const docs = await listScriptSegmentDocuments();
  return {
    segments: docs.map((doc) => ({
      tag: doc.tag,
      scope: doc.scope === "types" ? "restricted" : "general",
      types: doc.types,
      lengthTiered: doc.lengthTiered,
      ...(doc.repeatability ? { repeatability: doc.repeatability } : {}),
      ...(doc.description.trim() ? { description: doc.description } : {}),
      variants: doc.variants.map((v) => ({
        id: v.id,
        ...variantImportFieldsFromStored(v),
      })),
    })),
  };
}

function buildImportedVariant(
  imported: { id?: string; importFields: Record<string, unknown> },
  lengthTiered: boolean,
  now: string,
): { variant: ScriptSegmentVariant; requiredConstraints: string[]; excludedConstraints: string[] } | null {
  const incoming = imported.importFields;
  const text =
    typeof incoming.text === "string" ? incoming.text.trim().slice(0, 4000) : "";
  if (!text) return null;
  const lengthTier = lengthTiered ? coerceLengthTier(incoming.lengthTier) : null;
  if (lengthTiered && !lengthTier) {
    throw new Error("length-tiered segments require lengthTier on each variant.");
  }
  const { requiredConstraints, excludedConstraints } = normalizeVariantConstraintFields(
    incoming.requiredConstraints as string[] | undefined,
    incoming.excludedConstraints as string[] | undefined,
  );
  const importId = imported.id?.trim();
  const newVariant: ScriptSegmentVariant = {
    id: importId || randomUUID(),
    text: "",
    lengthTier: null,
    requiredConstraints: [],
    excludedConstraints: [],
    sort: Date.now(),
    createdAt: now,
    updatedAt: now,
    audio: {},
  };
  applyVariantImportFields(newVariant, incoming, now);
  return { variant: newVariant, requiredConstraints, excludedConstraints };
}

export async function importScriptSegments(
  segments: Array<{
    tag: string;
    scope: ScriptSegmentScope;
    types: string[];
    lengthTiered: boolean;
    repeatability?: ScriptSegmentRepeatability;
    description?: string;
    variants: Array<{
      id?: string;
      importFields: Record<string, unknown>;
    }>;
  }>,
  options?: { fresh?: boolean },
): Promise<ScriptSegmentImportResult> {
  const fresh = options?.fresh === true;
  let tagsCreated = 0;
  let tagsUpdated = 0;
  let variantsAdded = 0;
  let variantsUpdatedById = 0;
  let variantsUpdatedByTextMatch = 0;
  let variantsUnchanged = 0;
  let variantsAudioInvalidated = 0;
  let variantsRemoved = 0;
  const variantsIdNotFound: Array<{ tag: string; id: string }> = [];
  const allConstraintTags: string[] = [];

  if (fresh) {
    const clearNow = new Date().toISOString();
    for (const doc of await listScriptSegmentDocuments()) {
      variantsRemoved += doc.variants.length;
      if (doc.variants.length === 0) continue;
      doc.variants = [];
      doc.updatedAt = clearNow;
      await putScriptSegmentDocument(doc);
    }
  }

  for (const seg of segments) {
    const tagName = normalizeScriptSegmentTag(seg.tag);
    if (!isValidScriptSegmentTag(tagName)) {
      throw new Error(`Invalid tag name: ${seg.tag}`);
    }
    const existing = await getScriptSegmentDocument(tagName);
    const now = new Date().toISOString();
    const scope = seg.scope;
    const types = coerceTypes(seg.types);
    if (scope === "types" && types.length === 0) {
      throw new Error(`Tag ${tagName}: restricted scope requires at least one type.`);
    }

    if (fresh) {
      const repeatability =
        seg.repeatability === "connective" || seg.repeatability === "singular"
          ? seg.repeatability
          : null;
      const description =
        typeof seg.description === "string" ? seg.description.trim().slice(0, 4000) : "";

      const doc: ScriptSegmentDocument = existing ?? {
        tag: tagName,
        scope,
        types,
        lengthTiered: seg.lengthTiered,
        repeatability,
        description,
        variants: [],
        createdAt: now,
        updatedAt: now,
      };

      if (!existing) {
        tagsCreated += 1;
      }

      const nextVariants: ScriptSegmentVariant[] = [];
      for (const imported of seg.variants) {
        let built: ReturnType<typeof buildImportedVariant>;
        try {
          built = buildImportedVariant(imported, seg.lengthTiered, now);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          throw new Error(`Tag ${tagName}: ${msg}`);
        }
        if (!built) continue;
        allConstraintTags.push(...built.requiredConstraints, ...built.excludedConstraints);
        nextVariants.push(built.variant);
        variantsAdded += 1;
      }

      doc.variants = nextVariants;
      doc.updatedAt = now;
      await putScriptSegmentDocument(doc);
      continue;
    }

    const repeatability =
      seg.repeatability === "connective" || seg.repeatability === "singular"
        ? seg.repeatability
        : (existing?.repeatability ?? null);
    const description =
      typeof seg.description === "string"
        ? seg.description.trim().slice(0, 4000)
        : (existing?.description ?? "");

    const doc: ScriptSegmentDocument = existing ?? {
      tag: tagName,
      scope,
      types,
      lengthTiered: seg.lengthTiered,
      repeatability,
      description,
      variants: [],
      createdAt: now,
      updatedAt: now,
    };

    let tagMetaChanged = false;
    if (existing) {
      if (
        doc.scope !== scope ||
        !arraysEqual(doc.types, types) ||
        doc.lengthTiered !== seg.lengthTiered ||
        doc.repeatability !== repeatability ||
        doc.description !== description
      ) {
        tagMetaChanged = true;
        doc.scope = scope;
        doc.types = types;
        doc.lengthTiered = seg.lengthTiered;
        doc.repeatability = repeatability;
        doc.description = description;
      }
    } else {
      tagsCreated += 1;
    }

    let docChanged = !existing || tagMetaChanged;

    for (const imported of seg.variants) {
      const incoming = imported.importFields;
      const text =
        typeof incoming.text === "string" ? incoming.text.trim().slice(0, 4000) : "";
      if (!text) continue;
      const lengthTier = seg.lengthTiered
        ? coerceLengthTier(incoming.lengthTier)
        : null;
      if (seg.lengthTiered && !lengthTier) {
        throw new Error(
          `Tag ${tagName}: length-tiered segments require lengthTier on each variant.`,
        );
      }
      const { requiredConstraints, excludedConstraints } = normalizeVariantConstraintFields(
        incoming.requiredConstraints as string[] | undefined,
        incoming.excludedConstraints as string[] | undefined,
      );
      allConstraintTags.push(...requiredConstraints, ...excludedConstraints);

      const importId = imported.id?.trim();
      if (importId) {
        const idx = doc.variants.findIndex((v) => v.id === importId);
        if (idx < 0) {
          if (existing) {
            variantsIdNotFound.push({ tag: tagName, id: importId });
            continue;
          }
          const newVariant: ScriptSegmentVariant = {
            id: importId,
            text: "",
            lengthTier: null,
            requiredConstraints: [],
            excludedConstraints: [],
            sort: Date.now(),
            createdAt: now,
            updatedAt: now,
            audio: {},
          };
          applyVariantImportFields(newVariant, incoming, now);
          doc.variants.push(newVariant);
          variantsAdded += 1;
          docChanged = true;
          continue;
        }
        const variant = doc.variants[idx]!;
        const applied = applyVariantImportFields(variant, incoming, now);
        if (!applied.changed) {
          variantsUnchanged += 1;
          continue;
        }
        if (applied.textChanged) variantsAudioInvalidated += 1;
        variantsUpdatedById += 1;
        docChanged = true;
        continue;
      }

      const textMatchIdx = doc.variants.findIndex((v) => v.text === text);
      if (textMatchIdx >= 0) {
        const variant = doc.variants[textMatchIdx]!;
        const applied = applyVariantImportFields(variant, incoming, now);
        if (!applied.changed) {
          variantsUnchanged += 1;
          continue;
        }
        variantsUpdatedByTextMatch += 1;
        docChanged = true;
        continue;
      }

      const newVariant: ScriptSegmentVariant = {
        id: randomUUID(),
        text: "",
        lengthTier: null,
        requiredConstraints: [],
        excludedConstraints: [],
        sort: Date.now(),
        createdAt: now,
        updatedAt: now,
        audio: {},
      };
      applyVariantImportFields(newVariant, incoming, now);
      doc.variants.push(newVariant);
      variantsAdded += 1;
      docChanged = true;
    }

    if (existing && tagMetaChanged) {
      tagsUpdated += 1;
    }

    if (docChanged) {
      doc.updatedAt = now;
      await putScriptSegmentDocument(doc);
    }
  }

  const constraintTagsAdded = await ensureConstraintVocabularyTags(allConstraintTags);

  return {
    tagsCreated,
    tagsUpdated,
    variantsAdded,
    variantsUpdatedById,
    variantsUpdatedByTextMatch,
    variantsUnchanged,
    variantsIdNotFound,
    variantsAudioInvalidated,
    ...(fresh ? { variantsRemoved, freshImport: true } : {}),
    constraintTagsAdded,
  };
}
