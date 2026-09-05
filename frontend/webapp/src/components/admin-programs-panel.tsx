"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  backgroundAudioPlaybackKey,
  backgroundAudioStreamingKey,
  createMeditationAudioJob,
  deleteAdminProgram,
  generateAdminProgramDayDescription,
  getMeditationAudioJobStatus,
  getMedimadeMediaBaseUrl,
  listAdminPrograms,
  listBackgroundAudio,
  listFishSpeakers,
  PROGRAM_DAY_DESCRIPTION_MIN_CHARS,
  saveAdminProgram,
  VOICE_FX_PRESET_MEDITATION_MIXER,
  type AdminProgram,
  type AdminProgramDay,
  type BackgroundAudioItem,
  type FishSpeaker,
  type MeditationTargetMinutes,
  MEDITATION_TARGET_MINUTES,
} from "@/lib/medimade-api";
import { SoundFolderSelect } from "@/components/sound-folder-select";
import { packageOneShotPrompt } from "@/lib/homepage-one-shot-handoff";
import { SOUNDSCAPE_ELEMENT_VOLUME } from "@/lib/bed-volume";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  speakerPreviewLoudSampleKey,
} from "@/lib/speaker-sample-speed";

/** Mixer fader value persisted with the generate job (same as create soundscape). */
const SOUNDSCAPE_GAIN = 50;

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

function IconPlay({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5.14v13.72L19 12 8 5.14z" />
    </svg>
  );
}

function IconPause({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  );
}

