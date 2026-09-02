"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  listAdminScriptLab,
  exportAdminScriptLab,
  importAdminScriptLabTagMetadata,
  patchAdminScriptLab,
  postAdminScriptLab,
  fetchAdminScriptLabEmbeddingProgress,
  fetchJournalStoreRemote,
  getMedimadeApiBase,
  medimadeApiAuthHeaders,
  MEDITATION_TARGET_MINUTES,
  type MeditationTargetMinutes,
  type ScriptLabEmbeddingStats,
  type ScriptLabFlow,
  type ScriptLabState,
  type ScriptLabVariant,
  type ScriptLabVariantAudio,
} from "@/lib/medimade-api";
import type { JournalEntry, JournalFolder } from "@/lib/journal-storage";
import {
  estimateScriptLabBeatsDurationSeconds,
  estimateScriptLabBeatsTextUtf8Bytes,
  formatCustomTextRatio,
  formatDurationClock,
  formatUtf8ByteCount,
  buildPreviewContextTags,
  resolvedPreviewMeditationType,
  scopeLabel,
} from "@/lib/script-lab-estimate";
import {
  createSegmentVariantPickerForBeats,
} from "@/lib/script-segment-variant-select";
import {
  buildTagRepeatabilityMap,
  flattenBeatsToPreviewTokens,
  flattenBeatsToCopyText,
  findDuplicateBeatTypeWarnings,
  formatBeatWarning,
  renderBeatsToScript,
  type ScriptLabBeat,
  type ScriptLabBeatDuplicateWarning,
} from "@/lib/script-lab-beats";
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
  type ScriptLengthTier,
  type ScriptSegmentRepeatability,
} from "@/lib/script-segment-tags";
import {
  ScriptLabTestFlowPanel,
  type ScriptLabFlowGenerationInput,
} from "@/components/script-lab-test-flow-panel";
import {
  ScriptLabBeatsPreview,
  ScriptLabBeatsVerificationToggle,
  type BeatsVerificationView,
} from "@/components/script-lab-beats-preview";
import {
  ScriptLabV3PreviewContent,
  ScriptLabV3PreviewToggle,
  ScriptLabV3PromoteBanner,
  ScriptLabV3SubstitutionStatsLine,
  computeV3SubstitutionStats,
  v3StatsViewLabel,
  type ScriptLabV3Meta,
  type V3PreviewView,
} from "@/components/script-lab-v3-preview";
import { ScriptLabSegmentPropertiesPanel } from "@/components/script-lab-segment-properties-panel";
import { AdminPauseLengthsPanel } from "@/components/admin-pause-lengths-panel";
import { ScriptLabCostStatsPanel } from "@/components/script-lab-cost-stats-panel";
import {
  buildScriptLabCostSummary,
  characterCountsFromBeats,
  parseTokenUsage,
  type TokenUsage,
} from "@/lib/script-lab-cost";

type LibraryTab = "properties" | "variants" | "pending";
type GenerationPath = "v1" | "v2" | "v3";
type SegmentImportMode = "segments" | "metadata";

const MEDITATION_TYPES = SCRIPT_LAB_MEDITATION_TYPES;

const DEFAULT_COVERAGE_THRESHOLD = 3;

const FLOWS: Array<{ id: ScriptLabFlow; label: string }> = [
  { id: "by-type", label: "By type" },
  { id: "guide-chat", label: "Guide chat" },
  { id: "journal", label: "Journal entry" },
  { id: "single-prompt", label: "Single prompt" },
];

type PreviewMode = "beats" | "tags" | "rendered";

const PREVIEW_MODES: Array<{ id: PreviewMode; label: string }> = [
  { id: "beats", label: "Beats" },
  { id: "tags", label: "Tags" },
  { id: "rendered", label: "Rendered" },
];

/** Indices in `after` that have no exact match in `before` (same idea as verification new beats). */
function computeBeatsDiffIndices(before: ScriptLabBeat[], after: ScriptLabBeat[]): number[] {
  const indices: number[] = [];
  after.forEach((beat, i) => {
    const match = before.some(
      (b) =>
        b.beatType === beat.beatType &&
        b.custom === beat.custom &&
        (b.tag ?? "") === (beat.tag ?? "") &&
        (b.text ?? "").trim() === (beat.text ?? "").trim() &&
        (b.pauseBand ?? "") === (beat.pauseBand ?? ""),
    );
    if (!match) indices.push(i);
  });
  return indices;
}

function audioUrl(baseUrl: string | undefined, row: ScriptLabVariantAudio | undefined): string | null {
  if (!baseUrl || !row?.s3Key) return null;
  return `${baseUrl.replace(/\/$/, "")}/${row.s3Key}?v=${encodeURIComponent(row.updatedAt)}`;
}

