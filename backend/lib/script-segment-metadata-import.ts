import {
  isValidScriptSegmentTag,
  normalizeScriptSegmentTag,
  type ScriptSegmentRepeatability,
  type ScriptSegmentScope,
} from "./script-segment-tags";
import { putScriptSegmentTag, getScriptSegmentDocument, type ScriptSegmentTagRow } from "./script-segment-library";

export type SegmentMetadataImportValidationError = {
  path: string;
  message: string;
};

export type SegmentMetadataImportEntry = {
  name: string;
  scope?: ScriptSegmentScope;
  types?: string[];
  lengthTiered?: boolean;
  repeatability?: ScriptSegmentRepeatability;
  description?: string;
};

export type SegmentMetadataImportResult = {
  tagsUpdated: number;
  tagsCreated: number;
  tagNames: string[];
};

function coerceScope(raw: unknown): ScriptSegmentScope | null {
  if (raw === "general") return "general";
  if (raw === "types" || raw === "restricted") return "types";
  return null;
}

function coerceTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function extractTagEntry(
  raw: unknown,
  path: string,
  errors: SegmentMetadataImportValidationError[],
): SegmentMetadataImportEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({ path, message: "Each entry must be an object." });
    return null;
  }
  const row = raw as Record<string, unknown>;
  const tagObj =
    row.tag && typeof row.tag === "object" && !Array.isArray(row.tag)
      ? (row.tag as Record<string, unknown>)
      : row;

  const nameRaw = typeof tagObj.name === "string" ? tagObj.name.trim() : "";
  if (!nameRaw) {
    errors.push({ path: `${path}.tag.name`, message: "tag.name is required." });
    return null;
  }
  const name = normalizeScriptSegmentTag(nameRaw);
  if (!isValidScriptSegmentTag(name)) {
    errors.push({
      path: `${path}.tag.name`,
      message: `Invalid tag "${nameRaw}" — use A-Z, 0-9, underscore (min 2 chars).`,
    });
    return null;
  }

  const entry: SegmentMetadataImportEntry = { name };

  if (tagObj.scope !== undefined) {
    const scope = coerceScope(tagObj.scope);
    if (!scope) {
      errors.push({
        path: `${path}.tag.scope`,
        message: 'scope must be "general", "types", or "restricted".',
      });
      return null;
    }
    entry.scope = scope;
  }

  if (tagObj.types !== undefined) {
    entry.types = coerceTypes(tagObj.types);
  }

  if (tagObj.lengthTiered !== undefined) {
    if (typeof tagObj.lengthTiered !== "boolean") {
      errors.push({ path: `${path}.tag.lengthTiered`, message: "lengthTiered must be a boolean." });
      return null;
    }
    entry.lengthTiered = tagObj.lengthTiered;
  }

  if (tagObj.repeatability !== undefined) {
    if (tagObj.repeatability !== "connective" && tagObj.repeatability !== "singular") {
      errors.push({
        path: `${path}.tag.repeatability`,
        message: 'repeatability must be "connective" or "singular".',
      });
      return null;
    }
    entry.repeatability = tagObj.repeatability;
  }

  if (tagObj.description !== undefined) {
    if (typeof tagObj.description !== "string") {
      errors.push({ path: `${path}.tag.description`, message: "description must be a string." });
      return null;
    }
    entry.description = tagObj.description.trim().slice(0, 4000);
  }

  const scope = entry.scope ?? "general";
  if (scope === "types" && entry.types !== undefined && entry.types.length === 0) {
    errors.push({
      path: `${path}.tag.types`,
      message: "type-restricted scope requires at least one meditation type.",
    });
    return null;
  }

  return entry;
}

export function validateSegmentMetadataImportJson(raw: unknown): {
  ok: true;
  entries: SegmentMetadataImportEntry[];
} | {
  ok: false;
  errors: SegmentMetadataImportValidationError[];
} {
  const errors: SegmentMetadataImportValidationError[] = [];

  let list: unknown[] | null = null;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const root = raw as Record<string, unknown>;
    if (Array.isArray(root.tags)) list = root.tags;
    else if (root.tag && typeof root.tag === "object") list = [raw];
  }

  if (!list) {
    return {
      ok: false,
      errors: [
        {
          path: "",
          message:
            'Expected a JSON array [{ "tag": { "name": "…", … } }], { "tags": […] }, or a single { "tag": { … } }.',
        },
      ],
    };
  }

  if (list.length === 0) {
    return { ok: false, errors: [{ path: "", message: "Import list is empty." }] };
  }

  const entries: SegmentMetadataImportEntry[] = [];
  const seen = new Set<string>();

  list.forEach((item, i) => {
    const entry = extractTagEntry(item, `[${i}]`, errors);
    if (!entry) return;
    if (seen.has(entry.name)) {
      errors.push({ path: `[${i}].tag.name`, message: `Duplicate tag ${entry.name}.` });
      return;
    }
    seen.add(entry.name);
    entries.push(entry);
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, entries };
}

export async function runSegmentMetadataImport(
  raw: unknown,
): Promise<
  | { ok: true; result: SegmentMetadataImportResult }
  | { ok: false; errors: SegmentMetadataImportValidationError[] }
> {
  const validated = validateSegmentMetadataImportJson(raw);
  if (!validated.ok) return validated;

  let tagsCreated = 0;
  let tagsUpdated = 0;
  const tagNames: string[] = [];

  for (const entry of validated.entries) {
    const existing = await getScriptSegmentDocument(entry.name);
    if (entry.scope === "types" && !entry.types?.length) {
      const hasTypes = (entry.types?.length ?? 0) > 0 || (existing?.types.length ?? 0) > 0;
      if (!hasTypes) {
        return {
          ok: false,
          errors: [
            {
              path: entry.name,
              message: `${entry.name}: type-restricted scope requires types on import or an existing tag with types.`,
            },
          ],
        };
      }
    }

    const row: ScriptSegmentTagRow = await putScriptSegmentTag({
      name: entry.name,
      ...(entry.scope !== undefined ? { scope: entry.scope } : {}),
      ...(entry.types !== undefined ? { types: entry.types } : {}),
      ...(entry.lengthTiered !== undefined ? { lengthTiered: entry.lengthTiered } : {}),
      ...(entry.repeatability !== undefined ? { repeatability: entry.repeatability } : {}),
      ...(entry.description !== undefined ? { description: entry.description } : {}),
    });
    tagNames.push(row.name);
    if (existing) tagsUpdated += 1;
    else tagsCreated += 1;
  }

  return {
    ok: true,
    result: { tagsCreated, tagsUpdated, tagNames },
  };
}
