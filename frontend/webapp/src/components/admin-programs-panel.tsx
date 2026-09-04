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
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  speakerPreviewLoudSampleKey,
} from "@/lib/speaker-sample-speed";

const SOUNDSCAPE_GAIN = 50;
const COMPOSITION_PREVIEW_VOLUME = 0.45;

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
    errorMessage: null,
    generatedAt: null,
  };
}

function renumberDays(days: AdminProgramDay[]): AdminProgramDay[] {
  return days.map((d, i) => ({ ...d, dayNumber: i + 1 }));
}

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
  const [describeBusyDayId, setDescribeBusyDayId] = useState<string | null>(
    null,
  );
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
      void el.load();
    }
    el.volume = COMPOSITION_PREVIEW_VOLUME;
    try {
      await el.play();
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
      void el.load();
    }
    el.loop = true;
    el.volume = COMPOSITION_PREVIEW_VOLUME;
    try {
      await el.play();
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
      const saved = await saveAdminProgram({
        ...draft,
        days: renumberDays(draft.days),
      });
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

  async function generateDay(dayId: string) {
    if (!draft) return;
    const day = draft.days.find((d) => d.id === dayId);
    if (!day) return;
    if (!day.prompt.trim()) {
      setError("Add a one-shot prompt before generating.");
      return;
    }
    if (!day.speakerModelId.trim()) {
      setError("Choose a speaker before generating.");
      return;
    }
    if (!day.compositionKey.trim()) {
      setError("Choose music before generating.");
      return;
    }

    stopAllPreviews();
    setError(null);
    setGenerateBusyDayId(dayId);
    updateDay(dayId, {
      status: "generating",
      errorMessage: null,
      jobId: null,
      audioUrl: null,
      audioKey: null,
    });

    try {
      let description = day.description.trim();
      if (description.length < PROGRAM_DAY_DESCRIPTION_MIN_CHARS) {
        description = await generateAdminProgramDayDescription({
          prompt: day.prompt,
          title: day.title,
          programTitle: draft.title,
        });
        updateDay(dayId, { description });
      }

      const toSave: AdminProgram = {
        ...draft,
        days: renumberDays(
          draft.days.map((d) =>
            d.id === dayId
              ? {
                  ...d,
                  description,
                  status: "generating",
                  errorMessage: null,
                  jobId: null,
                  audioUrl: null,
                  audioKey: null,
                }
              : d,
          ),
        ),
      };
      const saved = await saveAdminProgram(toSave);
      setPrograms(await loadPrograms());
      setDraft({ ...saved, days: saved.days.map((d) => ({ ...d })) });

      const { jobId } = await createMeditationAudioJob({
        meditationStyle: "General",
        journalMode: true,
        meditationTargetMinutes: day.targetMinutes,
        transcript: `User: ${packageOneShotPrompt(day.prompt)}`,
        scriptText: "",
        reference_id: day.speakerModelId.trim(),
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
      for (;;) {
        const st = await getMeditationAudioJobStatus(jobId);
        if (st.status === "failed") {
          throw new Error(st.error || "Generation failed");
        }
        if (st.status === "completed") {
          audioUrl = st.audioUrl?.trim() || "";
          audioKey = st.audioKey?.trim() || "";
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
              errorMessage: null,
              generatedAt: new Date().toISOString(),
            }
          : d,
      );
      const finished = await saveAdminProgram({ ...program, days: nextDays });
      setPrograms(await loadPrograms());
      setSelectedId(finished.id);
      setDraft({ ...finished, days: finished.days.map((d) => ({ ...d })) });
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
              Design courses for the Library Programs shelf. Each lesson is a
              one-shot meditation: write the prompt, pick a Fish speaker and
              music, then generate. Toggle <strong className="font-semibold text-foreground">Published</strong> to
              show the course under Library → Programs (saves immediately; lesson
              audio stays off My Creations).
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
                            const saved = await saveAdminProgram({
                              ...draft,
                              published,
                              days: renumberDays(draft.days),
                            });
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
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-display text-base font-medium">
                  Lessons ({draft.days.length})
                </h3>
                <button
                  type="button"
                  onClick={addDay}
                  className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground hover:border-accent/40"
                >
                  + Add lesson
                </button>
              </div>

              {draft.days.map((day, index) => {
                const generating = generateBusyDayId === day.id;
                const speakerPlaying =
                  Boolean(day.speakerModelId) &&
                  playingSpeakerId === day.speakerModelId;
                const compositionPlaying =
                  Boolean(day.compositionKey) &&
                  playingCompositionKey === day.compositionKey;
                return (
                  <div
                    key={day.id}
                    className="rounded-2xl border border-border bg-card p-4 sm:p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-accent-soft/50 px-2.5 py-0.5 text-xs font-semibold text-accent-link">
                          Lesson {day.dayNumber}
                        </span>
                        <span
                          className={`text-xs font-medium uppercase tracking-wide ${
                            day.status === "ready"
                              ? "text-success"
                              : day.status === "failed"
                                ? "text-danger"
                                : day.status === "generating"
                                  ? "text-accent-link"
                                  : "text-muted"
                          }`}
                        >
                          {day.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => moveDay(day.id, -1)}
                          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs font-semibold disabled:opacity-40"
                          aria-label="Move lesson up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={index === draft.days.length - 1}
                          onClick={() => moveDay(day.id, 1)}
                          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs font-semibold disabled:opacity-40"
                          aria-label="Move lesson down"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          disabled={draft.days.length <= 1}
                          onClick={() => removeDay(day.id)}
                          className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs font-semibold text-danger disabled:opacity-40"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          disabled={generating || saveBusy}
                          onClick={() => void generateDay(day.id)}
                          className="cursor-pointer rounded-xl accent-fill-gradient px-3 py-1.5 text-xs font-semibold text-on-accent disabled:opacity-50"
                        >
                          {generating ? "Generating…" : "Generate audio"}
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
                        <span className="mb-1 block text-muted">Speaker</span>
                        <div className="flex items-center gap-2">
                          <select
                            value={day.speakerModelId}
                            onChange={(e) => {
                              const next = e.target.value;
                              if (
                                playingSpeakerId &&
                                playingSpeakerId !== next
                              ) {
                                stopSpeakerPreview();
                              }
                              updateDay(day.id, { speakerModelId: next });
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
                            disabled={
                              !canPreview || !day.speakerModelId || generating
                            }
                            aria-label={
                              speakerPlaying
                                ? "Pause speaker preview"
                                : "Play speaker preview"
                            }
                            title={
                              speakerPlaying
                                ? "Pause speaker preview"
                                : "Play speaker preview"
                            }
                            onClick={() =>
                              void toggleSpeakerPreview(day.speakerModelId)
                            }
                            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-border text-foreground hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {speakerPlaying ? <IconPause /> : <IconPlay />}
                          </button>
                        </div>
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
