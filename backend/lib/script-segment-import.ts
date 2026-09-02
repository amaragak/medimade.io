import {
  isValidScriptSegmentTag,
  normalizeScriptSegmentTag,
  type ScriptLengthTier,
  type ScriptSegmentRepeatability,
  type ScriptSegmentScope,
} from "./script-segment-tags";
import { coerceConstraintTagList } from "./script-constraint-tags";
import {
  buildVariantImportFieldsFromJson,
  importScriptSegments,
  type ScriptSegmentImportResult,
} from "./script-segment-library";

export type ScriptSegmentImportPayload = {
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
  }>;
};

export type ScriptSegmentImportValidationError = {
  path: string;
  message: string;
};

function coerceImportScope(raw: unknown): ScriptSegmentScope | null {
  if (raw === "general") return "general";
  if (raw === "restricted" || raw === "types") return "types";
  return null;
}

function coerceImportLengthTier(raw: unknown): ScriptLengthTier | null {
  if (raw === "short" || raw === "medium" || raw === "long") return raw;
  if (raw === null || raw === undefined) return null;
  return null;
}

function coerceImportTypeList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter(Boolean);
}

function coerceImportConstraintList(
  raw: unknown,
  path: string,
  errors: ScriptSegmentImportValidationError[],
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push({ path, message: "must be an array of constraint tag strings." });
    return [];
  }
  const out = coerceConstraintTagList(raw);
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const n = coerceConstraintTagList([item])[0];
    if (item.trim() && !n) {
      errors.push({
        path,
        message: `invalid constraint tag "${item}" — use lowercase letters, numbers, underscore.`,
      });
    }
  }
  return out;
}