function newDayId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `day-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function blankDay(dayNumber: number): AdminProgramDay {
  return {
    id: newDayId(),
    dayNumber,
    title: `Lesson ${dayNumber}`,
    prompt: "",
    description: "",
    speakerModelId: "",
    compositionKey: "",
    targetMinutes: 5,
    status: "draft",
    jobId: null,
    audioUrl: null,
    audioKey: null,
    durationSeconds: null,
    errorMessage: null,
    generatedAt: null,
    generatedPrompt: null,
    generatedSpeakerModelId: null,
    generatedTargetMinutes: null,
  };
}

function renumberDays(days: AdminProgramDay[]): AdminProgramDay[] {
  return days.map((d, i) => ({ ...d, dayNumber: i + 1 }));
}

function dayHasReadyAudio(day: AdminProgramDay): boolean {
  return (
    day.status === "ready" &&
    Boolean(day.audioUrl?.trim()) &&
    Boolean(day.audioKey?.trim())
  );
}

/** True when audio is missing or prompt / speaker / length changed since last generate. */
function isProgramDayAudioStale(
  day: AdminProgramDay,
  programSpeakerModelId: string,
): boolean {
  if (!dayHasReadyAudio(day)) return true;
  const speaker = (programSpeakerModelId || day.speakerModelId).trim();
  const hasFingerprint =
    day.generatedPrompt != null ||
    day.generatedSpeakerModelId != null ||
    day.generatedTargetMinutes != null;
  // Legacy ready audio (no fingerprint yet) — treat as fresh until next generate stamps it.
  if (!hasFingerprint) return false;
  return (
    day.prompt.trim() !== (day.generatedPrompt ?? "").trim() ||
    speaker !== (day.generatedSpeakerModelId ?? "").trim() ||
    day.targetMinutes !== day.generatedTargetMinutes
  );
}

function withProgramSpeaker(
  program: AdminProgram,
  speakerModelId = program.speakerModelId.trim(),
): AdminProgram {
  const sid = speakerModelId.trim();
  return {
    ...program,
    speakerModelId: sid,
    days: program.days.map((d) => ({ ...d, speakerModelId: sid })),
  };
}

type ImportedLesson = {
  title: string;
  prompt: string;
  description?: string;
  targetMinutes?: MeditationTargetMinutes;
  compositionKey?: string;
};

function parseProgramImportJson(raw: string): {
  title?: string;
  description?: string;
  speakerModelId?: string;
  lessons: ImportedLesson[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON — check for trailing commas or quotes.");
  }

  let title: string | undefined;
  let description: string | undefined;
  let speakerModelId: string | undefined;
  let list: unknown[] = [];

  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (typeof o.title === "string" && o.title.trim()) title = o.title.trim();
    if (typeof o.description === "string") description = o.description.trim();
    if (typeof o.speakerModelId === "string" && o.speakerModelId.trim()) {
      speakerModelId = o.speakerModelId.trim();
    }
    if (Array.isArray(o.lessons)) list = o.lessons;
    else if (Array.isArray(o.days)) list = o.days;
    else {
      throw new Error(
        'JSON must be an array of lessons, or an object with a "lessons" / "days" array.',
      );
    }
  } else {
    throw new Error("JSON must be an object or array.");
  }

  const lessons: ImportedLesson[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const lessonTitle =
      (typeof row.title === "string" && row.title.trim()) ||
      (typeof row.name === "string" && row.name.trim()) ||
      "";
    const prompt =
      (typeof row.prompt === "string" && row.prompt.trim()) ||
      (typeof row.oneShot === "string" && row.oneShot.trim()) ||
      (typeof row.one_shot === "string" && row.one_shot.trim()) ||
      "";
    if (!lessonTitle && !prompt) continue;
    const targetRaw = row.targetMinutes ?? row.minutes ?? row.length;
    const targetMinutes =
      typeof targetRaw === "number" && Number.isFinite(targetRaw)
        ? (MEDITATION_TARGET_MINUTES.includes(
            targetRaw as MeditationTargetMinutes,
          )
            ? (targetRaw as MeditationTargetMinutes)
            : undefined)
        : undefined;
    lessons.push({
      title: lessonTitle || `Lesson ${lessons.length + 1}`,
      prompt,
      description:
        typeof row.description === "string" ? row.description.trim() : undefined,
      targetMinutes,
      compositionKey:
        typeof row.compositionKey === "string"
          ? row.compositionKey.trim()
          : typeof row.musicKey === "string"
            ? row.musicKey.trim()
            : undefined,
    });
  }

  if (lessons.length === 0) {
    throw new Error("No lessons found — each item needs a title and/or prompt.");
  }

  return { title, description, speakerModelId, lessons };
}

const IMPORT_JSON_PLACEHOLDER = `{
  "title": "Optional program title",
  "lessons": [
    { "title": "Introduction", "prompt": "A short grounding welcome…" },
    { "title": "Root Chakra", "prompt": "Settle into the base of the spine…" }
  ]
}`;

export function AdminProgramsPanel() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<AdminProgram[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminProgram | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [generateBusyDayId, setGenerateBusyDayId] = useState<string | null>(
    null,
  );
  const [generateBatchBusy, setGenerateBatchBusy] = useState(false);
  const [generateBatchProgress, setGenerateBatchProgress] = useState<
    string | null
  >(null);
  const [describeBusyDayId, setDescribeBusyDayId] = useState<string | null>(
    null,
  );
  const [importJson, setImportJson] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [describeBatchBusy, setDescribeBatchBusy] = useState(false);
  const [describeBatchProgress, setDescribeBatchProgress] = useState<
    string | null
  >(null);
  const [speakers, setSpeakers] = useState<FishSpeaker[]>([]);
  /** Music channel list — compositions already folded in as a subcategory. */
  const [musicItems, setMusicItems] = useState<BackgroundAudioItem[]>([]);
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);
  const [playingSpeakerId, setPlayingSpeakerId] = useState<string | null>(null);
  const [playingCompositionKey, setPlayingCompositionKey] = useState<
    string | null
  >(null);

  const speakerAudioRef = useRef<HTMLAudioElement | null>(null);
  const compositionAudioRef = useRef<HTMLAudioElement | null>(null);

  function stopSpeakerPreview() {
    const el = speakerAudioRef.current;
    if (el) el.pause();
    setPlayingSpeakerId(null);
  }

  function stopCompositionPreview() {
    const el = compositionAudioRef.current;
    if (el) el.pause();
    setPlayingCompositionKey(null);
  }

  function stopAllPreviews() {
    stopSpeakerPreview();
    stopCompositionPreview();
  }

  async function toggleSpeakerPreview(modelId: string) {
    const id = modelId.trim();
    const el = speakerAudioRef.current;
    if (!el || !mediaBaseUrl || !id) return;
    if (playingSpeakerId === id && !el.paused) {
      stopSpeakerPreview();
      return;
    }
    stopCompositionPreview();
    const next = mediaFileUrl(
      mediaBaseUrl,
      speakerPreviewLoudSampleKey(id, FIXED_SPEECH_PREVIEW_SPEED),
    );
    if (el.src !== next) {
      el.src = next;
      void el.load();
    }
    try {
      await el.play();
      setPlayingSpeakerId(id);
    } catch {
      setPlayingSpeakerId(null);
    }
  }

  async function toggleCompositionPreview(key: string) {
    const k = key.trim();
    const el = compositionAudioRef.current;
    if (!el || !mediaBaseUrl || !k) return;
    const url = mediaFileUrl(mediaBaseUrl, backgroundAudioPlaybackKey(k));
    if (playingCompositionKey === k && !el.paused && el.src === url) {
      stopCompositionPreview();
      return;
    }
    stopSpeakerPreview();
    if (el.src !== url) {
      el.src = url;
      // load() resets HTMLMediaElement.volume to 1 — wait, then set bed level.
      await new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener("canplay", done);
          el.removeEventListener("error", done);
          resolve();
        };
        el.addEventListener("canplay", done);
        el.addEventListener("error", done);
        el.load();
      });
    }
    el.volume = SOUNDSCAPE_ELEMENT_VOLUME;
    try {
      await el.play();
      // Re-apply: some browsers reset volume when playback actually starts.
      el.volume = SOUNDSCAPE_ELEMENT_VOLUME;
      setPlayingCompositionKey(k);
    } catch {
      setPlayingCompositionKey(null);
    }
  }

  /** Underlay the day’s music bed while the generated voice stem plays. */
  async function startDayAudioBed(compositionKey: string) {
    const k = compositionKey.trim();
    const el = compositionAudioRef.current;
    if (!el || !mediaBaseUrl || !k) return;
    stopSpeakerPreview();
    const url = mediaFileUrl(mediaBaseUrl, backgroundAudioPlaybackKey(k));
    if (el.src !== url) {
      el.src = url;
      await new Promise<void>((resolve) => {
        const done = () => {
          el.removeEventListener("canplay", done);
          el.removeEventListener("error", done);
          resolve();
        };
        el.addEventListener("canplay", done);
        el.addEventListener("error", done);
        el.load();
      });
    }
    el.loop = true;
    el.volume = SOUNDSCAPE_ELEMENT_VOLUME;
    try {
      await el.play();
      el.volume = SOUNDSCAPE_ELEMENT_VOLUME;
      setPlayingCompositionKey(k);
    } catch {
      setPlayingCompositionKey(null);
    }
  }

  function stopDayAudioBed() {
    const el = compositionAudioRef.current;
    if (el) {
      el.pause();
      el.loop = false;
    }
    setPlayingCompositionKey(null);
  }

  async function loadPrograms() {
    const list = await listAdminPrograms();
    setPrograms(list);
    return list;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError(null);
      try {
        const [list, sp, beds] = await Promise.all([
          listAdminPrograms(),
          listFishSpeakers().catch(() => [] as FishSpeaker[]),
          listBackgroundAudio().catch(() => null),
        ]);
        if (cancelled) return;
        setPrograms(list);
        setSpeakers(sp);
        setMusicItems(beds?.music ?? []);
        setMediaBaseUrl(beds?.baseUrl?.trim() || getMedimadeMediaBaseUrl());
        if (list[0] && !selectedId) {
          setSelectedId(list[0].id);
          setDraft({ ...list[0], days: list[0].days.map((d) => ({ ...d })) });
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load programs");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount load only
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDraft(null);
      return;
    }
    const found = programs.find((p) => p.id === selectedId);
    if (found) {
      setDraft({ ...found, days: found.days.map((d) => ({ ...d })) });
    }
  }, [selectedId, programs]);

  useEffect(() => () => stopAllPreviews(), []);

  const dirty = useMemo(() => {
    if (!draft || !selectedId) return false;
    const saved = programs.find((p) => p.id === selectedId);
    if (!saved) return true;
    return JSON.stringify(draft) !== JSON.stringify(saved);
  }, [draft, programs, selectedId]);

  async function createProgram() {
    setError(null);
    setSaveBusy(true);
    try {
      const saved = await saveAdminProgram({
        title: "New program",
        description: "",
        published: false,
        speakerModelId: "",
        days: [blankDay(1)],
      });
      const list = await loadPrograms();
      setPrograms(list);
      setSelectedId(saved.id);
      setDraft({ ...saved, days: saved.days.map((d) => ({ ...d })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create program");
    } finally {
      setSaveBusy(false);
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setError(null);
    setSaveBusy(true);
    try {
      const synced = withProgramSpeaker({
        ...draft,
        days: renumberDays(draft.days),
      });
      const saved = await saveAdminProgram(synced);
      const list = await loadPrograms();
      setPrograms(list);
      setSelectedId(saved.id);
      setDraft({ ...saved, days: saved.days.map((d) => ({ ...d })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save program");
    } finally {
      setSaveBusy(false);
    }
  }

  async function removeProgram(id: string) {
    if (!window.confirm("Delete this program and all of its lessons?")) return;
    setError(null);
    setSaveBusy(true);
    try {
      await deleteAdminProgram(id);
      const list = await loadPrograms();
      setPrograms(list);
      if (selectedId === id) {
        const next = list[0] ?? null;
        setSelectedId(next?.id ?? null);
        setDraft(
          next ? { ...next, days: next.days.map((d) => ({ ...d })) } : null,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete program");
    } finally {
      setSaveBusy(false);
    }
  }

  function updateDay(dayId: string, patch: Partial<AdminProgramDay>) {
    setDraft((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        days: cur.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)),
      };
    });
  }

  function addDay() {
    setDraft((cur) => {
      if (!cur) return cur;
      const nextNum = cur.days.length + 1;
      return { ...cur, days: [...cur.days, blankDay(nextNum)] };
    });
  }

  function removeDay(dayId: string) {
    setDraft((cur) => {
      if (!cur) return cur;
      if (cur.days.length <= 1) return cur;
      return {
        ...cur,
        days: renumberDays(cur.days.filter((d) => d.id !== dayId)),
      };
    });
  }

  function moveDay(dayId: string, dir: -1 | 1) {
    setDraft((cur) => {
      if (!cur) return cur;
      const idx = cur.days.findIndex((d) => d.id === dayId);
      if (idx < 0) return cur;
      const j = idx + dir;
      if (j < 0 || j >= cur.days.length) return cur;
      const next = [...cur.days];
      const tmp = next[idx]!;
      next[idx] = next[j]!;
      next[j] = tmp;
      return { ...cur, days: renumberDays(next) };
    });
  }

  async function describeDay(dayId: string) {
    if (!draft) return;
    const day = draft.days.find((d) => d.id === dayId);
    if (!day) return;
    if (!day.prompt.trim()) {
      setError("Add a one-shot prompt before generating a description.");
      return;
    }
    setError(null);
    setDescribeBusyDayId(dayId);
    try {
      const description = await generateAdminProgramDayDescription({
        prompt: day.prompt,
        title: day.title,
        programTitle: draft.title,
      });
      updateDay(dayId, { description });
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not generate description",
      );
    } finally {
      setDescribeBusyDayId(null);
    }
  }

  async function describeAllLessons(program: AdminProgram) {
    const targets = program.days.filter((d) => d.prompt.trim());
    if (targets.length === 0) {
      setError("Imported lessons need prompts before descriptions can be generated.");
      return program;
    }
    setDescribeBatchBusy(true);
    setError(null);
    let next = program;
    try {
      for (let i = 0; i < targets.length; i += 1) {
        const day = targets[i]!;
        setDescribeBatchProgress(
          `Generating descriptions… ${i + 1}/${targets.length}`,
        );
        const description = await generateAdminProgramDayDescription({
          prompt: day.prompt,
          title: day.title,
          programTitle: next.title,
        });
        next = {
          ...next,
          days: next.days.map((d) =>
            d.id === day.id ? { ...d, description } : d,
          ),
        };
        setDraft({ ...next, days: next.days.map((d) => ({ ...d })) });
      }
      return next;
    } finally {
      setDescribeBatchBusy(false);
      setDescribeBatchProgress(null);
    }
  }

  async function importLessonsFromJson() {
    if (!draft) return;
    setError(null);
    setImportBusy(true);
    try {
      const parsed = parseProgramImportJson(importJson);
      const hasExistingWork = draft.days.some(
        (d) => d.prompt.trim() || d.audioKey || d.description.trim(),
      );
      if (
        hasExistingWork &&
        !window.confirm(
          "Replace all current lessons with the imported JSON? Existing lesson content will be lost.",
        )
      ) {
        return;
      }

      const speaker =
        parsed.speakerModelId?.trim() || draft.speakerModelId.trim();
      let next: AdminProgram = withProgramSpeaker(
        {
          ...draft,
          title: parsed.title?.trim() || draft.title,
          description:
            parsed.description !== undefined
              ? parsed.description
              : draft.description,
          speakerModelId: speaker,
          days: renumberDays(
            parsed.lessons.map((lesson, i) => ({
              ...blankDay(i + 1),
              title: lesson.title.slice(0, 120),
              prompt: lesson.prompt.slice(0, 4000),
              description: (lesson.description ?? "").slice(0, 600),
              speakerModelId: speaker,
              compositionKey: lesson.compositionKey ?? "",
              targetMinutes: lesson.targetMinutes ?? 5,
            })),
          ),
        },
        speaker,
      );

      setDraft({ ...next, days: next.days.map((d) => ({ ...d })) });
      setImportJson("");

      next = await describeAllLessons(next);
      const saved = await saveAdminProgram(next);
      const list = await loadPrograms();
      setPrograms(list);
      setSelectedId(saved.id);
      setDraft({ ...saved, days: saved.days.map((d) => ({ ...d })) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import lessons");
    } finally {
      setImportBusy(false);
    }
  }

  async function generateDayAudio(
    programIn: AdminProgram,
    dayId: string,
  ): Promise<AdminProgram> {
    const day = programIn.days.find((d) => d.id === dayId);
    if (!day) throw new Error("Lesson not found");
    if (!day.prompt.trim()) {
      throw new Error(`Lesson ${day.dayNumber}: add a one-shot prompt first.`);
    }
    const speakerId =
      programIn.speakerModelId.trim() || day.speakerModelId.trim();
    if (!speakerId) {
      throw new Error("Choose a program speaker before generating.");
    }
    if (!day.compositionKey.trim()) {
      throw new Error(`Lesson ${day.dayNumber}: choose music before generating.`);
    }

    stopAllPreviews();
    setGenerateBusyDayId(dayId);

    let description = day.description.trim();
    if (description.length < PROGRAM_DAY_DESCRIPTION_MIN_CHARS) {
      description = await generateAdminProgramDayDescription({
        prompt: day.prompt,
        title: day.title,
        programTitle: programIn.title,
      });
    }

    const toSave = withProgramSpeaker(
      {
        ...programIn,
        speakerModelId: speakerId,
        days: renumberDays(
          programIn.days.map((d) =>
            d.id === dayId
              ? {
                  ...d,
                  description,
                  speakerModelId: speakerId,
                  status: "generating",
                  errorMessage: null,
                  jobId: null,
                  audioUrl: null,
                  audioKey: null,
                  durationSeconds: null,
                }
              : { ...d, speakerModelId: speakerId },
          ),
        ),
      },
      speakerId,
    );
    const saved = await saveAdminProgram(toSave);
    setPrograms(await loadPrograms());
    setDraft({ ...saved, days: saved.days.map((d) => ({ ...d })) });

    const { jobId } = await createMeditationAudioJob({
      meditationStyle: "General",
      journalMode: true,
      meditationTargetMinutes: day.targetMinutes,
      transcript: `User: ${packageOneShotPrompt(day.prompt)}`,
      scriptText: "",
      reference_id: speakerId,
      ttsProvider: "fish",
      fishTtsModel: "s2.1-pro-free",
      fishPauseMode: "segmented",
      excludeFromLibrary: true,
      speed: FIXED_SPEECH_PREVIEW_SPEED,
      voiceFxPreset: VOICE_FX_PRESET_MEDITATION_MIXER,
      backgroundMusicKey: backgroundAudioStreamingKey(day.compositionKey),
      backgroundMusicGain: SOUNDSCAPE_GAIN,
    });

    let delayMs = 1500;
    let audioUrl = "";
    let audioKey = "";
    let durationSeconds: number | null = null;
    for (;;) {
      const st = await getMeditationAudioJobStatus(jobId);
      if (st.status === "failed") {
        throw new Error(st.error || "Generation failed");
      }
      if (st.status === "completed") {
        audioUrl = st.audioUrl?.trim() || "";
        audioKey = st.audioKey?.trim() || "";
        durationSeconds =
          typeof st.durationSeconds === "number" &&
          Number.isFinite(st.durationSeconds) &&
          st.durationSeconds > 0
            ? st.durationSeconds
            : null;
        if (!audioUrl) throw new Error("Job completed without audio URL");
        break;
      }
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(5000, delayMs + 500);
    }

    const latest = await listAdminPrograms();
    const program = latest.find((p) => p.id === saved.id);
    if (!program) throw new Error("Program missing after generate");
    const nextDays = program.days.map((d) =>
      d.id === dayId
        ? {
            ...d,
            status: "ready" as const,
            jobId,
            audioUrl,
            audioKey: audioKey || null,
            durationSeconds,
            errorMessage: null,
            generatedAt: new Date().toISOString(),
            generatedPrompt: day.prompt.trim(),
            generatedSpeakerModelId: speakerId,
            generatedTargetMinutes: day.targetMinutes,
          }
        : d,
    );
    const finished = await saveAdminProgram({ ...program, days: nextDays });
    setPrograms(await loadPrograms());
    setSelectedId(finished.id);
    setDraft({ ...finished, days: finished.days.map((d) => ({ ...d })) });
    return finished;
  }

  async function generateDay(dayId: string) {
    if (!draft) return;
    setError(null);
    setGenerateBusyDayId(dayId);
    try {
      await generateDayAudio(draft, dayId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Generation failed";
      setError(msg);
      try {
        const latest = await listAdminPrograms();
        const program = latest.find((p) => p.id === draft.id);
        if (program) {
          const nextDays = program.days.map((d) =>
            d.id === dayId
              ? {
                  ...d,
                  status: "failed" as const,
                  errorMessage: msg,
                }
              : d,
          );
          const failed = await saveAdminProgram({ ...program, days: nextDays });
          setPrograms(await loadPrograms());
          setDraft({ ...failed, days: failed.days.map((d) => ({ ...d })) });
        }
      } catch {
        /* keep local error */
      }
    } finally {
      setGenerateBusyDayId(null);
    }
  }

  async function generateAllStaleAudio() {
    if (!draft) return;
    const speakerId = draft.speakerModelId.trim();
    if (!speakerId) {
      setError("Choose a program speaker before generating.");
      return;
    }

    const candidates = draft.days.filter((d) =>
      isProgramDayAudioStale(d, draft.speakerModelId),
    );
    if (candidates.length === 0) {
      setError("Nothing to generate — all lessons are up to date.");
      return;
    }

    const missingMusic = candidates.filter((d) => !d.compositionKey.trim());
    const missingPrompt = candidates.filter((d) => !d.prompt.trim());
    if (missingPrompt.length > 0) {
      setError(
        `Add prompts before batch generate (lesson ${missingPrompt
          .map((d) => d.dayNumber)
          .join(", ")}).`,
      );
      return;
    }
    if (missingMusic.length > 0) {
      setError(
        `Choose music for every stale lesson first (lesson ${missingMusic
          .map((d) => d.dayNumber)
          .join(", ")}).`,
      );
      return;
    }

    setError(null);
    setGenerateBatchBusy(true);
    let current = draft;
    const failures: string[] = [];
    try {
      for (let i = 0; i < candidates.length; i += 1) {
        const day = candidates[i]!;
        setGenerateBatchProgress(
          `Generating audio… ${i + 1}/${candidates.length} (lesson ${day.dayNumber})`,
        );
        try {
          current = await generateDayAudio(current, day.id);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Generation failed";
          failures.push(`Lesson ${day.dayNumber}: ${msg}`);
          try {
            const latest = await listAdminPrograms();
            const program = latest.find((p) => p.id === current.id) ?? current;
            const nextDays = program.days.map((d) =>
              d.id === day.id
                ? {
                    ...d,
                    status: "failed" as const,
                    errorMessage: msg,
                  }
                : d,
            );
            current = await saveAdminProgram({ ...program, days: nextDays });
            setPrograms(await loadPrograms());
            setDraft({ ...current, days: current.days.map((d) => ({ ...d })) });
          } catch {
            /* continue batch */
          }
        }
      }
      if (failures.length > 0) {
        setError(
          `Batch finished with ${failures.length} error(s): ${failures.join(" · ")}`,
        );
      }
    } finally {
      setGenerateBatchBusy(false);
      setGenerateBatchProgress(null);
      setGenerateBusyDayId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted">Loading programs…</p>;
  }

  const canPreview = Boolean(mediaBaseUrl);

  return (
    <div className="space-y-6">
      <audio
        ref={speakerAudioRef}
        className="hidden"
        playsInline
        onEnded={() => setPlayingSpeakerId(null)}
      />
      <audio
        ref={compositionAudioRef}
        className="hidden"
        playsInline
        onEnded={() => setPlayingCompositionKey(null)}
      />

      <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-medium tracking-tight">
              Programs
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Design courses for the Library Programs shelf. Set one speaker for
              the whole course, then add lessons manually or import JSON (titles +
              prompts). Import auto-generates descriptions. Each lesson still picks
              its own music and length before you generate audio. Toggle{" "}
              <strong className="font-semibold text-foreground">Published</strong>{" "}
              to show the course under Library → Programs (saves immediately;
              lesson audio stays off My Creations).
            </p>
          </div>
          <button
            type="button"
            disabled={saveBusy}
            onClick={() => void createProgram()}
            className="shrink-0 cursor-pointer rounded-xl accent-fill-gradient px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
          >
            + New program
          </button>
        </div>
      </div>

      {error ? (
        <p
          className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-border bg-card p-3 sm:p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Courses
          </p>
          {programs.length === 0 ? (
            <p className="text-sm text-muted">No programs yet.</p>
          ) : (
            <ul className="space-y-1">
              {programs.map((p) => {
                const active = p.id === selectedId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        stopAllPreviews();
                        setSelectedId(p.id);
                      }}
                      className={`w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                        active
                          ? "bg-selected font-medium text-on-selected"
                          : "text-foreground hover:bg-background"
                      }`}
                    >
                      <span className="block truncate">{p.title}</span>
                      <span
                        className={`mt-0.5 block text-[11px] ${
                          active ? "text-on-selected/80" : "text-muted"
                        }`}
                      >
                        {p.days.length} lesson
                        {p.days.length === 1 ? "" : "s"}
                        {p.published ? " · published" : " · draft"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {draft ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-medium">
                  Program details
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted">
                    <input
                      type="checkbox"
                      checked={draft.published}
                      disabled={saveBusy}
                      onChange={(e) => {
                        const published = e.target.checked;
                        setDraft((cur) =>
                          cur ? { ...cur, published } : cur,
                        );
                        void (async () => {
                          if (!draft) return;
                          setError(null);
                          setSaveBusy(true);
                          try {
                            const saved = await saveAdminProgram(
                              withProgramSpeaker({
                                ...draft,
                                published,
                                days: renumberDays(draft.days),
                              }),
                            );
                            const list = await loadPrograms();
                            setPrograms(list);
                            setSelectedId(saved.id);
                            setDraft({
                              ...saved,
                              days: saved.days.map((d) => ({ ...d })),
                            });
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Could not update publish state",
                            );
                            setDraft((cur) =>
                              cur ? { ...cur, published: !published } : cur,
                            );
                          } finally {
                            setSaveBusy(false);
                          }
                        })();
                      }}
                      className="accent-[var(--selected)]"
                    />
                    Published
                  </label>
                  <button
                    type="button"
                    disabled={saveBusy || !dirty}
                    onClick={() => void saveDraft()}
                    className="cursor-pointer rounded-xl accent-fill-gradient px-3 py-1.5 text-sm font-semibold text-on-accent disabled:opacity-50"
                  >
                    {saveBusy ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={saveBusy}
                    onClick={() => void removeProgram(draft.id)}
                    className="cursor-pointer rounded-xl border border-border px-3 py-1.5 text-sm font-semibold text-danger hover:bg-danger-soft disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted">Title</span>
                  <input
                    value={draft.title}
                    onChange={(e) =>
                      setDraft((cur) =>
                        cur ? { ...cur, title: e.target.value } : cur,
                      )
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted">Description</span>
                  <textarea
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((cur) =>
                        cur ? { ...cur, description: e.target.value } : cur,
                      )
                    }
                    rows={2}
                    className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                  />
                </label>
                <div className="block text-sm sm:col-span-2">
                  <span className="mb-1 block text-muted">
                    Speaker (all lessons)
                  </span>
                  <div className="flex items-center gap-2">
                    <select
                      value={draft.speakerModelId}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (playingSpeakerId && playingSpeakerId !== next) {
                          stopSpeakerPreview();
                        }
                        setDraft((cur) =>
                          cur ? withProgramSpeaker(cur, next) : cur,
                        );
                      }}
                      className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                    >
                      <option value="">Select speaker…</option>
                      {speakers.map((s) => (
                        <option key={s.modelId} value={s.modelId}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!canPreview || !draft.speakerModelId}
                      aria-label={
                        playingSpeakerId === draft.speakerModelId
                          ? "Pause speaker preview"
                          : "Play speaker preview"
                      }
                      title={
                        playingSpeakerId === draft.speakerModelId
                          ? "Pause speaker preview"
                          : "Play speaker preview"
                      }
                      onClick={() =>
                        void toggleSpeakerPreview(draft.speakerModelId)
                      }
                      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {playingSpeakerId === draft.speakerModelId ? (
                        <IconPause />
                      ) : (
                        <IconPlay />
                      )}
                    </button>
                  </div>
                </div>
                <div className="block text-sm sm:col-span-2">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-muted">Import lessons (JSON)</span>
                    <button
                      type="button"
                      disabled={
                        importBusy ||
                        describeBatchBusy ||
                        saveBusy ||
                        !importJson.trim()
                      }
                      onClick={() => void importLessonsFromJson()}
                      className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:border-accent/40 disabled:opacity-40"
                    >
                      {importBusy || describeBatchBusy
                        ? describeBatchProgress || "Importing…"
                        : "Import + generate descriptions"}
                    </button>
                  </div>
                  <textarea
                    value={importJson}
                    onChange={(e) => setImportJson(e.target.value)}
                    rows={7}
                    spellCheck={false}
                    placeholder={IMPORT_JSON_PLACEHOLDER}
                    className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs outline-none focus:border-accent/50"
                  />
                  <p className="mt-1 text-[11px] text-muted">
                    Paste an array of{" "}
                    <code className="text-foreground/80">
                      {"{ title, prompt }"}
                    </code>{" "}
                    or an object with{" "}
                    <code className="text-foreground/80">lessons</code> /{" "}
                    <code className="text-foreground/80">days</code>. Optional
                    program <code className="text-foreground/80">title</code>.
                    Replaces current lessons, then generates each description.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-medium">
                  Lessons ({draft.days.length})
                  {draft.days.filter((d) =>
                    isProgramDayAudioStale(d, draft.speakerModelId),
                  ).length > 0 ? (
                    <span className="ml-2 text-sm font-normal text-muted">
                      ·{" "}
                      {
                        draft.days.filter((d) =>
                          isProgramDayAudioStale(d, draft.speakerModelId),
                        ).length
                      }{" "}
                      need audio
                    </span>
                  ) : null}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      generateBatchBusy ||
                      Boolean(generateBusyDayId) ||
                      importBusy ||
                      describeBatchBusy ||
                      saveBusy ||
                      !draft.speakerModelId.trim()
                    }
                    onClick={() => void generateAllStaleAudio()}
                    className="cursor-pointer rounded-xl accent-fill-gradient px-3 py-1.5 text-sm font-semibold text-on-accent disabled:opacity-50"
                  >
                    {generateBatchBusy
                      ? generateBatchProgress || "Generating…"
                      : "Generate all audio"}
                  </button>
                  <button
                    type="button"
                    disabled={generateBatchBusy || Boolean(generateBusyDayId)}
                    onClick={addDay}
                    className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:border-accent/40 disabled:opacity-40"
                  >
                    + Add lesson
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted">
                Batch generate runs every lesson with no audio, or where prompt,
                speaker, or length changed since the last successful generate.
                Up-to-date lessons are skipped. Per-lesson Generate still forces a
                regen.
              </p>

              {draft.days.map((day, index) => {
                const generating =
                  generateBusyDayId === day.id ||
                  (generateBatchBusy &&
                    generateBatchProgress?.includes(
                      `lesson ${day.dayNumber}`,
                    ));
                const stale = isProgramDayAudioStale(
                  day,
                  draft.speakerModelId,
                );
                const compositionPlaying =
                  Boolean(day.compositionKey) &&
                  playingCompositionKey === day.compositionKey;
                return (
                  <div
                    key={day.id}
                    className="rounded-2xl border border-border bg-card p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-accent-soft/50 px-2.5 py-0.5 text-xs font-semibold text-accent-link">
                          Lesson {day.dayNumber}
                        </span>
                        <span
                          className={`text-xs font-medium uppercase tracking-wide ${
                            day.status === "ready" && !stale
                              ? "text-success"
                              : day.status === "failed"
                                ? "text-danger"
                                : day.status === "generating" || generating
                                  ? "text-accent-link"
                                  : "text-muted"
                          }`}
                        >
                          {generating
                            ? "generating"
                            : day.status === "ready" && stale
                              ? "stale"
                              : day.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={index === 0 || generateBatchBusy}
                          onClick={() => moveDay(day.id, -1)}
                          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs font-semibold disabled:opacity-40"
                          aria-label="Move lesson up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={
                            index === draft.days.length - 1 || generateBatchBusy
                          }
                          onClick={() => moveDay(day.id, 1)}
                          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs font-semibold disabled:opacity-40"
                          aria-label="Move lesson down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={
                            draft.days.length <= 1 || generateBatchBusy
                          }
                          onClick={() => removeDay(day.id)}
                          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs font-semibold text-danger disabled:opacity-40"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          disabled={
                            generating ||
                            generateBatchBusy ||
                            saveBusy ||
                            importBusy ||
                            describeBatchBusy
                          }
                          onClick={() => void generateDay(day.id)}
                          className="cursor-pointer rounded-xl accent-fill-gradient px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
                        >
                          {generating
                            ? "Generating…"
                            : stale
                              ? "Generate audio"
                              : "Regenerate audio"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1 block text-muted">
                          Lesson title
                        </span>
                        <input
                          value={day.title}
                          onChange={(e) =>
                            updateDay(day.id, { title: e.target.value })
                          }
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                        />
                      </label>
                      <label className="block text-sm sm:col-span-2">
                        <span className="mb-1 block text-muted">
                          One-shot prompt (required)
                        </span>
                        <textarea
                          value={day.prompt}
                          onChange={(e) =>
                            updateDay(day.id, { prompt: e.target.value })
                          }
                          rows={4}
                          placeholder="Describe the meditation you want for this lesson…"
                          className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                        />
                      </label>
                      <div className="block text-sm sm:col-span-2">
                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-muted">
                            Description (optional)
                          </span>
                          <button
                            type="button"
                            disabled={
                              generating ||
                              describeBusyDayId === day.id ||
                              describeBatchBusy ||
                              !day.prompt.trim()
                            }
                            onClick={() => void describeDay(day.id)}
                            className="cursor-pointer rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-foreground hover:border-accent/40 disabled:opacity-40"
                          >
                            {describeBusyDayId === day.id
                              ? "Generating…"
                              : "Generate from prompt"}
                          </button>
                        </div>
                        <textarea
                          value={day.description}
                          onChange={(e) =>
                            updateDay(day.id, { description: e.target.value })
                          }
                          rows={3}
                          placeholder="Listener-facing blurb (~50 words). If left short, Generate audio will create one from the prompt."
                          className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                        />
                        <p className="mt-1 text-[11px] text-muted">
                          {day.description.trim().length}/
                          {PROGRAM_DAY_DESCRIPTION_MIN_CHARS}+ chars preferred
                          before generate
                        </p>
                      </div>
                      <div className="block text-sm">
                        <span className="mb-1 block text-muted">Music</span>
                        <div className="flex items-center gap-2">
                          <SoundFolderSelect
                            category="music"
                            items={musicItems}
                            value={day.compositionKey}
                            disabled={generating}
                            onChange={(next) => {
                              if (
                                playingCompositionKey &&
                                playingCompositionKey !== next
                              ) {
                                stopCompositionPreview();
                              }
                              updateDay(day.id, { compositionKey: next });
                            }}
                          />
                          <button
                            type="button"
                            disabled={
                              !canPreview || !day.compositionKey || generating
                            }
                            aria-label={
                              compositionPlaying
                                ? "Pause music preview"
                                : "Play music preview"
                            }
                            title={
                              compositionPlaying
                                ? "Pause music preview"
                                : "Play music preview"
                            }
                            onClick={() =>
                              void toggleCompositionPreview(day.compositionKey)
                            }
                            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {compositionPlaying ? <IconPause /> : <IconPlay />}
                          </button>
                        </div>
                      </div>
                      <label className="block text-sm">
                        <span className="mb-1 block text-muted">Length</span>
                        <select
                          value={day.targetMinutes}
                          onChange={(e) =>
                            updateDay(day.id, {
                              targetMinutes: Number(
                                e.target.value,
                              ) as MeditationTargetMinutes,
                            })
                          }
                          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                        >
                          {MEDITATION_TARGET_MINUTES.map((m) => (
                            <option key={m} value={m}>
                              {m} min
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {day.errorMessage ? (
                      <p className="mt-2 text-sm text-danger">
                        {day.errorMessage}
                      </p>
                    ) : null}
                    {day.audioUrl ? (
                      <div className="mt-3">
                        <audio
                          controls
                          src={day.audioUrl}
                          className="h-9 w-full max-w-md"
                          preload="none"
                          onPlay={() => {
                            stopSpeakerPreview();
                            if (day.compositionKey.trim()) {
                              void startDayAudioBed(day.compositionKey);
                            } else {
                              stopDayAudioBed();
                            }
                          }}
                          onPause={stopDayAudioBed}
                          onEnded={stopDayAudioBed}
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-card px-5 py-10 text-center text-sm text-muted">
            Create a program to start designing lessons.
          </div>
        )}
      </div>
    </div>
  );
}
