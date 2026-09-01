"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listAdminScriptLab,
  exportAdminScriptLab,
  patchAdminScriptLab,
  postAdminScriptLab,
  fetchJournalStoreRemote,
  MEDITATION_TARGET_MINUTES,
  type MeditationTargetMinutes,
  type ScriptLabFlow,
  type ScriptLabState,
  type ScriptLabVariant,
  type ScriptLabVariantAudio,
} from "@/lib/medimade-api";
import type { JournalEntry, JournalFolder } from "@/lib/journal-storage";
import {
  estimateScriptLabDurationSeconds,
  formatDurationClock,
  pickRandomEligibleVariant,
  buildPreviewContextTags,
  resolvedPreviewMeditationType,
  scopeLabel,
} from "@/lib/script-lab-estimate";
import {
  computeLibraryCoverage,
  SCRIPT_LAB_MEDITATION_TYPES,
} from "@/lib/script-lab-coverage";
import {
  isValidConstraintTag,
  normalizeConstraintTag,
} from "@/lib/script-constraint-tags";
import {
  normalizeScriptSegmentTag,
  renderScriptWithSegmentVariants,
  tokenizeScriptSegmentTags,
  type ScriptLengthTier,
} from "@/lib/script-segment-tags";
import {
  ScriptLabTestFlowPanel,
  type ScriptLabFlowGenerationInput,
} from "@/components/script-lab-test-flow-panel";

const MEDITATION_TYPES = SCRIPT_LAB_MEDITATION_TYPES;

const DEFAULT_COVERAGE_THRESHOLD = 3;

const FLOWS: Array<{ id: ScriptLabFlow; label: string }> = [
  { id: "by-type", label: "By type" },
  { id: "guide-chat", label: "Guide chat" },
  { id: "journal", label: "Journal entry" },
  { id: "single-prompt", label: "Single prompt" },
];

type PreviewMode = "raw" | "rendered";

function audioUrl(baseUrl: string | undefined, row: ScriptLabVariantAudio | undefined): string | null {
  if (!baseUrl || !row?.s3Key) return null;
  return `${baseUrl.replace(/\/$/, "")}/${row.s3Key}?v=${encodeURIComponent(row.updatedAt)}`;
}

