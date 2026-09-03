import type { ScriptLabV3Meta } from "@/components/script-lab-v3-preview";
import type { MeditationStyleLabel } from "@/lib/meditation-style-intake";
import type { StyleQuestionAnswers } from "@/lib/meditation-style-intake";
import {
  postAdminScriptLab,
  type ScriptLabEmbeddingStats,
  type ScriptLabSpeaker,
  type ScriptLabState,
} from "@/lib/medimade-api";
import type { ScriptLabBeat, ScriptLabBeatDuplicateWarning } from "@/lib/script-lab-beats";
import {
  STRESS_TEST_CONCURRENCY_LIMIT,
  STRESS_TEST_TARGET_MINUTES,
  type StressTestPath,
} from "@/lib/stress-test-config";
import type { StressTestRunStats } from "@/lib/stress-test-stats";
import {
  applyFillPicksToBeats,
  beatsNeedIntelligentFill,
  buildPreviewContextForType,
  computeStressTestRunStats,
  renderStressTestScript,
} from "@/lib/stress-test-stats";
import { buildStressTestTranscript } from "@/lib/stress-test-transcript";
import { parseTokenUsage, parseUsageBreakdown, type TokenUsage } from "@/lib/script-lab-cost";

export type StressTestRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "not_implemented";

export type StressTestRunResult = {
  id: string;
  type: MeditationStyleLabel;
  path: StressTestPath;
  runIndex: number;
  status: StressTestRunStatus;
  error?: string;
  beats?: ScriptLabBeat[];
  renderedText?: string;
  beatWarnings?: ScriptLabBeatDuplicateWarning[];
  v3Meta?: ScriptLabV3Meta;
  picksByTag?: Record<string, string>;
  stats?: StressTestRunStats;
  generationUsage?: TokenUsage | null;
  fillUsage?: TokenUsage | null;
};

export type StressTestBatchConfig = {
  types: MeditationStyleLabel[];
  paths: StressTestPath[];
  runsPerType: number;
  voiceModelId: string;
  useFixedInputs: boolean;
  customInputsByType: Partial<Record<MeditationStyleLabel, StyleQuestionAnswers>>;
};

export type StressTestBatchProgress = {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  inFlight: number;
};

export function isV3StressTestAvailable(
  embeddingStats?: ScriptLabEmbeddingStats | null,
): boolean {
  return (embeddingStats?.embedded ?? 0) > 0;
}

