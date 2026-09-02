"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  patchAdminScriptLab,
  type ScriptLabTag,
} from "@/lib/medimade-api";
import { SCRIPT_LAB_MEDITATION_TYPES } from "@/lib/script-lab-coverage";
import {
  suggestedDescriptionForTag,
  suggestedRepeatabilityForTag,
} from "@/lib/script-segment-metadata-defaults";
import type { ScriptSegmentRepeatability } from "@/lib/script-segment-tags";

const MEDITATION_TYPES = SCRIPT_LAB_MEDITATION_TYPES;

type SegmentMetadataDraft = {
  scope: "general" | "types";
  types: string[];
  description: string;
  repeatability: ScriptSegmentRepeatability | "";
  lengthTiered: boolean;
};

type BulkFilter = "all" | "needs-repeatability" | "needs-description";

function emptyDraft(): SegmentMetadataDraft {
  return {
    scope: "general",
    types: [],
    description: "",
    repeatability: "",
    lengthTiered: false,
  };
}

function draftFromTag(tag: ScriptLabTag): SegmentMetadataDraft {
  return {
    scope: tag.scope,
    types: [...tag.types],
    description: tag.description ?? "",
    repeatability: tag.repeatabilityExplicit ? tag.repeatability : "",
    lengthTiered: tag.lengthTiered,
  };
}

function draftsEqual(a: SegmentMetadataDraft, b: SegmentMetadataDraft): boolean {
  return (
    a.scope === b.scope &&
    a.lengthTiered === b.lengthTiered &&
    a.description === b.description &&
    a.repeatability === b.repeatability &&
    a.types.length === b.types.length &&
    a.types.every((t, i) => t === b.types[i])
  );
}