export function AdminScriptLabPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<ScriptLabState | null>(null);

  const [beats, setBeats] = useState<ScriptLabBeat[]>([]);
  const [beatsBeforeVerification, setBeatsBeforeVerification] = useState<ScriptLabBeat[]>([]);
  const [beatsPass1Skeleton, setBeatsPass1Skeleton] = useState<ScriptLabBeat[]>([]);
  const [verificationNewBeatIndices, setVerificationNewBeatIndices] = useState<number[]>([]);
  const [pass2NewBeatIndices, setPass2NewBeatIndices] = useState<number[]>([]);
  const [verificationCorrectionsApplied, setVerificationCorrectionsApplied] = useState(false);
  const [beatsVerificationView, setBeatsVerificationView] =
    useState<BeatsVerificationView>("after");
  const [v3PreviewView, setV3PreviewView] = useState<V3PreviewView>("substitution");
  const [pendingReviewFilterIds, setPendingReviewFilterIds] = useState<Set<string> | null>(
    null,
  );
  const [generationPath, setGenerationPath] = useState<GenerationPath>("v1");
  const [v2RemovedTags, setV2RemovedTags] = useState<string[]>([]);
  const [v2FocusAnchorBeats, setV2FocusAnchorBeats] = useState(0);
  const [lastGenerationPath, setLastGenerationPath] = useState<GenerationPath | null>(null);
  const [v3Meta, setV3Meta] = useState<ScriptLabV3Meta | null>(null);
  const [reassignTagDraft, setReassignTagDraft] = useState<Record<string, string>>({});
  const [pendingBusyKey, setPendingBusyKey] = useState<string | null>(null);
  const [beatWarnings, setBeatWarnings] = useState<ScriptLabBeatDuplicateWarning[]>([]);
  const [renderedScript, setRenderedScript] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("beats");
  const [renderPicks, setRenderPicks] = useState<Record<string, string>>({});
  const [copyNote, setCopyNote] = useState<string | null>(null);

  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("properties");
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
  const [fillBusy, setFillBusy] = useState(false);
  const [generationUsage, setGenerationUsage] = useState<TokenUsage | null>(null);
  const [firstPassUsage, setFirstPassUsage] = useState<TokenUsage | null>(null);
  const [fillUsage, setFillUsage] = useState<TokenUsage | null>(null);

  const [newVariantText, setNewVariantText] = useState("");
  const [newVariantLengthTier, setNewVariantLengthTier] = useState<ScriptLengthTier>("medium");
  const [audioBusyKey, setAudioBusyKey] = useState<string | null>(null);
  const [bulkSpeakerId, setBulkSpeakerId] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importMode, setImportMode] = useState<SegmentImportMode>("metadata");
  const [importBusy, setImportBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<Array<{ path: string; message: string }>>([]);
  const [coverageThreshold, setCoverageThreshold] = useState(DEFAULT_COVERAGE_THRESHOLD);
  const [coverageDetailTag, setCoverageDetailTag] = useState<string | null>(null);
  const [newConstraintTag, setNewConstraintTag] = useState("");
  const [embeddingStats, setEmbeddingStats] = useState<ScriptLabEmbeddingStats | null>(
    null,
  );
  const [embedTestBusy, setEmbedTestBusy] = useState(false);
  const [embedTestResult, setEmbedTestResult] = useState<string | null>(null);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [previewingUrl, setPreviewingUrl] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await listAdminScriptLab();
    setState(data);
    setEmbeddingStats(data.embeddingStats ?? null);
    setVoiceModelId((current) => current || data.speakers[0]?.modelId || "");
    setBulkSpeakerId((current) => current || data.speakers[0]?.modelId || "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const stats = await fetchAdminScriptLabEmbeddingProgress();
        if (!cancelled) setEmbeddingStats(stats);
      } catch {
        /* keep last stats visible */
      }
    };
    void poll();
    const intervalMs = 5000;
    const id = window.setInterval(() => void poll(), intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
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
        direction?: string | null;
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
        direction: v.direction,
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

  const tagRepeatabilityByName = useMemo(
    () => (state ? buildTagRepeatabilityMap(state.tags) : {}),
    [state],
  );

  const tagMetaByName = useMemo(() => {
    if (!state) return {};
    const out: Record<
      string,
      {
        lengthTiered: boolean;
        scope: "general" | "types";
        types: string[];
        repeatability: ScriptSegmentRepeatability;
      }
    > = {};
    for (const tag of state.tags) {
      out[tag.name] = {
        lengthTiered: tag.lengthTiered,
        scope: tag.scope,
        types: tag.types,
        repeatability: tag.repeatability,
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

  const displayedBeats = useMemo(() => {
    if (lastGenerationPath === "v3" && v3Meta) {
      if (v3PreviewView === "verification") return beats;
      if (v3PreviewView === "substitution") {
        return v3Meta.beatsAfterSubstitution?.length
          ? v3Meta.beatsAfterSubstitution
          : beats;
      }
      if (previewMode !== "beats") {
        return beats;
      }
      return [];
    }
    if (beatsVerificationView === "pass1" && beatsPass1Skeleton.length > 0) {
      return beatsPass1Skeleton;
    }
    if (beatsBeforeVerification.length === 0) return beats;
    return beatsVerificationView === "before" ? beatsBeforeVerification : beats;
  }, [
    lastGenerationPath,
    v3Meta,
    v3PreviewView,
    previewMode,
    beatsVerificationView,
    beatsBeforeVerification,
    beats,
    beatsPass1Skeleton,
  ]);

  const displayedRenderedScript = useMemo(() => {
    if (displayedBeats.length === 0) return "";
    const embedded = renderBeatsToScript(displayedBeats, () => null);
    const hasEmbeddedSegments = displayedBeats.some(
      (b) => !b.custom && !!b.tag && !!b.text?.trim(),
    );
    if (hasEmbeddedSegments && !embedded.includes("[[SEG:")) {
      return embedded;
    }
    const hasFill =
      renderedScript.trim().length > 0 || Object.keys(renderPicks).length > 0;
    if (!hasFill) {
      return hasEmbeddedSegments ? embedded : "";
    }
    if (renderedScript.trim() && displayedBeats === beats) {
      return renderedScript;
    }
    if (Object.keys(variantsByTagForEstimate).length === 0) {
      return hasEmbeddedSegments ? embedded : "";
    }
    const picker = createSegmentVariantPickerForBeats({
      beats: displayedBeats,
      variantsByTag: variantsByTagForEstimate,
      tagMetaByName,
      targetMinutes,
      meditationType: previewMeditationType,
      contextTags: previewContextTags,
      preferredVariantIdByTag: renderPicks,
      random: false,
    });
    return renderBeatsToScript(displayedBeats, picker.pickVariantText);
  }, [
    displayedBeats,
    renderedScript,
    beats,
    variantsByTagForEstimate,
    tagMetaByName,
    targetMinutes,
    previewMeditationType,
    previewContextTags,
    renderPicks,
  ]);

  const previewCopyText = useMemo((): string => {
    if (displayedBeats.length === 0) return "";
    if (previewMode === "beats") {
      return JSON.stringify(displayedBeats, null, 2);
    }
    if (previewMode === "tags") {
      return flattenBeatsToCopyText(displayedBeats);
    }
    return displayedRenderedScript.trim();
  }, [displayedBeats, previewMode, displayedRenderedScript]);

  const activeBeatWarnings = useMemo(() => {
    if (previewMode === "beats" && displayedBeats.length > 0) {
      return findDuplicateBeatTypeWarnings(displayedBeats, tagRepeatabilityByName);
    }
    return beatWarnings;
  }, [previewMode, displayedBeats, beatWarnings, tagRepeatabilityByName]);

  const correctedBeatIndices = useMemo(
    () => new Set(verificationNewBeatIndices),
    [verificationNewBeatIndices],
  );

  const pass2HighlightIndices = useMemo(
    () => new Set(pass2NewBeatIndices),
    [pass2NewBeatIndices],
  );

  const statsBeats = displayedBeats;

  const statsVerificationLabel =
    lastGenerationPath === "v3" && v3Meta
      ? v3StatsViewLabel(v3PreviewView)
      : lastGenerationPath === "v2" && beatsPass1Skeleton.length > 0
        ? beatsVerificationView === "pass1"
          ? "Pass 1 skeleton"
          : beatsVerificationView === "before"
            ? "Before verification (after pass 2)"
            : "After verification"
        : beatsBeforeVerification.length > 0
          ? beatsVerificationView === "before"
            ? "Before verification"
            : "After verification"
          : null;

  const v3SubstitutionStats = useMemo(() => {
    if (lastGenerationPath !== "v3" || !v3Meta?.decisions?.length) return null;
    return computeV3SubstitutionStats(v3Meta.decisions);
  }, [lastGenerationPath, v3Meta]);

  const costSummary = useMemo(() => {
    if (!generationUsage && !fillUsage) return null;
    const { customCharCount, segmentCharCount } =
      statsBeats.length > 0
        ? characterCountsFromBeats({
            beats: statsBeats,
            picksByTag: previewMode === "rendered" ? renderPicks : undefined,
            variantsByTag: variantsByTagForEstimate,
            tagMetaByName,
            targetMinutes,
            meditationType: previewMeditationType,
            contextTags: previewContextTags,
          })
        : { customCharCount: 0, segmentCharCount: 0 };

    const generationLabel =
      lastGenerationPath === "v3"
        ? "Generation (pass 1 + classification + substitution)"
        : lastGenerationPath === "v2"
          ? "Generation (pass 1 + pass 2 + verification)"
          : "Generation (incl. verification)";

    return buildScriptLabCostSummary({
      generationUsage,
      fillUsage,
      firstPassUsage,
      finalScriptText: displayedRenderedScript,
      generationLabel,
      fishCustomChars: customCharCount,
      fishSegmentChars: segmentCharCount,
    });
  }, [
    generationUsage,
    fillUsage,
    firstPassUsage,
    displayedRenderedScript,
    statsBeats,
    previewMode,
    renderPicks,
    variantsByTagForEstimate,
    tagMetaByName,
    targetMinutes,
    previewMeditationType,
    previewContextTags,
    lastGenerationPath,
  ]);

  const durationEstimate = useMemo(() => {
    if (statsBeats.length === 0 || !voiceModelId) return null;
    return estimateScriptLabBeatsDurationSeconds({
      beats: statsBeats,
      targetMinutes,
      modelId: voiceModelId,
      meditationType: previewMeditationType,
      contextTags: previewContextTags,
      variantsByTag: variantsByTagForEstimate,
      tagMetaByName,
      picksByTag: previewMode === "rendered" ? renderPicks : undefined,
    });
  }, [
    statsBeats,
    voiceModelId,
    targetMinutes,
    previewMeditationType,
    previewContextTags,
    variantsByTagForEstimate,
    tagMetaByName,
    previewMode,
    renderPicks,
  ]);

  const textByteStats = useMemo(() => {
    if (statsBeats.length === 0) return null;
    return estimateScriptLabBeatsTextUtf8Bytes({
      beats: statsBeats,
      targetMinutes,
      meditationType: previewMeditationType,
      contextTags: previewContextTags,
      variantsByTag: variantsByTagForEstimate,
      tagMetaByName,
      picksByTag: previewMode === "rendered" ? renderPicks : undefined,
    });
  }, [
    statsBeats,
    targetMinutes,
    previewMeditationType,
    previewContextTags,
    variantsByTagForEstimate,
    tagMetaByName,
    previewMode,
    renderPicks,
  ]);

  async function fillPlaceholders() {
    if (beats.length === 0) return;
    setFillBusy(true);
    setError(null);
    try {
      const data = await postAdminScriptLab({
        action: "fill-placeholders",
        beats,
        transcript: flowGenerationInput.transcript,
        journalMode: flowGenerationInput.journalMode,
        meditationStyle: flowGenerationInput.meditationStyle,
        meditationType: previewMeditationType,
        meditationTargetMinutes: targetMinutes,
        contextTags: previewContextTags,
      });

      const picksByBeatIndex =
        data.picksByBeatIndex && typeof data.picksByBeatIndex === "object"
          ? (data.picksByBeatIndex as Record<string, string>)
          : {};
      const picksByTag =
        data.picksByTag && typeof data.picksByTag === "object"
          ? (data.picksByTag as Record<string, string>)
          : {};

      const preferredByBeat: Record<number, string> = {};
      for (const [k, v] of Object.entries(picksByBeatIndex)) {
        const idx = Number(k);
        if (Number.isInteger(idx) && typeof v === "string" && v.trim()) {
          preferredByBeat[idx] = v.trim();
        }
      }

      const tagMeta: Record<
        string,
        { lengthTiered: boolean; scope: "general" | "types"; types: string[] }
      > = {};
      for (const tag of state?.tags ?? []) {
        tagMeta[tag.name] = {
          lengthTiered: tag.lengthTiered,
          scope: tag.scope,
          types: tag.types,
        };
      }

      const variantsByTag: Record<
        string,
        Array<{
          variantId: string;
          text: string;
          lengthTier?: ScriptLengthTier | null;
          direction?: string | null;
          requiredConstraints?: string[];
          excludedConstraints?: string[];
        }>
      > = {};
      for (const [tag, variants] of Object.entries(state?.variantsByTag ?? {})) {
        variantsByTag[tag] = variants.map((v) => ({
          variantId: v.variantId,
          text: v.text,
          lengthTier: v.lengthTier,
          direction: v.direction,
          requiredConstraints: v.requiredConstraints,
          excludedConstraints: v.excludedConstraints,
        }));
      }

      const picker = createSegmentVariantPickerForBeats({
        beats,
        variantsByTag,
        tagMetaByName: tagMeta,
        targetMinutes,
        meditationType: previewMeditationType,
        contextTags: previewContextTags,
        preferredVariantIdByBeatIndex: preferredByBeat,
        random: false,
      });
      const rendered = renderBeatsToScript(beats, picker.pickVariantText);
      setRenderPicks(
        Object.keys(picksByTag).length > 0 ? picksByTag : picker.picksByTag,
      );
      setRenderedScript(rendered);
      setPreviewMode("rendered");
      setFillUsage(parseTokenUsage(data.usage));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fill placeholders failed");
    } finally {
      setFillBusy(false);
    }
  }

  async function copyPreviewToClipboard() {
    if (!previewCopyText) return;
    setError(null);
    try {
      await navigator.clipboard.writeText(previewCopyText);
      setCopyNote("Copied!");
      window.setTimeout(() => setCopyNote(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not copy");
    }
  }

  async function generateScript() {
    if (!flowGenerationInput.ready || !flowGenerationInput.transcript.trim()) {
      setError("Complete the flow inputs before generating.");
      return;
    }
    setGenerateBusy(true);
    setError(null);
    setFillUsage(null);
    setFirstPassUsage(null);
    try {
      const data = await postAdminScriptLab({
        action: "generate-script",
        generationPath,
        transcript: flowGenerationInput.transcript,
        journalMode: flowGenerationInput.journalMode,
        meditationStyle: flowGenerationInput.meditationStyle,
        meditationTargetMinutes: targetMinutes,
        ...(flowGenerationInput.additionalContext?.trim()
          ? { additionalContext: flowGenerationInput.additionalContext.trim() }
          : {}),
      });
      const nextBeats = Array.isArray(data.beats) ? (data.beats as ScriptLabBeat[]) : [];
      const nextBefore = Array.isArray(data.beatsBeforeVerification)
        ? (data.beatsBeforeVerification as ScriptLabBeat[])
        : nextBeats;
      const nextNewIndices = Array.isArray(data.verificationNewBeatIndices)
        ? (data.verificationNewBeatIndices as number[]).filter(
            (x) => typeof x === "number" && Number.isInteger(x) && x >= 0,
          )
        : [];
      const nextWarnings = Array.isArray(data.beatWarnings)
        ? (data.beatWarnings as ScriptLabBeatDuplicateWarning[])
        : [];
      const pathUsed: GenerationPath =
        data.generationPath === "v3" ? "v3" : data.generationPath === "v2" ? "v2" : "v1";
      const v2Meta =
        data.v2Meta && typeof data.v2Meta === "object"
          ? (data.v2Meta as {
              passOneRendered?: ScriptLabBeat[];
              removedTags?: string[];
              focusAnchorBeats?: number;
            })
          : null;
      const nextV3Meta =
        pathUsed === "v3" && data.v3Meta && typeof data.v3Meta === "object"
          ? (data.v3Meta as ScriptLabV3Meta)
          : null;
      const pass1 =
        pathUsed === "v2" && Array.isArray(v2Meta?.passOneRendered)
          ? (v2Meta.passOneRendered as ScriptLabBeat[])
          : [];
      setBeats(nextBeats);
      setBeatsBeforeVerification(nextBefore);
      setBeatsPass1Skeleton(pass1);
      setVerificationNewBeatIndices(nextNewIndices);
      setPass2NewBeatIndices(
        pathUsed === "v2" && pass1.length > 0
          ? computeBeatsDiffIndices(pass1, nextBefore)
          : [],
      );
      setVerificationCorrectionsApplied(data.verificationCorrectionsApplied === true);
      setBeatsVerificationView("after");
      setV3PreviewView("substitution");
      setPendingReviewFilterIds(null);
      setBeatWarnings(nextWarnings);
      setLastGenerationPath(pathUsed);
      setV3Meta(nextV3Meta);
      setV2RemovedTags(
        pathUsed === "v2" && Array.isArray(v2Meta?.removedTags)
          ? v2Meta.removedTags.filter((t): t is string => typeof t === "string")
          : [],
      );
      setV2FocusAnchorBeats(
        pathUsed === "v2" && typeof v2Meta?.focusAnchorBeats === "number"
          ? v2Meta.focusAnchorBeats
          : 0,
      );
      setGenerationUsage(parseTokenUsage(data.usage));
      setFirstPassUsage(parseTokenUsage(data.firstPassUsage));
      if (pathUsed === "v2" || pathUsed === "v3") {
        const embedded = renderBeatsToScript(nextBeats, () => null);
        setRenderedScript(embedded.includes("[[SEG:") ? "" : embedded);
        setRenderPicks({});
        setPreviewMode(embedded.includes("[[SEG:") ? "beats" : "rendered");
      } else {
        setRenderedScript("");
        setRenderPicks({});
        setPreviewMode("beats");
      }
      setCopyNote(null);
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
      setLibraryTab("properties");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create tag");
    }
  }

  const selectedTagMeta = useMemo(
    () => state?.tags.find((t) => t.name === selectedTag) ?? null,
    [state, selectedTag],
  );

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

  async function runJsonImport() {
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
      if (importMode === "metadata") {
        const { summary } = await importAdminScriptLabTagMetadata(payload);
        setImportSummary(
          `Metadata: ${summary.tagsUpdated} updated, ${summary.tagsCreated} created (${summary.tagNames.length} tags). Variants untouched.`,
        );
        setImportJson("");
        await reload();
        return;
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
      const importErrors =
        e &&
        typeof e === "object" &&
        "importErrors" in e &&
        Array.isArray((e as { importErrors: unknown }).importErrors)
          ? ((e as { importErrors: Array<{ path: string; message: string }> })
              .importErrors)
          : null;
      if (importErrors?.length) {
        setImportErrors(importErrors);
        setError("Import validation failed — see errors below.");
      } else {
        setError(e instanceof Error ? e.message : "Import failed");
      }
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
    <div className="space-y-6">
      <AdminPauseLengthsPanel />

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
                {PREVIEW_MODES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreviewMode(id)}
                    className={`cursor-pointer rounded-full px-3 py-1 font-medium ${
                      previewMode === id
                        ? "bg-accent-soft text-accent-link"
                        : "text-muted hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={!previewCopyText}
                onClick={() => void copyPreviewToClipboard()}
                className="cursor-pointer rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent-soft/40 disabled:opacity-50"
              >
                {copyNote ?? "Copy"}
              </button>
              <button
                type="button"
                disabled={beats.length === 0 || fillBusy}
                onClick={() => void fillPlaceholders()}
                className="cursor-pointer rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent-soft/40 disabled:opacity-50"
              >
                {fillBusy ? "Filling…" : "Fill placeholders"}
              </button>
            </div>
          </div>

          {activeBeatWarnings.length > 0 ? (
            <div className="mt-3 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-950 dark:text-amber-100">
              <p className="font-semibold">Duplicate singular segment detected</p>
              {activeBeatWarnings.map((w) => (
                <p key={w.tag ?? w.beatType}>{formatBeatWarning(w)}</p>
              ))}
            </div>
          ) : null}

          {beats.length > 0 && lastGenerationPath === "v3" && v3Meta ? (
            <ScriptLabV3PreviewToggle view={v3PreviewView} onChange={setV3PreviewView} />
          ) : beats.length > 0 && beatsBeforeVerification.length > 0 ? (
            <ScriptLabBeatsVerificationToggle
              view={beatsVerificationView}
              onChange={setBeatsVerificationView}
              correctionsApplied={verificationCorrectionsApplied}
              showPass1={lastGenerationPath === "v2" && beatsPass1Skeleton.length > 0}
              pass2HighlightNote={
                lastGenerationPath === "v2" && beatsPass1Skeleton.length > 0
              }
            />
          ) : null}

          {lastGenerationPath === "v3" && v3Meta && (v3Meta.promotedVariantIds?.length ?? 0) > 0 ? (
            <ScriptLabV3PromoteBanner
              promotedCount={v3Meta.promotedVariantIds?.length ?? 0}
              onOpenPendingReview={() => {
                void reload().then(() => {
                  setPendingReviewFilterIds(new Set(v3Meta.promotedVariantIds ?? []));
                  setLibraryTab("pending");
                });
              }}
            />
          ) : null}

          <div className="mt-3 min-h-[12rem] max-h-[28rem] overflow-y-auto scroll-styled rounded-xl border border-border bg-background/80 p-4 text-sm leading-relaxed text-foreground">
            {beats.length === 0 ? (
              <p className="text-muted">Generate a test script from the panel on the right.</p>
            ) : previewMode === "beats" && lastGenerationPath === "v3" && v3Meta ? (
              <ScriptLabV3PreviewContent
                view={v3PreviewView}
                v3Meta={v3Meta}
                verificationBeats={beats}
                tagRepeatabilityByName={tagRepeatabilityByName}
                correctedBeatIndices={
                  v3PreviewView === "verification" ? correctedBeatIndices : undefined
                }
              />
            ) : previewMode === "beats" ? (
              <ScriptLabBeatsPreview
                beats={displayedBeats}
                tagRepeatabilityByName={tagRepeatabilityByName}
                correctedBeatIndices={
                  beatsVerificationView === "after"
                    ? correctedBeatIndices
                    : beatsVerificationView === "before" && lastGenerationPath === "v2"
                      ? pass2HighlightIndices
                      : undefined
                }
              />
            ) : previewMode === "rendered" ? (
              displayedRenderedScript.trim() ? (
                <pre className="whitespace-pre-wrap font-sans">{displayedRenderedScript}</pre>
              ) : (
                <p className="text-muted">Click “Fill placeholders” to render tags.</p>
              )
            ) : (
              <div className="whitespace-pre-wrap font-sans">
                {flattenBeatsToPreviewTokens(displayedBeats).map((tok, i) =>
                  tok.type === "tag" ? (
                    <span
                      key={`${tok.name}-${i}`}
                      className="mx-0.5 inline-flex rounded-full border border-accent/40 bg-accent-soft/60 px-2 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-accent-link"
                    >
                      {tok.name}
                    </span>
                  ) : tok.type === "pause" ? (
                    <em
                      key={`pause-${tok.band}-${i}`}
                      className="mx-0.5 inline not-italic text-[11px] font-medium text-muted"
                    >
                      {`[[PAUSE ${tok.band}]]`}
                    </em>
                  ) : (
                    <span key={`t-${i}`}>{tok.value}</span>
                  ),
                )}
              </div>
            )}
          </div>

          {durationEstimate || textByteStats ? (
            <p className="mt-2 text-xs text-muted">
              {statsVerificationLabel ? (
                <>
                  <span className="font-medium text-foreground">{statsVerificationLabel}</span>
                  {" — "}
                </>
              ) : null}
              {durationEstimate ? (
                <>
                  Est. duration:{" "}
                  <span className="font-semibold text-foreground">
                    {formatDurationClock(durationEstimate.totalSeconds)}
                  </span>{" "}
                  (target: {targetMinutes} min) — context: {previewContextTags.join(", ")} — pauses{" "}
                  {formatDurationClock(durationEstimate.pauseSeconds)}, segments{" "}
                  {formatDurationClock(durationEstimate.segmentSeconds)}, custom ~{" "}
                  {durationEstimate.customWordCount} words
                </>
              ) : null}
              {durationEstimate && textByteStats ? " — " : null}
              {textByteStats ? (
                <>
                  text:{" "}
                  <span className="font-semibold text-foreground">
                    {formatUtf8ByteCount(textByteStats.customUtf8Bytes)}
                  </span>{" "}
                  custom ·{" "}
                  <span className="font-semibold text-foreground">
                    {formatUtf8ByteCount(textByteStats.totalUtf8Bytes)}
                  </span>{" "}
                  with segments ({formatCustomTextRatio(textByteStats.customRatio)})
                </>
              ) : null}
            </p>
          ) : null}
          <ScriptLabCostStatsPanel summary={costSummary} />
          {lastGenerationPath === "v3" && v3SubstitutionStats ? (
            <ScriptLabV3SubstitutionStatsLine stats={v3SubstitutionStats} />
          ) : null}
          {lastGenerationPath === "v2" &&
          (v2RemovedTags.length > 0 || v2FocusAnchorBeats > 0) ? (
            <p className="mt-1 text-[11px] text-muted">
              {v2RemovedTags.length > 0 ? (
                <>
                  Pass 2 removed:{" "}
                  <span className="font-medium text-foreground">
                    {v2RemovedTags.join(", ")}
                  </span>
                </>
              ) : (
                "Pass 2 removed: (none)"
              )}
              {"  ·  "}
              Focus anchor:{" "}
              <span className="font-medium text-foreground">
                {v2FocusAnchorBeats} beat{v2FocusAnchorBeats === 1 ? "" : "s"}
              </span>
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

          <ScriptLabEmbeddingProgressBar stats={embeddingStats} />

          {embedTestResult ? (
            <pre
              className={`mt-2 max-h-48 overflow-auto scroll-styled rounded-xl border px-3 py-2 font-mono text-[11px] leading-relaxed ${
                embedTestResult.startsWith("FAIL")
                  ? "border-danger/40 bg-danger/5 text-danger"
                  : "border-emerald-500/40 bg-emerald-500/5 text-foreground"
              }`}
            >
              {embedTestResult}
            </pre>
          ) : null}

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
            <button
              type="button"
              disabled={embedTestBusy}
              className="cursor-pointer rounded border border-border px-2 py-1 text-xs font-medium disabled:opacity-50"
              onClick={() => {
                void (async () => {
                  setEmbedTestBusy(true);
                  setEmbedTestResult(null);
                  setError(null);
                  try {
                    const data = await postAdminScriptLab({ action: "test-embed" });
                    if (data.embeddingStats) {
                      setEmbeddingStats(data.embeddingStats as ScriptLabEmbeddingStats);
                    }
                    if (data.ok === true) {
                      const embed = (data.embed ?? {}) as Record<string, unknown>;
                      const store = (data.store ?? {}) as Record<string, unknown>;
                      const sample = (data.sample ?? {}) as Record<string, unknown>;
                      setEmbedTestResult(
                        [
                          "OK — embed + store succeeded",
                          `Sample: ${sample.tagName ?? "?"} / ${sample.variantId ?? "?"}`,
                          `Text: ${String(sample.textPreview ?? "").slice(0, 120)}`,
                          `Model: ${embed.model ?? "?"} · dims=${embed.dims ?? "?"} · embed ${embed.durationMs ?? "?"}ms`,
                          `Sample values: ${JSON.stringify(embed.sampleValues ?? [])}`,
                          `Store: updated=${store.updated ?? "?"} skipped=${store.skipped ?? "?"} (${store.durationMs ?? "?"}ms)`,
                        ].join("\n"),
                      );
                    } else {
                      const sample = (data.sample ?? {}) as Record<string, unknown>;
                      setEmbedTestResult(
                        [
                          `FAIL at step=${String(data.step ?? "?")}`,
                          data.functionName ? `Function: ${data.functionName}` : null,
                          data.durationMs != null ? `Duration: ${data.durationMs}ms` : null,
                          sample.tagName
                            ? `Sample: ${sample.tagName} / ${sample.variantId ?? "?"}`
                            : null,
                          data.functionError
                            ? `FunctionError: ${String(data.functionError)}`
                            : null,
                          String(data.error ?? "Unknown embed error"),
                          data.rawPayload
                            ? `--- raw payload ---\n${String(data.rawPayload).slice(0, 1500)}`
                            : null,
                          data.store && typeof data.store === "object"
                            ? `--- store ---\n${JSON.stringify(data.store, null, 2).slice(0, 1500)}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join("\n"),
                      );
                    }
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Test embed failed";
                    setEmbedTestResult(`FAIL\n${msg}`);
                    setError(msg);
                  } finally {
                    setEmbedTestBusy(false);
                  }
                })();
              }}
            >
              {embedTestBusy ? "Testing embed…" : "Test embed"}
            </button>
            <button
              type="button"
              className="cursor-pointer rounded border border-border px-2 py-1 text-xs font-medium"
              onClick={() => {
                void (async () => {
                  setError(null);
                  try {
                    const data = await postAdminScriptLab({ action: "backfill-embeddings" });
                    const queued = typeof data.queued === "number" ? data.queued : 0;
                    const skipped = typeof data.skipped === "number" ? data.skipped : 0;
                    if (data.embeddingStats) {
                      setEmbeddingStats(data.embeddingStats as ScriptLabEmbeddingStats);
                    } else {
                      try {
                        setEmbeddingStats(await fetchAdminScriptLabEmbeddingProgress());
                      } catch {
                        /* ignore */
                      }
                    }
                    setImportSummary(
                      `Embeddings: queued ${queued} missing; skipped ${skipped} already embedded (async write).`,
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Embedding backfill failed");
                  }
                })();
              }}
            >
              Backfill embeddings
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
            <div className="mt-3 inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
              {(
                [
                  ["metadata", "Tag metadata"],
                  ["segments", "Segments + variants"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setImportMode(id)}
                  className={`cursor-pointer rounded-full px-3 py-1 font-medium ${
                    importMode === id
                      ? "bg-accent-soft text-accent-link"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {importMode === "metadata"
                ? "Metadata only — [{ \"tag\": { \"name\": …, \"description\": … } }]. Updates scope, types, description, repeatability, length-tiered. Never touches variants."
                : "Full segment import — { \"segments\": [{ \"tag\": \"NAME\", variants: [...] }] }. Upserts tags and variants; audio invalidated when variant text changes."}
            </p>
            <textarea
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={
                importMode === "metadata"
                  ? '[{"tag":{"name":"BODY_RELAX","scope":"general","types":[],"lengthTiered":false,"repeatability":"connective","description":"…"}}]'
                  : '{"segments":[{"tag":"SETTLE_OPENER","scope":"general","types":[],"lengthTiered":true,"variants":[{"text":"…","lengthTier":"short","requiredConstraints":[],"excludedConstraints":[]}]}]}'
              }
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
                onClick={() => void runJsonImport()}
                className="cursor-pointer rounded-full bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent-link disabled:opacity-50"
              >
                {importBusy
                  ? "Importing…"
                  : importMode === "metadata"
                    ? "Import metadata"
                    : "Import segments"}
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

          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {(
              [
                ["properties", "Segment properties"],
                ["variants", "Variant editor"],
                ["pending", `Pending review (${state?.pendingReview?.length ?? 0})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLibraryTab(id)}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  libraryTab === id
                    ? "border-accent/50 bg-accent-soft/60 text-accent-link"
                    : "border-border bg-background text-muted"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {libraryTab === "properties" ? (
            <ScriptLabSegmentPropertiesPanel
              tags={state?.tags ?? []}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              onSaved={reload}
              onError={setError}
            />
          ) : libraryTab === "pending" ? (
            <PendingReviewPanel
              pending={(state?.pendingReview ?? []).filter((v) =>
                pendingReviewFilterIds
                  ? pendingReviewFilterIds.has(v.variantId)
                  : true,
              )}
              filterActive={pendingReviewFilterIds != null}
              onClearFilter={() => setPendingReviewFilterIds(null)}
              tags={state?.tags ?? []}
              reassignTagDraft={reassignTagDraft}
              setReassignTagDraft={setReassignTagDraft}
              pendingBusyKey={pendingBusyKey}
              setPendingBusyKey={setPendingBusyKey}
              onReload={reload}
              onError={setError}
            />
          ) : (
            <>
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
                            <p className="font-medium text-foreground">
                              Coverage by type (default context)
                            </p>
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

              {selectedTag && selectedTagMeta ? (
                <section className="mt-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-display text-lg font-medium">{selectedTag}</h2>
                    <button
                      type="button"
                      onClick={() => setLibraryTab("properties")}
                      className="cursor-pointer text-xs text-accent-link underline-offset-2 hover:underline"
                    >
                      Edit metadata in properties →
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    Variant text and TTS only — tag metadata is edited in Segment properties.
                  </p>

                  <div className="mt-3 space-y-1">
                    {selectedVariants.map((v) => (
                      <VariantEditorRow
                        key={v.variantId}
                        variant={v}
                        lengthTiered={selectedTagMeta.lengthTiered}
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
                    {selectedTagMeta.lengthTiered ? (
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
              ) : libraryTab === "variants" ? (
                <p className="mt-3 text-sm text-muted">Select a segment to edit variants.</p>
              ) : null}
            </>
          )}
        </section>
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

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-foreground">Generation</legend>
          <div className="inline-flex rounded-full border border-border bg-background p-0.5 text-xs">
            {(
              [
                { id: "v1" as const, label: "V1 (current)" },
                { id: "v2" as const, label: "V2 (experimental)" },
                { id: "v3" as const, label: "V3 (vector)" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setGenerationPath(id)}
                className={`cursor-pointer rounded-full px-3 py-1 font-medium ${
                  generationPath === id
                    ? "bg-accent-soft text-accent-link"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          disabled={generateBusy || !flowGenerationInput.ready}
          onClick={() => void generateScript()}
          className="w-full cursor-pointer border border-neutral-800 bg-neutral-900 py-2 font-semibold text-white disabled:opacity-50 dark:border-neutral-300 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {generateBusy
            ? generationPath === "v3"
              ? "Generating V3…"
              : generationPath === "v2"
                ? "Generating V2…"
                : "Generating…"
            : generationPath === "v3"
              ? "Generate script V3 →"
              : generationPath === "v2"
                ? "Generate script V2 →"
                : "Generate script →"}
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
    </div>
  );
}

function PendingReviewPanel({
  pending,
  filterActive,
  onClearFilter,
  tags,
  reassignTagDraft,
  setReassignTagDraft,
  pendingBusyKey,
  setPendingBusyKey,
  onReload,
  onError,
}: {
  pending: ScriptLabVariant[];
  filterActive?: boolean;
  onClearFilter?: () => void;
  tags: Array<{ name: string }>;
  reassignTagDraft: Record<string, string>;
  setReassignTagDraft: Dispatch<SetStateAction<Record<string, string>>>;
  pendingBusyKey: string | null;
  setPendingBusyKey: (key: string | null) => void;
  onReload: () => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  return (
    <div className="mt-3 space-y-3">
      {filterActive ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs">
          <span>Showing variants from this generation only</span>
          <button
            type="button"
            onClick={onClearFilter}
            className="cursor-pointer font-semibold text-accent-link underline hover:no-underline"
          >
            Show all pending
          </button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-semibold"
          onClick={() => {
            void (async () => {
              try {
                const base = getMedimadeApiBase();
                if (!base) throw new Error("API URL not set");
                const res = await fetch(`${base}/admin/script-lab?export=v3-no-match-csv`, {
                  headers: medimadeApiAuthHeaders(),
                });
                if (!res.ok) throw new Error(`CSV download failed (${res.status})`);
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "script-lab-v3-no-match.csv";
                a.click();
                URL.revokeObjectURL(url);
              } catch (e) {
                onError(e instanceof Error ? e.message : "CSV download failed");
              }
            })();
          }}
        >
          Download V3 no-match CSV
        </button>
        <button
          type="button"
          className="cursor-pointer rounded-full border border-border px-3 py-1 text-xs font-semibold"
          onClick={() => {
            void (async () => {
              try {
                await postAdminScriptLab({ action: "backfill-embeddings" });
                await onReload();
              } catch (e) {
                onError(e instanceof Error ? e.message : "Backfill failed");
              }
            })();
          }}
        >
          Backfill embeddings
        </button>
      </div>
      {pending.length === 0 ? (
        <p className="text-sm text-muted">No auto-promoted variants awaiting review.</p>
      ) : (
        pending.map((v) => {
          const key = `${v.tagName}#${v.variantId}`;
          const busy = pendingBusyKey === key;
          return (
            <div
              key={key}
              className="space-y-2 rounded-xl border border-border bg-background/80 p-3 text-xs"
            >
              <p className="font-mono text-[10px] text-accent-link">{v.tagName}</p>
              <p className="whitespace-pre-wrap text-sm text-foreground">{v.text}</p>
              <p className="text-muted">
                Similarity to nearest:{" "}
                {typeof v.promotionSimilarity === "number"
                  ? v.promotionSimilarity.toFixed(3)
                  : "—"}
                {v.promotionNearestTag ? ` (${v.promotionNearestTag})` : ""}
              </p>
              {v.promotionContext ? (
                <p className="line-clamp-3 text-muted">Context: {v.promotionContext}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="cursor-pointer rounded-full bg-accent-soft px-3 py-1 font-semibold text-accent-link disabled:opacity-50"
                  onClick={() => {
                    void (async () => {
                      setPendingBusyKey(key);
                      try {
                        await postAdminScriptLab({
                          action: "approve-variant",
                          tagName: v.tagName,
                          variantId: v.variantId,
                        });
                        await onReload();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : "Approve failed");
                      } finally {
                        setPendingBusyKey(null);
                      }
                    })();
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="cursor-pointer rounded-full border border-border px-3 py-1 font-semibold disabled:opacity-50"
                  onClick={() => {
                    if (!window.confirm("Reject and delete this promoted variant?")) return;
                    void (async () => {
                      setPendingBusyKey(key);
                      try {
                        await postAdminScriptLab({
                          action: "reject-variant",
                          tagName: v.tagName,
                          variantId: v.variantId,
                        });
                        await onReload();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : "Reject failed");
                      } finally {
                        setPendingBusyKey(null);
                      }
                    })();
                  }}
                >
                  Reject
                </button>
                <select
                  value={reassignTagDraft[key] ?? v.tagName}
                  onChange={(e) =>
                    setReassignTagDraft((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                  className="rounded border border-border bg-background px-2 py-1"
                >
                  {tags.map((t) => (
                    <option key={t.name} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  className="cursor-pointer rounded-full border border-border px-3 py-1 font-semibold disabled:opacity-50"
                  onClick={() => {
                    const toTag = reassignTagDraft[key] ?? v.tagName;
                    void (async () => {
                      setPendingBusyKey(key);
                      try {
                        await postAdminScriptLab({
                          action: "reassign-variant",
                          fromTag: v.tagName,
                          toTag,
                          variantId: v.variantId,
                        });
                        await onReload();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : "Reassign failed");
                      } finally {
                        setPendingBusyKey(null);
                      }
                    })();
                  }}
                >
                  Reassign
                </button>
              </div>
            </div>
          );
        })
      )}
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
  embeddingsQueued?: number;
  constraintTagsAdded?: string[];
};

function formatImportSummary(summary: ImportSummary): string {
  const parts = [
    `Tags: ${summary.tagsCreated ?? 0} created, ${summary.tagsUpdated ?? 0} updated.`,
    `Variants: ${summary.variantsAdded ?? 0} created, ${summary.variantsUpdatedById ?? 0} updated by ID, ${summary.variantsUpdatedByTextMatch ?? 0} updated by text match, ${summary.variantsUnchanged ?? 0} unchanged.`,
  ];
  if ((summary.embeddingsQueued ?? 0) > 0) {
    parts.push(
      `${summary.embeddingsQueued} embedding(s) queued async (library updated immediately; vectors write when ready).`,
    );
  }
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

function formatEmbeddingStatsTime(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

function ScriptLabEmbeddingProgressBar(props: {
  stats: ScriptLabEmbeddingStats | null;
}) {
  const { stats } = props;
  const total = stats?.total ?? 0;
  const embedded = stats?.embedded ?? 0;
  const queued = stats?.queued ?? 0;
  const missing = stats?.missing ?? 0;
  const pct = total > 0 ? Math.round((embedded / total) * 100) : 0;
  const queuedPct = total > 0 ? (queued / total) * 100 : 0;
  const embeddedPct = total > 0 ? (embedded / total) * 100 : 0;
  const inProgress = queued > 0;

  return (
    <div
      className="mt-3 rounded-xl border border-border bg-background/60 px-3 py-2.5"
      aria-live="polite"
      aria-label="Segment library embedding progress"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">Embedding progress</span>
        <span className="tabular-nums text-muted">
          {stats ? (
            <>
              <span className="text-foreground">{embedded.toLocaleString()}</span>
              {" / "}
              {total.toLocaleString()} embedded
              {" · "}
              <span className={queued > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
                {queued.toLocaleString()} queued
              </span>
              {" · "}
              {missing.toLocaleString()} missing
              {total > 0 ? ` (${pct}%)` : ""}
            </>
          ) : (
            "Loading…"
          )}
        </span>
      </div>
      <div
        className="mt-2 flex h-2 overflow-hidden rounded-full bg-muted/25"
        role="progressbar"
        aria-valuenow={embedded}
        aria-valuemin={0}
        aria-valuemax={total || 100}
      >
        <div
          className="h-full bg-emerald-500/80 transition-[width] duration-500"
          style={{ width: `${embeddedPct}%` }}
        />
        <div
          className={`h-full bg-amber-400/90 transition-[width] duration-500 ${
            inProgress ? "animate-pulse" : ""
          }`}
          style={{ width: `${queuedPct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[10px] text-muted">
        Auto-refreshes every 5s
        {stats?.updatedAt ? (
          <> · updated {formatEmbeddingStatsTime(stats.updatedAt)}</>
        ) : null}
        {inProgress ? <> · async embed Lambda processing queue</> : null}
      </p>
    </div>
  );
}