export function AdminScriptLabPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ScriptLabState | null>(null);

  const [rawScript, setRawScript] = useState("");
  const [renderedScript, setRenderedScript] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("raw");
  const [renderPicks, setRenderPicks] = useState<Record<string, string>>({});

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState("");

  const [flow, setFlow] = useState<ScriptLabFlow>("by-type");
  const [flowGenerationInput, setFlowGenerationInput] =
    useState<ScriptLabFlowGenerationInput>({
      flow: "by-type",
      transcript: "",
      journalMode: false,
      meditationStyle: MEDITATION_TYPES[0],
      userTextSample: "",
      ready: false,
    });
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalFolders, setJournalFolders] = useState<JournalFolder[]>([]);
  const [targetMinutes, setTargetMinutes] = useState<MeditationTargetMinutes>(5);
  const [voiceModelId, setVoiceModelId] = useState("");
  const [generateBusy, setGenerateBusy] = useState(false);

  const [scopeDraft, setScopeDraft] = useState<"general" | "types">("general");
  const [typesDraft, setTypesDraft] = useState<string[]>([]);
  const [lengthTieredDraft, setLengthTieredDraft] = useState(false);
  const [newVariantText, setNewVariantText] = useState("");
  const [newVariantLengthTier, setNewVariantLengthTier] = useState<ScriptLengthTier>("medium");
  const [saveTagBusy, setSaveTagBusy] = useState(false);
  const [audioBusyKey, setAudioBusyKey] = useState<string | null>(null);
  const [bulkSpeakerId, setBulkSpeakerId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [coverageThreshold, setCoverageThreshold] = useState(DEFAULT_COVERAGE_THRESHOLD);
  const [coverageDetailTag, setCoverageDetailTag] = useState<string | null>(null);
  const [newConstraintTag, setNewConstraintTag] = useState("");

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingUrl, setPreviewingUrl] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await listAdminScriptLab();
    setState(data);
    setVoiceModelId((current) => current || data.speakers[0]?.modelId || "");
    setBulkSpeakerId((current) => current || data.speakers[0]?.modelId || "");
  }, []);

  useEffect(() => {
    void reload()
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load Script Lab"))
      .finally(() => setLoading(false));
  }, [reload]);

  useEffect(() => {
    void fetchJournalStoreRemote()
      .then((store) => {
        const entries = [...(store?.entries ?? [])].sort(
          (a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
        );
        setJournalEntries(entries.slice(0, 40));
        setJournalFolders(store?.folders ?? []);
      })
      .catch(() => {
        setJournalEntries([]);
        setJournalFolders([]);
      });
  }, []);

  const handleFlowGenerationInputChange = useCallback(
    (input: ScriptLabFlowGenerationInput) => {
      setFlowGenerationInput(input);
    },
    [],
  );

  const previewMeditationType = useMemo(
    () =>
      resolvedPreviewMeditationType({
        flow: flowGenerationInput.flow,
        meditationStyle: flowGenerationInput.meditationStyle,
      }),
    [flowGenerationInput.flow, flowGenerationInput.meditationStyle],
  );

  const previewContextTags = useMemo(
    () =>
      buildPreviewContextTags({
        flow: flowGenerationInput.flow,
        meditationStyle: flowGenerationInput.meditationStyle,
        userTextSample: flowGenerationInput.userTextSample,
      }),
    [
      flowGenerationInput.flow,
      flowGenerationInput.meditationStyle,
      flowGenerationInput.userTextSample,
    ],
  );

  const variantsByTagForEstimate = useMemo(() => {
    if (!state) return {};
    const out: Record<
      string,
      Array<{
        variantId: string;
        text: string;
        lengthTier?: ScriptLengthTier | null;
        excludedConstraints?: string[];
        requiredConstraints?: string[];
        audio?: { modelId: string; durationSeconds: number }[];
      }>
    > = {};
    for (const tag of state.tags) {
      out[tag.name] = (state.variantsByTag[tag.name] ?? []).map((v) => ({
        variantId: v.variantId,
        text: v.text,
        lengthTier: v.lengthTier,
        requiredConstraints: v.requiredConstraints,
        excludedConstraints: v.excludedConstraints,
        audio: (state.audioByVariantKey[`${tag.name}#${v.variantId}`] ?? []).map((a) => ({
          modelId: a.modelId,
          durationSeconds: a.durationSeconds,
        })),
      }));
    }
    return out;
  }, [state]);

  const tagMetaByName = useMemo(() => {
    if (!state) return {};
    const out: Record<
      string,
      { lengthTiered: boolean; scope: "general" | "types"; types: string[] }
    > = {};
    for (const tag of state.tags) {
      out[tag.name] = {
        lengthTiered: tag.lengthTiered,
        scope: tag.scope,
        types: tag.types,
      };
    }
    return out;
  }, [state]);

  const coverageByTag = useMemo(() => {
    if (!state) return {};
    return computeLibraryCoverage({
      tags: state.tags.map((t) => ({
        name: t.name,
        scope: t.scope,
        types: t.types,
      })),
      variantsByTag: Object.fromEntries(
        Object.entries(state.variantsByTag).map(([tag, variants]) => [
          tag,
          variants.map((v) => ({
            requiredConstraints: v.requiredConstraints,
            excludedConstraints: v.excludedConstraints,
          })),
        ]),
      ),
      threshold: coverageThreshold,
    });
  }, [state, coverageThreshold]);

  const durationEstimate = useMemo(() => {
    if (!rawScript.trim() || !voiceModelId) return null;
    return estimateScriptLabDurationSeconds({
      rawScript,
      targetMinutes,
      modelId: voiceModelId,
      meditationType: previewMeditationType,
      contextTags: previewContextTags,
      variantsByTag: variantsByTagForEstimate,
      tagMetaByName,
      picksByTag: previewMode === "rendered" ? renderPicks : undefined,
    });
  }, [
    rawScript,
    voiceModelId,
    targetMinutes,
    previewMeditationType,
    previewContextTags,
    variantsByTagForEstimate,
    tagMetaByName,
    previewMode,
    renderPicks,
  ]);

  function fillPlaceholdersRandom() {
    const picks: Record<string, string> = {};
    const rendered = renderScriptWithSegmentVariants(rawScript, (tag) => {
      const variants = state?.variantsByTag[tag] ?? [];
      const tagMeta = state?.tags.find((t) => t.name === tag);
      const picked =
        picks[tag] != null
          ? variants.find((v) => v.variantId === picks[tag])
          : pickRandomEligibleVariant(
              variants.map((v) => ({
                variantId: v.variantId,
                text: v.text,
                lengthTier: v.lengthTier,
                requiredConstraints: v.requiredConstraints,
                excludedConstraints: v.excludedConstraints,
              })),
              tagMeta
                ? {
                    lengthTiered: tagMeta.lengthTiered,
                    scope: tagMeta.scope,
                    types: tagMeta.types,
                  }
                : undefined,
              targetMinutes,
              previewMeditationType,
              previewContextTags,
            );
      if (!picked) return null;
      picks[tag] = picked.variantId;
      return picked.text;
    });
    setRenderPicks(picks);
    setRenderedScript(rendered);
    setPreviewMode("rendered");
  }

  async function generateScript() {
    if (!flowGenerationInput.ready || !flowGenerationInput.transcript.trim()) {
      setError("Complete the flow inputs before generating.");
      return;
    }
    setGenerateBusy(true);
    setError(null);
    try {
      const data = await postAdminScriptLab({
        action: "generate-script",
        transcript: flowGenerationInput.transcript,
        journalMode: flowGenerationInput.journalMode,
        meditationStyle: flowGenerationInput.meditationStyle,
        meditationTargetMinutes: targetMinutes,
      });
      const script = typeof data.script === "string" ? data.script : "";
      setRawScript(script);
      setRenderedScript("");
      setRenderPicks({});
      setPreviewMode("raw");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Script generation failed");
    } finally {
      setGenerateBusy(false);
    }
  }

  async function createTag() {
    const name = normalizeScriptSegmentTag(newTagName);
    if (!name) return;
    setError(null);
    try {
      await patchAdminScriptLab({ tag: { name, scope: "general", types: [] } });
      setNewTagName("");
      await reload();
      setSelectedTag(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create tag");
    }
  }

  useEffect(() => {
    if (!selectedTag || !state) return;
    const tag = state.tags.find((t) => t.name === selectedTag);
    if (!tag) return;
    setScopeDraft(tag.scope);
    setTypesDraft(tag.types);
    setLengthTieredDraft(tag.lengthTiered);
  }, [selectedTag, state]);

  async function saveTagScope() {
    if (!selectedTag) return;
    setSaveTagBusy(true);
    setError(null);
    try {
      await patchAdminScriptLab({
        tag: {
          name: selectedTag,
          scope: scopeDraft,
          types: scopeDraft === "types" ? typesDraft : [],
          lengthTiered: lengthTieredDraft,
        },
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save tag scope");
    } finally {
      setSaveTagBusy(false);
    }
  }

  async function addVariant() {
    if (!selectedTag || !newVariantText.trim()) return;
    setError(null);
    try {
      const tag = state?.tags.find((t) => t.name === selectedTag);
      await patchAdminScriptLab({
        variant: {
          tagName: selectedTag,
          text: newVariantText.trim(),
          lengthTier: tag?.lengthTiered ? newVariantLengthTier : null,
        },
      });
      setNewVariantText("");
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add variant");
    }
  }

  async function updateVariantLengthTier(v: ScriptLabVariant, lengthTier: ScriptLengthTier) {
    setError(null);
    try {
      await patchAdminScriptLab({
        variant: {
          tagName: v.tagName,
          variantId: v.variantId,
          text: v.text,
          lengthTier,
          requiredConstraints: v.requiredConstraints,
          excludedConstraints: v.excludedConstraints,
        },
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save length tier");
    }
  }

  async function updateVariantConstraints(
    v: ScriptLabVariant,
    requiredConstraints: string[],
    excludedConstraints: string[],
  ) {
    setError(null);
    try {
      await patchAdminScriptLab({
        variant: {
          tagName: v.tagName,
          variantId: v.variantId,
          text: v.text,
          lengthTier: v.lengthTier,
          requiredConstraints,
          excludedConstraints,
        },
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save constraints");
    }
  }

  async function addConstraintTag(raw: string) {
    const tag = normalizeConstraintTag(raw);
    if (!isValidConstraintTag(tag)) {
      setError("Constraint tag must be lowercase letters, numbers, underscore (min 2 chars).");
      return;
    }
    setError(null);
    try {
      await patchAdminScriptLab({ constraintTag: { tag } });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add constraint tag");
    }
  }

  async function deleteConstraintTag(tag: string) {
    if (!window.confirm(`Remove constraint tag "${tag}" from vocabulary?`)) return;
    setError(null);
    try {
      await postAdminScriptLab({ action: "delete-constraint-tag", tag });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete constraint tag");
    }
  }

  async function updateVariantText(v: ScriptLabVariant, text: string) {
    setError(null);
    try {
      await patchAdminScriptLab({
        variant: { tagName: v.tagName, variantId: v.variantId, text },
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save variant");
    }
  }

  async function deleteVariant(v: ScriptLabVariant) {
    if (!window.confirm("Delete this variant and its sample audio?")) return;
    setError(null);
    try {
      await postAdminScriptLab({
        action: "delete-variant",
        tagName: v.tagName,
        variantId: v.variantId,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete variant");
    }
  }

  async function generateAudio(tagName: string, variantId: string, modelId: string) {
    const key = `${tagName}:${variantId}:${modelId}`;
    setAudioBusyKey(key);
    setError(null);
    try {
      await postAdminScriptLab({
        action: "generate-variant-audio",
        tagName,
        variantId,
        modelId,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Audio generation failed");
    } finally {
      setAudioBusyKey(null);
    }
  }

  async function generateAllSpeakers(tagName: string, variantId: string) {
    const key = `${tagName}:${variantId}:all`;
    setAudioBusyKey(key);
    setError(null);
    try {
      await postAdminScriptLab({
        action: "generate-variant-all-speakers",
        tagName,
        variantId,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk audio failed");
    } finally {
      setAudioBusyKey(null);
    }
  }

  async function backfillSpeaker() {
    if (!bulkSpeakerId) return;
    setBulkBusy(true);
    setError(null);
    try {
      await postAdminScriptLab({
        action: "generate-library-for-speaker",
        modelId: bulkSpeakerId,
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Library backfill failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function importSegments() {
    setImportBusy(true);
    setError(null);
    setImportSummary(null);
    setImportErrors([]);
    try {
      let payload: unknown;
      try {
        payload = JSON.parse(importJson);
      } catch {
        throw new Error("Invalid JSON — check syntax and try again.");
      }
      const data = await postAdminScriptLab({
        action: "import-segments",
        payload,
      });
      if (Array.isArray(data.errors)) {
        setImportErrors(
          data.errors as Array<{ path: string; message: string }>,
        );
        return;
      }
      const summary = data.summary as ImportSummary | undefined;
      if (summary) {
        setImportSummary(formatImportSummary(summary));
      }
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImportBusy(false);
    }
  }

  async function fetchExportJson(): Promise<string> {
    const payload = await exportAdminScriptLab();
    return JSON.stringify({ segments: payload.segments }, null, 2);
  }

  async function downloadExport() {
    setExportBusy(true);
    setError(null);
    try {
      const text = await fetchExportJson();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `script-segments-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportBusy(false);
    }
  }

  async function copyExportToClipboard() {
    setExportBusy(true);
    setError(null);
    try {
      const text = await fetchExportJson();
      await navigator.clipboard.writeText(text);
      setImportSummary("Segment library JSON copied to clipboard.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setExportBusy(false);
    }
  }

  function loadImportFile(file: File | null) {
    if (!file) return;
    void file.text().then(setImportJson).catch(() => {
      setError("Could not read file");
    });
  }

  function togglePreview(url: string | null) {
    const el = previewAudioRef.current;
    if (!el || !url) return;
    if (previewingUrl === url && !el.paused) {
      el.pause();
      setPreviewingUrl(null);
      return;
    }
    el.src = url;
    void el.play().then(() => setPreviewingUrl(url)).catch(() => setPreviewingUrl(null));
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading Script Lab…</p>;
  }

  const selectedVariants = selectedTag ? state?.variantsByTag[selectedTag] ?? [] : [];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <audio
        ref={previewAudioRef}
        className="hidden"
        onEnded={() => setPreviewingUrl(null)}
      />

      {/* Left — working column (app styling) */}
      <div className="min-w-0 flex-1 space-y-6">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-medium">Script preview</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
                {(["raw", "rendered"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPreviewMode(mode)}
                    className={`cursor-pointer rounded-full px-3 py-1 font-medium capitalize ${
                      previewMode === mode
                        ? "bg-accent-soft text-accent-link"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {mode === "raw" ? "Raw (tags)" : "Rendered"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!rawScript.trim()}
                onClick={fillPlaceholdersRandom}
                className="cursor-pointer rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent-soft/40 disabled:opacity-50"
              >
                Fill placeholders (random)
              </button>
            </div>
          </div>

          <div className="mt-3 min-h-[12rem] max-h-[28rem] overflow-y-auto scroll-styled rounded-xl border border-border bg-background/80 p-4 text-sm leading-relaxed text-foreground">
            {!rawScript.trim() ? (
              <p className="text-muted">Generate a test script from the panel on the right.</p>
            ) : previewMode === "rendered" ? (
              renderedScript.trim() ? (
                <pre className="whitespace-pre-wrap font-sans">{renderedScript}</pre>
              ) : (
                <p className="text-muted">Click “Fill placeholders (random)” to render tags.</p>
              )
            ) : (
              <div className="whitespace-pre-wrap font-sans">
                {tokenizeScriptSegmentTags(rawScript).map((tok, i) =>
                  tok.type === "tag" ? (
                    <span
                      key={`${tok.name}-${i}`}
                      className="mx-0.5 inline-flex rounded-full border border-accent/40 bg-accent-soft/60 px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-accent-link"
                    >
                      {tok.name}
                    </span>
                  ) : (
                    <span key={`t-${i}`}>{tok.value}</span>
                  ),
                )}
              </div>
            )}
          </div>

          {durationEstimate ? (
            <p className="mt-2 text-xs text-muted">
              Est. duration:{" "}
              <span className="font-semibold text-foreground">
                {formatDurationClock(durationEstimate.totalSeconds)}
              </span>{" "}
              (target: {targetMinutes} min) — context: {previewContextTags.join(", ")} — pauses{" "}
              {formatDurationClock(durationEstimate.pauseSeconds)}, segments{" "}
              {formatDurationClock(durationEstimate.segmentSeconds)}, custom ~{" "}
              {durationEstimate.customWordCount} words
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-lg font-medium">Segment library</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="NEW_TAG_NAME"
                className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-xs uppercase"
              />
              <button
                type="button"
                onClick={() => void createTag()}
                className="cursor-pointer rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-link"
              >
                + New segment
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <label className="text-xs text-muted">
              Backfill speaker
              <select
                value={bulkSpeakerId}
                onChange={(e) => setBulkSpeakerId(e.target.value)}
                className="mt-1 block rounded border border-border bg-background px-2 py-1 text-xs"
              >
                {(state?.speakers ?? []).map((s) => (
                  <option key={s.modelId} value={s.modelId}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={bulkBusy || !bulkSpeakerId}
              onClick={() => void backfillSpeaker()}
              className="cursor-pointer rounded border border-border px-2 py-1 text-xs font-medium disabled:opacity-50"
            >
              {bulkBusy ? "Generating…" : "Generate all variants for speaker"}
            </button>
          </div>

          <details className="mt-3 rounded-xl border border-border bg-background/50 p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Import / export JSON
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={exportBusy}
                onClick={() => void downloadExport()}
                className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {exportBusy ? "Exporting…" : "Export JSON (download)"}
              </button>
              <button
                type="button"
                disabled={exportBusy}
                onClick={() => void copyExportToClipboard()}
                className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                Copy export to clipboard
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              Export includes variant IDs for edit-in-place re-import. Audio is not included.
              Import upserts tags by name; variants with an id update in place, variants without id
              match by exact text or are created fresh.
            </p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              rows={6}
              placeholder='{"segments":[{"tag":"SETTLE_OPENER","scope":"general","types":[],"lengthTiered":true,"variants":[{"text":"…","lengthTier":"short","requiredConstraints":[],"excludedConstraints":[]}]}]}'
              className="mt-2 w-full rounded-lg border border-border bg-background px-2 py-1.5 font-mono text-[11px]"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="cursor-pointer rounded border border-border px-2 py-1 text-xs">
                Upload file
                <input
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => loadImportFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                type="button"
                disabled={importBusy || !importJson.trim()}
                onClick={() => void importSegments()}
                className="cursor-pointer rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-link disabled:opacity-50"
              >
                {importBusy ? "Importing…" : "Import JSON"}
              </button>
            </div>
            {importSummary ? (
              <p className="mt-2 text-xs text-foreground">{importSummary}</p>
            ) : null}
            {importErrors.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-danger">
                {importErrors.map((err) => (
                  <li key={`${err.path}-${err.message}`}>
                    {err.path ? `${err.path}: ` : ""}
                    {err.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </details>

          <div className="mt-3 rounded-xl border border-border bg-background/50 p-3">
            <h3 className="text-sm font-medium">Constraint vocabulary</h3>
            <p className="mt-1 text-xs text-muted">
              Known tags for variant required/excluded constraints. Pick from the list when editing variants.
            </p>
            <div className="mt-2 flex flex-wrap gap-1">
              {(state?.constraintVocabulary ?? []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => void deleteConstraintTag(tag)}
                    className="cursor-pointer text-muted hover:text-danger"
                    aria-label={`Remove ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newConstraintTag}
                onChange={(e) => setNewConstraintTag(e.target.value)}
                list="constraint-vocab-list"
                placeholder="new_constraint_tag"
                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
              />
              <datalist id="constraint-vocab-list">
                {(state?.constraintVocabulary ?? []).map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <button
                type="button"
                onClick={() => {
                  void addConstraintTag(newConstraintTag);
                  setNewConstraintTag("");
                }}
                className="cursor-pointer shrink-0 rounded-full border border-border px-3 py-1 text-xs font-semibold"
              >
                Create tag
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <label className="text-xs text-muted">
              Coverage min variants
              <input
                type="number"
                min={1}
                max={20}
                value={coverageThreshold}
                onChange={(e) =>
                  setCoverageThreshold(Math.max(1, Number(e.target.value) || DEFAULT_COVERAGE_THRESHOLD))
                }
                className="mt-1 block w-16 rounded border border-border bg-background px-2 py-1 text-xs"
              />
            </label>
            <p className="text-[10px] text-muted">
              Warn when any applicable type has fewer eligible variants than this threshold.
            </p>
          </div>

          <ul className="mt-3 max-h-48 divide-y divide-border overflow-y-auto overscroll-y-contain rounded-xl border border-border">
            {(state?.tags ?? []).length === 0 ? (
              <li className="p-4 text-sm text-muted">No segments yet.</li>
            ) : (
              (state?.tags ?? []).map((tag) => {
                const count = state?.variantsByTag[tag.name]?.length ?? 0;
                const active = selectedTag === tag.name;
                const coverage = coverageByTag[tag.name];
                const lowCoverage =
                  coverage != null && coverage.underThresholdContexts.length > 0;
                return (
                  <li key={tag.name}>
                    <div
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-sm ${
                        active ? "bg-accent-soft/40" : "hover:bg-accent-soft/20"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTag(tag.name);
                          setCoverageDetailTag(null);
                        }}
                        className="min-w-0 flex-1 cursor-pointer text-left"
                      >
                        <span className="font-mono text-xs font-semibold">{tag.name}</span>
                      </button>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                        {lowCoverage ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTag(tag.name);
                              setCoverageDetailTag(tag.name);
                            }}
                            className="cursor-pointer rounded-full border border-amber-400/60 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                            title={`Min eligible: ${coverage?.minEligibleCount ?? 0} (threshold ${coverageThreshold})`}
                          >
                            Coverage {coverage?.minEligibleCount ?? 0}/{coverageThreshold}
                          </button>
                        ) : coverage != null && count > 0 ? (
                          <span className="text-[10px] text-muted">
                            min {coverage.minEligibleCount}
                          </span>
                        ) : null}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            tag.scope === "general"
                              ? "border border-accent/30 bg-accent-soft/50 text-accent-link"
                              : "border border-border bg-background text-muted"
                          }`}
                        >
                          {scopeLabel(tag.scope, tag.types)}
                        </span>
                        {tag.lengthTiered ? (
                          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted">
                            Length tiers
                          </span>
                        ) : null}
                        <span className="text-xs text-muted">{count} variants</span>
                      </span>
                    </div>
                    {coverageDetailTag === tag.name && coverage ? (
                      <div className="border-t border-border bg-background/60 px-4 py-3 text-xs">
                        <p className="font-medium text-foreground">Coverage by type (default context)</p>
                        {coverage.underThresholdContexts.length > 0 ? (
                          <p className="mt-1 text-amber-800 dark:text-amber-200">
                            Under threshold ({coverageThreshold}):{" "}
                            {coverage.underThresholdContexts
                              .map((row) => `${row.label} (${row.eligibleCount})`)
                              .join(", ")}
                          </p>
                        ) : (
                          <p className="mt-1 text-muted">
                            All applicable types meet the threshold (min{" "}
                            {coverage.minEligibleCount}).
                          </p>
                        )}
                        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                          {coverage.countsByContext.map((row) => (
                            <li
                              key={row.label}
                              className={
                                row.eligibleCount < coverageThreshold
                                  ? "text-amber-800 dark:text-amber-200"
                                  : "text-muted"
                              }
                            >
                              {row.label}: {row.eligibleCount} eligible
                              <span className="block font-mono text-[10px] opacity-70">
                                [{row.contextTags.join(", ")}]
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
        </section>

        {selectedTag ? (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <h2 className="font-display text-lg font-medium">{selectedTag}</h2>
            <p className="mt-1 text-xs text-muted">Variant editor — scope applies to the whole tag.</p>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scopeDraft === "general"}
                  onChange={() => setScopeDraft("general")}
                />
                General
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  checked={scopeDraft === "types"}
                  onChange={() => setScopeDraft("types")}
                />
                Type-restricted
              </label>
              {scopeDraft === "types" ? (
                <select
                  multiple
                  value={typesDraft}
                  onChange={(e) =>
                    setTypesDraft(
                      Array.from(e.target.selectedOptions).map((o) => o.value),
                    )
                  }
                  className="min-h-[4.5rem] rounded border border-border bg-background px-2 py-1 text-xs"
                >
                  {MEDITATION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                disabled={saveTagBusy}
                onClick={() => void saveTagScope()}
                className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-semibold disabled:opacity-50"
              >
                Save scope
              </button>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={lengthTieredDraft}
                  onChange={(e) => setLengthTieredDraft(e.target.checked)}
                />
                Length-tiered variants
              </label>
            </div>

            <div className="mt-3 space-y-1">
              {selectedVariants.map((v) => (
                <VariantEditorRow
                  key={v.variantId}
                  variant={v}
                  lengthTiered={lengthTieredDraft}
                  constraintVocabulary={state?.constraintVocabulary ?? []}
                  onCreateConstraintTag={(tag) => void addConstraintTag(tag)}
                  speakers={state?.speakers ?? []}
                  baseUrl={state?.baseUrl}
                  audio={state?.audioByVariantKey[`${v.tagName}#${v.variantId}`] ?? []}
                  audioBusyKey={audioBusyKey}
                  previewingUrl={previewingUrl}
                  onSaveText={(text) => void updateVariantText(v, text)}
                  onSaveLengthTier={(tier) => void updateVariantLengthTier(v, tier)}
                  onSaveConstraints={(required, excluded) =>
                    void updateVariantConstraints(v, required, excluded)
                  }
                  onDelete={() => void deleteVariant(v)}
                  onGenerate={(modelId) => void generateAudio(v.tagName, v.variantId, modelId)}
                  onGenerateAll={() => void generateAllSpeakers(v.tagName, v.variantId)}
                  onPreview={togglePreview}
                />
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <textarea
                value={newVariantText}
                onChange={(e) => setNewVariantText(e.target.value)}
                rows={2}
                placeholder="New variant text…"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm"
              />
              {lengthTieredDraft ? (
                <select
                  value={newVariantLengthTier}
                  onChange={(e) =>
                    setNewVariantLengthTier(e.target.value as ScriptLengthTier)
                  }
                  className="self-end rounded border border-border bg-background px-2 py-2 text-xs"
                  aria-label="Length tier for new variant"
                >
                  <option value="short">Short</option>
                  <option value="medium">Medium</option>
                  <option value="long">Long</option>
                </select>
              ) : null}
              <button
                type="button"
                onClick={() => void addVariant()}
                className="shrink-0 cursor-pointer self-end rounded-full bg-accent-soft px-4 py-2 text-xs font-semibold text-accent-link"
              >
                + Add variant
              </button>
            </div>
          </section>
        ) : null}
      </div>

      {/* Right — plain test panel */}
      <aside className="w-full shrink-0 space-y-3 rounded border border-neutral-300 bg-neutral-50 p-3 font-mono text-xs text-neutral-800 lg:w-72 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500">Test generation</p>

        <div className="flex flex-wrap gap-1">
          {FLOWS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFlow(f.id)}
              className={`cursor-pointer border px-2 py-1 ${
                flow === f.id
                  ? "border-neutral-800 bg-neutral-200 dark:border-neutral-300 dark:bg-neutral-700"
                  : "border-neutral-300 bg-white dark:border-neutral-600 dark:bg-neutral-800"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <ScriptLabTestFlowPanel
          flow={flow}
          targetMinutes={targetMinutes}
          journalEntries={journalEntries}
          journalFolders={journalFolders}
          onInputChange={handleFlowGenerationInputChange}
        />

        <label className="block">
          Length
          <select
            value={targetMinutes}
            onChange={(e) =>
              setTargetMinutes(Number(e.target.value) as MeditationTargetMinutes)
            }
            className="mt-1 block w-full border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-600 dark:bg-neutral-800"
          >
            {MEDITATION_TARGET_MINUTES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          Voice (preview durations)
          <select
            value={voiceModelId}
            onChange={(e) => setVoiceModelId(e.target.value)}
            className="mt-1 block w-full border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-600 dark:bg-neutral-800"
          >
            {(state?.speakers ?? []).map((s) => (
              <option key={s.modelId} value={s.modelId}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={generateBusy || !flowGenerationInput.ready}
          onClick={() => void generateScript()}
          className="w-full cursor-pointer border border-neutral-800 bg-neutral-900 py-2 font-semibold text-white disabled:opacity-50 dark:border-neutral-300 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {generateBusy ? "Generating…" : "Generate script →"}
        </button>

        {flow === "journal" ? (
          <p className="border-t border-neutral-300 pt-2 text-[10px] leading-snug text-neutral-600 dark:border-neutral-600 dark:text-neutral-400">
            Journal entry: no meditation type resolves reliably from the entry alone, so
            generation draws only General-scope segments unless the model also infers a type
            with matching restricted segments.
          </p>
        ) : null}

        {error ? (
          <p className="border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

type ImportSummary = {
  tagsCreated?: number;
  tagsUpdated?: number;
  variantsAdded?: number;
  variantsUpdatedById?: number;
  variantsUpdatedByTextMatch?: number;
  variantsUnchanged?: number;
  variantsIdNotFound?: Array<{ tag: string; id: string }>;
  variantsAudioInvalidated?: number;
  constraintTagsAdded?: string[];
};

function formatImportSummary(summary: ImportSummary): string {
  const parts = [
    `Tags: ${summary.tagsCreated ?? 0} created, ${summary.tagsUpdated ?? 0} updated.`,
    `Variants: ${summary.variantsAdded ?? 0} created, ${summary.variantsUpdatedById ?? 0} updated by ID, ${summary.variantsUpdatedByTextMatch ?? 0} updated by text match, ${summary.variantsUnchanged ?? 0} unchanged.`,
  ];
  if ((summary.variantsAudioInvalidated ?? 0) > 0) {
    parts.push(`${summary.variantsAudioInvalidated} variant(s) had audio invalidated (text changed).`);
  }
  const missing = summary.variantsIdNotFound ?? [];
  if (missing.length > 0) {
    parts.push(
      `Unknown variant IDs (${missing.length}): ${missing.map((m) => `${m.tag}/${m.id}`).join(", ")}.`,
    );
  }
  if ((summary.constraintTagsAdded?.length ?? 0) > 0) {
    parts.push(`New constraint tags: ${summary.constraintTagsAdded!.join(", ")}.`);
  }
  return parts.join(" ");
}

function ConstraintTagPicker({
  label,
  tags,
  vocabulary,
  listId,
  onChange,
  onCreateTag,
  compact = false,
}: {
  label: string;
  tags: string[];
  vocabulary: string[];
  listId: string;
  onChange: (tags: string[]) => void;
  onCreateTag: (tag: string) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addTag(raw: string) {
    const tag = normalizeConstraintTag(raw);
    if (!tag || !isValidConstraintTag(tag)) return;
    if (!vocabulary.includes(tag)) onCreateTag(tag);
    if (!tags.includes(tag)) onChange([...tags, tag]);
    setDraft("");
  }

  if (compact) {
    return (
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[10px] font-medium text-muted">{label}</span>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            list={listId}
            placeholder="add…"
            className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag(draft);
              }
            }}
          />
          <datalist id={listId}>
            {vocabulary.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => addTag(draft)}
            className="cursor-pointer shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px]"
          >
            Add
          </button>
        </div>
        {tags.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-0.5 rounded-full border border-border bg-background px-1.5 py-0 font-mono text-[10px]"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => onChange(tags.filter((t) => t !== tag))}
                  className="cursor-pointer text-muted hover:text-danger"
                  aria-label={`Remove ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <p className="text-[10px] font-medium text-muted">{label}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px]"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="cursor-pointer text-muted hover:text-danger"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          list={listId}
          placeholder="Add constraint…"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[10px]"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag(draft);
            }
          }}
        />
        <datalist id={listId}>
          {vocabulary.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => addTag(draft)}
          className="cursor-pointer shrink-0 rounded border border-border px-2 py-1 text-[10px]"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function speakerAudioGenerated(row: ScriptLabVariantAudio | undefined): boolean {
  return row?.status === "generated" && !!row.s3Key;
}

function ChevronToggle({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform ${expanded ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function SpeakerStatusDots({
  speakers,
  audio,
}: {
  speakers: Array<{ modelId: string; name: string }>;
  audio: ScriptLabVariantAudio[];
}) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {speakers.map((sp) => {
        const row = audio.find((a) => a.modelId === sp.modelId);
        const generated = speakerAudioGenerated(row);
        const generating = row?.status === "generating";
        const failed = row?.status === "failed";
        const tooltip = generated
          ? `${sp.name}${row?.durationSeconds ? ` · ${row.durationSeconds.toFixed(1)}s` : ""}`
          : failed
            ? `${sp.name} · failed`
            : generating
              ? `${sp.name} · generating…`
              : `${sp.name} · not generated`;
        return (
          <span
            key={sp.modelId}
            title={tooltip}
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${
              generated
                ? "bg-gold"
                : generating
                  ? "border border-gold/70 bg-gold/30"
                  : failed
                    ? "border border-danger/60 bg-danger/10"
                    : "border border-gold/50 bg-transparent"
            }`}
          />
        );
      })}
    </span>
  );
}

function VariantEditorRow({
  variant,
  lengthTiered,
  constraintVocabulary,
  onCreateConstraintTag,
  speakers,
  baseUrl,
  audio,
  audioBusyKey,
  previewingUrl,
  onSaveText,
  onSaveLengthTier,
  onSaveConstraints,
  onDelete,
  onGenerate,
  onGenerateAll,
  onPreview,
}: {
  variant: ScriptLabVariant;
  lengthTiered: boolean;
  constraintVocabulary: string[];
  onCreateConstraintTag: (tag: string) => void;
  speakers: Array<{ modelId: string; name: string }>;
  baseUrl?: string;
  audio: ScriptLabVariantAudio[];
  audioBusyKey: string | null;
  previewingUrl: string | null;
  onSaveText: (text: string) => void;
  onSaveLengthTier: (tier: ScriptLengthTier) => void;
  onSaveConstraints: (requiredConstraints: string[], excludedConstraints: string[]) => void;
  onDelete: () => void;
  onGenerate: (modelId: string) => void;
  onGenerateAll: () => void;
  onPreview: (url: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(variant.text);
  useEffect(() => setText(variant.text), [variant.text]);

  const [requiredDraft, setRequiredDraft] = useState<string[]>(variant.requiredConstraints);
  const [excludedDraft, setExcludedDraft] = useState<string[]>(variant.excludedConstraints);

  useEffect(() => {
    setRequiredDraft(variant.requiredConstraints);
    setExcludedDraft(variant.excludedConstraints);
  }, [variant.requiredConstraints, variant.excludedConstraints, variant.variantId]);

  const allBusy = audioBusyKey === `${variant.tagName}:${variant.variantId}:all`;
  const reqListId = `constraint-req-${variant.variantId}`;
  const exListId = `constraint-ex-${variant.variantId}`;
  const generatedCount = speakers.filter((sp) =>
    speakerAudioGenerated(audio.find((a) => a.modelId === sp.modelId)),
  ).length;

  return (
    <div className="rounded-lg border border-border bg-background/60">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((open) => !open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((open) => !open);
          }
        }}
        className="flex cursor-pointer items-center gap-2 px-2.5 py-2 text-left"
        aria-expanded={expanded}
      >
        <ChevronToggle expanded={expanded} />
        <span className="min-w-0 flex-1 truncate text-sm text-foreground">{variant.text}</span>
        <SpeakerStatusDots speakers={speakers} audio={audio} />
        <span className="shrink-0 tabular-nums text-[10px] text-muted">
          {generatedCount}/{speakers.length}
        </span>
      </div>

      {expanded ? (
        <div
          className="space-y-2 border-t border-border px-2.5 py-2.5"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex flex-wrap items-start gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                if (text.trim() !== variant.text) onSaveText(text.trim());
              }}
              rows={2}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
            />
            {lengthTiered ? (
              <select
                value={variant.lengthTier ?? "medium"}
                onChange={(e) => onSaveLengthTier(e.target.value as ScriptLengthTier)}
                className="rounded border border-border bg-background px-2 py-1.5 text-xs"
                aria-label="Length tier"
              >
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <ConstraintTagPicker
              compact
              label="Required:"
              tags={requiredDraft}
              vocabulary={constraintVocabulary}
              listId={reqListId}
              onChange={(next) => {
                setRequiredDraft(next);
                onSaveConstraints(next, excludedDraft);
              }}
              onCreateTag={onCreateConstraintTag}
            />
            <ConstraintTagPicker
              compact
              label="Excluded:"
              tags={excludedDraft}
              vocabulary={constraintVocabulary}
              listId={exListId}
              onChange={(next) => {
                setExcludedDraft(next);
                onSaveConstraints(requiredDraft, next);
              }}
              onCreateTag={onCreateConstraintTag}
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {speakers.map((sp) => {
              const row = audio.find((a) => a.modelId === sp.modelId);
              const url = audioUrl(baseUrl, row);
              const generated = speakerAudioGenerated(row);
              const busy = audioBusyKey === `${variant.tagName}:${variant.variantId}:${sp.modelId}`;
              const generating = row?.status === "generating" || busy;
              const failed = row?.status === "failed";
              const playing = url != null && previewingUrl === url;

              return (
                <button
                  key={sp.modelId}
                  type="button"
                  disabled={generating}
                  onClick={() => {
                    if (generated && url) {
                      onPreview(playing ? null : url);
                      return;
                    }
                    if (!generating) onGenerate(sp.modelId);
                  }}
                  className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium disabled:cursor-wait disabled:opacity-60 ${
                    generated
                      ? "border-gold/50 bg-gold/10 text-foreground"
                      : failed
                        ? "border-danger/40 bg-danger/5 text-danger"
                        : "border-border bg-background text-muted hover:border-gold/40"
                  }`}
                  title={
                    generated && row?.durationSeconds
                      ? `${sp.name} · ${row.durationSeconds.toFixed(1)}s`
                      : sp.name
                  }
                >
                  <span className="max-w-[5.5rem] truncate">{sp.name}</span>
                  {generating ? (
                    <span className="text-muted">…</span>
                  ) : generated ? (
                    <span aria-hidden>{playing ? "⏸" : "✓"}</span>
                  ) : failed ? (
                    <span aria-hidden>↻</span>
                  ) : (
                    <span aria-hidden>+</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onGenerateAll}
              disabled={allBusy}
              className="cursor-pointer rounded border border-border px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
            >
              {allBusy ? "Generating all…" : "Generate all"}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="cursor-pointer rounded border border-danger/40 px-2 py-1 text-[10px] text-danger"
            >
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