function libraryMaps(state: ScriptLabState) {
  const tagMetaByName: Record<
    string,
    { lengthTiered: boolean; scope: "general" | "types"; types: string[] }
  > = {};
  for (const tag of state.tags) {
    tagMetaByName[tag.name] = {
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
      lengthTier?: import("@/lib/script-segment-tags").ScriptLengthTier | null;
      direction?: string | null;
      requiredConstraints?: string[];
      excludedConstraints?: string[];
      audio?: Array<{ modelId: string; durationSeconds: number }>;
    }>
  > = {};
  for (const [tag, variants] of Object.entries(state.variantsByTag)) {
    variantsByTag[tag] = variants.map((v) => ({
      variantId: v.variantId,
      text: v.text,
      lengthTier: v.lengthTier,
      direction: v.direction,
      requiredConstraints: v.requiredConstraints,
      excludedConstraints: v.excludedConstraints,
      audio: (state.audioByVariantKey[`${tag}#${v.variantId}`] ?? [])
        .filter((a) => a.status === "generated")
        .map((a) => ({ modelId: a.modelId, durationSeconds: a.durationSeconds })),
    }));
  }

  return { tagMetaByName, variantsByTag };
}

function parseTokenUsageFromResponse(raw: unknown): TokenUsage | null {
  return parseTokenUsage(raw);
}

async function runSingleStressTest(params: {
  type: MeditationStyleLabel;
  path: StressTestPath;
  runIndex: number;
  answers: StyleQuestionAnswers;
  voiceModelId: string;
  library: ScriptLabState;
  v3Available: boolean;
  signal?: AbortSignal;
}): Promise<StressTestRunResult> {
  const id = `${params.type}:${params.path}:${params.runIndex}`;
  const base: StressTestRunResult = {
    id,
    type: params.type,
    path: params.path,
    runIndex: params.runIndex,
    status: "running",
  };

  if (params.signal?.aborted) {
    return { ...base, status: "cancelled" };
  }

  if (params.path === "v3" && !params.v3Available) {
    return {
      ...base,
      status: "not_implemented",
      error: "V3 requires variant embeddings in the segment library.",
    };
  }

  const { transcript, additionalContext } = buildStressTestTranscript(
    params.type,
    params.answers,
  );
  const contextTags = buildPreviewContextForType(params.type, transcript);
  const { tagMetaByName, variantsByTag } = libraryMaps(params.library);

  try {
    const genData = await postAdminScriptLab({
      action: "generate-script",
      generationPath: params.path,
      transcript,
      journalMode: false,
      meditationStyle: params.type,
      meditationTargetMinutes: STRESS_TEST_TARGET_MINUTES,
      ...(additionalContext ? { additionalContext } : {}),
    });

    if (params.signal?.aborted) {
      return { ...base, status: "cancelled" };
    }

    const beats = Array.isArray(genData.beats)
      ? (genData.beats as ScriptLabBeat[])
      : [];
    const beatWarnings = Array.isArray(genData.beatWarnings)
      ? (genData.beatWarnings as ScriptLabBeatDuplicateWarning[])
      : [];
    const generationUsage = parseTokenUsageFromResponse(genData.usage);
    const firstPassUsage = parseTokenUsageFromResponse(genData.firstPassUsage);
    let usageBreakdown = parseUsageBreakdown(genData.usageBreakdown);
    const v3Meta =
      genData.v3Meta && typeof genData.v3Meta === "object"
        ? (genData.v3Meta as ScriptLabV3Meta)
        : undefined;

    let finalBeats = beats;
    let picksByTag: Record<string, string> = {};
    let fillUsage: TokenUsage | null = null;

    const shouldFill =
      params.path === "v1" ||
      (params.path === "v2" && beatsNeedIntelligentFill(beats));

    if (shouldFill && beats.length > 0) {
      const fillData = await postAdminScriptLab({
        action: "fill-placeholders",
        beats,
        transcript,
        journalMode: false,
        meditationStyle: params.type,
        meditationType: params.type,
        meditationTargetMinutes: STRESS_TEST_TARGET_MINUTES,
        contextTags,
      });

      if (params.signal?.aborted) {
        return { ...base, status: "cancelled" };
      }

      fillUsage = parseTokenUsageFromResponse(fillData.usage);
      usageBreakdown = [
        ...usageBreakdown.filter((e) => e.stage !== "fill"),
        ...parseUsageBreakdown(fillData.usageBreakdown),
      ];
      const picksByBeatIndex: Record<number, string> = {};
      if (fillData.picksByBeatIndex && typeof fillData.picksByBeatIndex === "object") {
        for (const [k, v] of Object.entries(
          fillData.picksByBeatIndex as Record<string, string>,
        )) {
          const idx = Number(k);
          if (Number.isInteger(idx) && typeof v === "string" && v.trim()) {
            picksByBeatIndex[idx] = v.trim();
          }
        }
      }
      const fillPicksByTag =
        fillData.picksByTag && typeof fillData.picksByTag === "object"
          ? (fillData.picksByTag as Record<string, string>)
          : {};

      const applied = applyFillPicksToBeats({
        beats,
        picksByBeatIndex,
        picksByTag: fillPicksByTag,
        variantsByTag,
        tagMetaByName,
        meditationType: params.type,
        contextTags,
      });
      finalBeats = applied.beats;
      picksByTag = applied.picksByTag;
    } else if (params.path === "v2" || params.path === "v3") {
      const applied = applyFillPicksToBeats({
        beats,
        picksByBeatIndex: {},
        picksByTag: {},
        variantsByTag,
        tagMetaByName,
        meditationType: params.type,
        contextTags,
      });
      finalBeats = applied.beats;
      picksByTag = applied.picksByTag;
    }

    const renderedText = renderStressTestScript({
      beats: finalBeats,
      picksByTag,
      variantsByTag,
      tagMetaByName,
      meditationType: params.type,
      contextTags,
    });

    const stats = computeStressTestRunStats({
      beats: finalBeats,
      picksByTag,
      beatWarnings,
      v3Meta,
      voiceModelId: params.voiceModelId,
      meditationType: params.type,
      contextTags,
      variantsByTag,
      tagMetaByName,
      generationUsage,
      fillUsage,
      usageBreakdown,
      firstPassUsage,
      finalScriptText: renderedText,
    });

    return {
      ...base,
      status: "completed",
      beats: finalBeats,
      renderedText,
      beatWarnings,
      v3Meta,
      picksByTag,
      stats,
      generationUsage,
      fillUsage,
    };
  } catch (err) {
    return {
      ...base,
      status: "failed",
      error: err instanceof Error ? err.message : "Generation failed",
    };
  }
}

export async function runStressTestBatch(params: {
  config: StressTestBatchConfig;
  library: ScriptLabState;
  speakers: ScriptLabSpeaker[];
  embeddingStats?: ScriptLabEmbeddingStats | null;
  onRunUpdate: (run: StressTestRunResult) => void;
  onProgress: (progress: StressTestBatchProgress) => void;
  getAnswersForType: (type: MeditationStyleLabel) => StyleQuestionAnswers;
  signal?: AbortSignal;
}): Promise<StressTestRunResult[]> {
  const v3Available = isV3StressTestAvailable(params.embeddingStats);
  const jobs: Array<{
    type: MeditationStyleLabel;
    path: StressTestPath;
    runIndex: number;
  }> = [];

  for (const type of params.config.types) {
    for (const path of params.config.paths) {
      for (let runIndex = 1; runIndex <= params.config.runsPerType; runIndex += 1) {
        jobs.push({ type, path, runIndex });
      }
    }
  }

  const results: StressTestRunResult[] = jobs.map((job) => ({
    id: `${job.type}:${job.path}:${job.runIndex}`,
    type: job.type,
    path: job.path,
    runIndex: job.runIndex,
    status: "pending" as const,
  }));

  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let cursor = 0;
  let inFlight = 0;

  const reportProgress = () => {
    params.onProgress({
      total: jobs.length,
      completed,
      failed,
      cancelled,
      inFlight,
    });
  };

  reportProgress();

  await new Promise<void>((resolve) => {
    const launchNext = () => {
      if (params.signal?.aborted) {
        while (cursor < jobs.length) {
          const pending = results[cursor]!;
          if (pending.status === "pending") {
            const cancelledRun = { ...pending, status: "cancelled" as const };
            results[cursor] = cancelledRun;
            params.onRunUpdate(cancelledRun);
            cancelled += 1;
            cursor += 1;
          } else {
            cursor += 1;
          }
        }
        inFlight = 0;
        reportProgress();
        resolve();
        return;
      }

      while (
        inFlight < STRESS_TEST_CONCURRENCY_LIMIT &&
        cursor < jobs.length &&
        !params.signal?.aborted
      ) {
        const index = cursor;
        const job = jobs[index]!;
        cursor += 1;
        inFlight += 1;

        const running: StressTestRunResult = {
          ...results[index]!,
          status: "running",
        };
        results[index] = running;
        params.onRunUpdate(running);
        reportProgress();

        void runSingleStressTest({
          type: job.type,
          path: job.path,
          runIndex: job.runIndex,
          answers: params.getAnswersForType(job.type),
          voiceModelId: params.config.voiceModelId,
          library: params.library,
          v3Available,
          signal: params.signal,
        })
          .then((result) => {
            results[index] = result;
            params.onRunUpdate(result);
            if (result.status === "completed" || result.status === "not_implemented") {
              completed += 1;
            } else if (result.status === "failed") {
              failed += 1;
            } else if (result.status === "cancelled") {
              cancelled += 1;
            }
          })
          .finally(() => {
            inFlight -= 1;
            reportProgress();
            if (cursor >= jobs.length && inFlight === 0) {
              resolve();
            } else {
              launchNext();
            }
          });
      }
    };

    launchNext();
  });

  return results;
}