export function validateScriptSegmentImportJson(
  raw: unknown,
): { ok: true; payload: ScriptSegmentImportPayload } | { ok: false; errors: ScriptSegmentImportValidationError[] } {
  const errors: ScriptSegmentImportValidationError[] = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{ path: "", message: "Root must be a JSON object with a segments array." }],
    };
  }

  const root = raw as Record<string, unknown>;
  if (!Array.isArray(root.segments)) {
    return {
      ok: false,
      errors: [{ path: "segments", message: "Required array field segments is missing." }],
    };
  }

  const segments: ScriptSegmentImportPayload["segments"] = [];
  const seenTags = new Set<string>();

  root.segments.forEach((segRaw, i) => {
    const base = `segments[${i}]`;
    if (!segRaw || typeof segRaw !== "object" || Array.isArray(segRaw)) {
      errors.push({ path: base, message: "Each segment must be an object." });
      return;
    }
    const seg = segRaw as Record<string, unknown>;

    const tagRaw = typeof seg.tag === "string" ? seg.tag.trim() : "";
    if (!tagRaw) {
      errors.push({ path: `${base}.tag`, message: "tag is required." });
      return;
    }
    const tag = normalizeScriptSegmentTag(tagRaw);
    if (!isValidScriptSegmentTag(tag)) {
      errors.push({
        path: `${base}.tag`,
        message: `Invalid tag "${tagRaw}" — use A-Z, 0-9, underscore (min 2 chars).`,
      });
      return;
    }
    if (seenTags.has(tag)) {
      errors.push({ path: `${base}.tag`, message: `Duplicate tag ${tag} in import.` });
      return;
    }
    seenTags.add(tag);

    const scope = coerceImportScope(seg.scope);
    if (!scope) {
      errors.push({
        path: `${base}.scope`,
        message: 'scope must be "general" or "restricted".',
      });
      return;
    }

    const types = coerceImportTypeList(seg.types);
    if (scope === "types" && types.length === 0) {
      errors.push({
        path: `${base}.types`,
        message: "restricted scope requires at least one meditation type in types.",
      });
    }

    if (typeof seg.lengthTiered !== "boolean") {
      errors.push({
        path: `${base}.lengthTiered`,
        message: "lengthTiered must be a boolean.",
      });
      return;
    }
    const lengthTiered = seg.lengthTiered;

    if (
      seg.repeatability != null &&
      seg.repeatability !== "connective" &&
      seg.repeatability !== "singular"
    ) {
      errors.push({
        path: `${base}.repeatability`,
        message: 'repeatability must be "connective" or "singular" when set.',
      });
    }
    const repeatability =
      seg.repeatability === "connective" || seg.repeatability === "singular"
        ? seg.repeatability
        : undefined;

    let description: string | undefined;
    if (seg.description != null) {
      if (typeof seg.description !== "string") {
        errors.push({
          path: `${base}.description`,
          message: "description must be a string when set.",
        });
        return;
      }
      description = seg.description.trim().slice(0, 4000);
    }

    if (!Array.isArray(seg.variants)) {
      errors.push({ path: `${base}.variants`, message: "variants must be an array." });
      return;
    }

    const variants: ScriptSegmentImportPayload["segments"][0]["variants"] = [];
    const seenVariantIds = new Set<string>();
    seg.variants.forEach((vRaw, vi) => {
      const vPath = `${base}.variants[${vi}]`;
      if (!vRaw || typeof vRaw !== "object" || Array.isArray(vRaw)) {
        errors.push({ path: vPath, message: "Each variant must be an object." });
        return;
      }
      const v = vRaw as Record<string, unknown>;
      const text = typeof v.text === "string" ? v.text.trim() : "";
      if (!text) {
        errors.push({ path: `${vPath}.text`, message: "text is required." });
        return;
      }
      const importId = typeof v.id === "string" ? v.id.trim() : "";
      if (importId) {
        if (seenVariantIds.has(importId)) {
          errors.push({ path: `${vPath}.id`, message: `Duplicate variant id ${importId} in import.` });
          return;
        }
        seenVariantIds.add(importId);
      }
      const lengthTier = coerceImportLengthTier(v.lengthTier);
      if (lengthTiered && !lengthTier) {
        errors.push({
          path: `${vPath}.lengthTier`,
          message: 'lengthTier must be "short", "medium", or "long" when lengthTiered is true.',
        });
        return;
      }
      if (!lengthTiered && v.lengthTier != null && v.lengthTier !== undefined) {
        errors.push({
          path: `${vPath}.lengthTier`,
          message: "lengthTier must be null or omitted when lengthTiered is false.",
        });
        return;
      }

      const requiredConstraints = coerceImportConstraintList(
        v.requiredConstraints,
        `${vPath}.requiredConstraints`,
        errors,
      );
      const excludedConstraints = coerceImportConstraintList(
        v.excludedConstraints,
        `${vPath}.excludedConstraints`,
        errors,
      );

      if (v.direction != null && typeof v.direction !== "string") {
        errors.push({
          path: `${vPath}.direction`,
          message: "direction must be a string or null when set.",
        });
        return;
      }

      const importFields = buildVariantImportFieldsFromJson({
        raw: v,
        lengthTiered,
        text,
        lengthTier: lengthTiered ? lengthTier : null,
        requiredConstraints,
        excludedConstraints,
      });

      variants.push({
        id: importId || undefined,
        importFields,
      });
    });

    segments.push({ tag, scope, types, lengthTiered, repeatability, description, variants });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, payload: { segments } };
}

export async function runScriptSegmentImport(
  raw: unknown,
  options?: { fresh?: boolean },
): Promise<
  | { ok: true; result: ScriptSegmentImportResult }
  | { ok: false; errors: ScriptSegmentImportValidationError[] }
> {
  const validated = validateScriptSegmentImportJson(raw);
  if (!validated.ok) return validated;
  const freshFromPayload =
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).fresh === true;
  const fresh = options?.fresh === true || freshFromPayload;
  const result = await importScriptSegments(validated.payload.segments, fresh ? { fresh: true } : undefined);
  return { ok: true, result };
}