export function ScriptLabSegmentPropertiesPanel(props: {
  tags: ScriptLabTag[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
  onSaved: () => Promise<void>;
  onError: (message: string | null) => void;
}) {
  const { tags, selectedTag, onSelectTag, onSaved, onError } = props;
  const [bulkFilter, setBulkFilter] = useState<BulkFilter>("all");
  const [drafts, setDrafts] = useState<Record<string, SegmentMetadataDraft>>({});
  const [savingTags, setSavingTags] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    const next: Record<string, SegmentMetadataDraft> = {};
    for (const tag of tags) {
      const existing = drafts[tag.name];
      const fromTag = draftFromTag(tag);
      if (!existing || draftsEqual(existing, fromTag)) {
        next[tag.name] = fromTag;
      } else {
        next[tag.name] = existing;
      }
    }
    setDrafts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preserve in-progress edits per tag name
  }, [tags]);

  const filteredTags = useMemo(() => {
    const sorted = [...tags].sort((a, b) => a.name.localeCompare(b.name));
    if (bulkFilter === "needs-repeatability") {
      return sorted.filter((t) => !t.repeatabilityExplicit);
    }
    if (bulkFilter === "needs-description") {
      return sorted.filter((t) => !(t.description ?? "").trim());
    }
    return sorted;
  }, [tags, bulkFilter]);

  const needsRepeatabilityCount = useMemo(
    () => tags.filter((t) => !t.repeatabilityExplicit).length,
    [tags],
  );
  const needsDescriptionCount = useMemo(
    () => tags.filter((t) => !(t.description ?? "").trim()).length,
    [tags],
  );

  const updateDraft = useCallback((tagName: string, patch: Partial<SegmentMetadataDraft>) => {
    setDrafts((prev) => ({
      ...prev,
      [tagName]: { ...(prev[tagName] ?? emptyDraft()), ...patch },
    }));
  }, []);

  const saveTagMetadata = useCallback(
    async (tagName: string) => {
      const draft = drafts[tagName];
      if (!draft) return;
      if (draft.scope === "types" && draft.types.length === 0) {
        onError(`${tagName}: type-restricted scope needs at least one meditation type.`);
        return;
      }
      if (!draft.repeatability) {
        onError(`${tagName}: choose a repeatability value before saving.`);
        return;
      }
      setSavingTags((prev) => new Set(prev).add(tagName));
      onError(null);
      try {
        await patchAdminScriptLab({
          tag: {
            name: tagName,
            scope: draft.scope,
            types: draft.scope === "types" ? draft.types : [],
            lengthTiered: draft.lengthTiered,
            repeatability: draft.repeatability,
            description: draft.description,
          },
        });
        await onSaved();
      } catch (e) {
        onError(e instanceof Error ? e.message : `Could not save ${tagName}`);
      } finally {
        setSavingTags((prev) => {
          const next = new Set(prev);
          next.delete(tagName);
          return next;
        });
      }
    },
    [drafts, onError, onSaved],
  );

  const applyBulkRepeatability = useCallback(async () => {
    const targets = tags.filter((t) => !t.repeatabilityExplicit);
    if (targets.length === 0) return;
    setBulkBusy(true);
    onError(null);
    try {
      for (const tag of targets) {
        await patchAdminScriptLab({
          tag: {
            name: tag.name,
            repeatability: suggestedRepeatabilityForTag(tag.name),
          },
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Bulk repeatability apply failed");
    } finally {
      setBulkBusy(false);
    }
  }, [tags, onError, onSaved]);

  const applyBulkBodyScanDescriptions = useCallback(async () => {
    const targets = tags.filter((t) => {
      const suggested = suggestedDescriptionForTag(t.name);
      return suggested && !(t.description ?? "").trim();
    });
    if (targets.length === 0) return;
    setBulkBusy(true);
    onError(null);
    try {
      for (const tag of targets) {
        const description = suggestedDescriptionForTag(tag.name);
        if (!description) continue;
        await patchAdminScriptLab({
          tag: {
            name: tag.name,
            description,
          },
        });
      }
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Bulk description apply failed");
    } finally {
      setBulkBusy(false);
    }
  }, [tags, onError, onSaved]);

  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">
        Metadata-only editor — updates tag fields in the live library without touching variants.
        Bulk metadata JSON import lives under Segment library → Import / export JSON (Tag metadata
        mode). Each inline save preserves all variant text and audio.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
          Show
        </span>
        {(
          [
            ["all", "All segments"],
            ["needs-repeatability", `Needs repeatability (${needsRepeatabilityCount})`],
            ["needs-description", `Needs description (${needsDescriptionCount})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setBulkFilter(id)}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              bulkFilter === id
                ? "border-accent/50 bg-accent-soft/60 text-accent-link"
                : "border-border bg-background text-muted"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={bulkBusy || needsRepeatabilityCount === 0}
          onClick={() => void applyBulkRepeatability()}
          className="cursor-pointer rounded-full border border-border px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
        >
          Apply standard repeatability to unclassified
        </button>
        <button
          type="button"
          disabled={bulkBusy}
          onClick={() => void applyBulkBodyScanDescriptions()}
          className="cursor-pointer rounded-full border border-border px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
        >
          Apply BODY_SCAN descriptions
        </button>
      </div>

      {filteredTags.length === 0 ? (
        <p className="rounded-xl border border-border bg-background/50 p-4 text-sm text-muted">
          No segments match this filter.
        </p>
      ) : (
        <ul className="max-h-[min(70vh,42rem)] divide-y divide-border overflow-y-auto overscroll-y-contain rounded-xl border border-border">
          {filteredTags.map((tag) => {
            const draft = drafts[tag.name] ?? draftFromTag(tag);
            const dirty = !draftsEqual(draft, draftFromTag(tag));
            const saving = savingTags.has(tag.name);
            const active = selectedTag === tag.name;
            return (
              <li
                key={tag.name}
                className={`p-3 ${active ? "bg-accent-soft/30" : "bg-card"}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectTag(tag.name)}
                    className="cursor-pointer text-left font-mono text-xs font-semibold text-foreground"
                  >
                    {tag.name}
                  </button>
                  <span className="flex flex-wrap gap-1">
                    {!tag.repeatabilityExplicit ? (
                      <span className="rounded-full border border-amber-400/60 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        repeatability unset
                      </span>
                    ) : null}
                    {!(tag.description ?? "").trim() ? (
                      <span className="rounded-full border border-amber-400/60 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                        no description
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="mt-2 grid gap-2 lg:grid-cols-2">
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        checked={draft.scope === "general"}
                        onChange={() => updateDraft(tag.name, { scope: "general", types: [] })}
                      />
                      General
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        checked={draft.scope === "types"}
                        onChange={() => updateDraft(tag.name, { scope: "types" })}
                      />
                      Type-restricted
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={draft.lengthTiered}
                        onChange={(e) =>
                          updateDraft(tag.name, { lengthTiered: e.target.checked })
                        }
                      />
                      Length-tiered
                    </label>
                  </div>

                  <label className="text-xs">
                    Repeatability
                    <select
                      value={draft.repeatability}
                      onChange={(e) =>
                        updateDraft(tag.name, {
                          repeatability: e.target.value as ScriptSegmentRepeatability | "",
                        })
                      }
                      className="mt-0.5 block w-full rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      <option value="">— choose —</option>
                      <option value="singular">singular (at most once)</option>
                      <option value="connective">connective (may repeat)</option>
                    </select>
                    {!tag.repeatabilityExplicit && draft.repeatability === "" ? (
                      <span className="mt-0.5 block text-[10px] text-muted">
                        Effective until set: {tag.repeatability} (inferred)
                      </span>
                    ) : null}
                  </label>
                </div>

                {draft.scope === "types" ? (
                  <select
                    multiple
                    value={draft.types}
                    onChange={(e) =>
                      updateDraft(tag.name, {
                        types: Array.from(e.target.selectedOptions).map((o) => o.value),
                      })
                    }
                    className="mt-2 min-h-[4rem] w-full rounded border border-border bg-background px-2 py-1 text-xs"
                    aria-label={`Types for ${tag.name}`}
                  >
                    {MEDITATION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                ) : null}

                <label className="mt-2 block text-xs">
                  Description / boundaries
                  <textarea
                    value={draft.description}
                    onChange={(e) => updateDraft(tag.name, { description: e.target.value })}
                    rows={3}
                    placeholder="What this segment covers; overlap guidance vs related tags…"
                    className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                  />
                </label>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={saving || bulkBusy || !dirty}
                    onClick={() => void saveTagMetadata(tag.name)}
                    className="cursor-pointer rounded-full border border-border px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save metadata"}
                  </button>
                  {suggestedDescriptionForTag(tag.name) &&
                  draft.description !== suggestedDescriptionForTag(tag.name) ? (
                    <button
                      type="button"
                      disabled={saving || bulkBusy}
                      onClick={() =>
                        updateDraft(tag.name, {
                          description: suggestedDescriptionForTag(tag.name) ?? "",
                        })
                      }
                      className="cursor-pointer text-[11px] text-accent-link underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      Use suggested BODY_SCAN text
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
