"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconPencil } from "@tabler/icons-react";
import {
  MixEditorPanel,
  DEFAULT_MIX_EDITOR_VALUES,
  type MixEditorValues,
} from "@/components/mix-editor-panel";
import {
  FOCUS_AMBIENT_S3_PREFIX,
  trackFromFocusMix,
} from "@/components/library-audio-strip";
import { useLibraryPlayer } from "@/components/library-player-provider";
import { SegmentedPillTabs } from "@/components/segmented-pill-tabs";
import {
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
} from "@/lib/auth-session";
import {
  FOCUS_PATTERN_OPTIONS,
  loadFocusPattern,
  saveFocusPattern,
  type FocusPatternId,
} from "@/lib/focus-pattern";
import { loadFocusMix, saveFocusMix } from "@/lib/focus-mix-storage";
import { unlockHtmlMediaPlayback } from "@/lib/audio-lead-buffer";
import {
  readFocusTasksList,
  readSessionsCompletedToday,
  writeFocusTasksList,
  writeSessionsCompletedToday,
  type FocusTaskItem,
} from "@/lib/focus-timer-storage";
import { isDemoIdeateDream } from "@/lib/ideate-demo-seed";
import {
  pullIdeateStoreFromCloud,
  subscribeIdeateCloud,
} from "@/lib/ideate-cloud";
import {
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import {
  loadIdeateStore,
  recomputeSubtaskStatus,
  saveIdeateStore,
  subtasksForProject,
  todosForSubtask,
  upsertSubtask,
  upsertTodo,
  type IdeateStoreV2,
  type IdeateSubtask,
  type IdeateTodo,
} from "@/lib/plan-ideate-store";
import type { PlanDream } from "@/lib/plan-dreams";
import { soundDisplayName } from "@/lib/sound-taxonomy";
import { timeOfDayGreeting } from "@/lib/time-of-day-greeting";

type TimerMode = "focus" | "shortBreak" | "longBreak";
type DrawerTab = "session" | "ideate";
type IdeateLevel = "areas" | "tasks" | "subtasks";

type IdeatePick =
  | { kind: "subtask"; id: string }
  | { kind: "todo"; id: string };

const MODE_DEFAULT_MINUTES: Record<TimerMode, number> = {
  focus: 25,
  shortBreak: 5,
  longBreak: 15,
};

const FOCUS_DURATION_OPTIONS = [15, 25, 50] as const;
const SESSION_DOT_COUNT = 8;

function formatMmSs(totalSeconds: number): string {
  const { mm, ss } = splitMmSs(totalSeconds);
  return `${mm}:${ss}`;
}

function splitMmSs(totalSeconds: number): { mm: string; ss: string } {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return {
    mm: String(m).padStart(2, "0"),
    ss: String(r).padStart(2, "0"),
  };
}

function formatDurationLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function newTaskId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function firstNameFromLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "there";
  const first = trimmed.split(/\s+/)[0] ?? trimmed;
  return first;
}

function pickKey(p: IdeatePick): string {
  return `${p.kind}:${p.id}`;
}

function ChevronRight({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function ChevronLeft({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function FocusTimerView() {
  const {
    playTrack,
    patchNowPlaying,
    dismiss,
    nowPlaying,
    playingS3Key,
    toggleCurrent,
    bedVolumeApiRef,
  } = useLibraryPlayer();
  const [name, setName] = useState("there");
  const [greeting, setGreeting] = useState("Good morning");
  const [taskInput, setTaskInput] = useState("");
  const [mode, setMode] = useState<TimerMode>("focus");
  const [focusMinutes, setFocusMinutes] = useState<number>(25);
  const [durationSec, setDurationSec] = useState(25 * 60);
  const [remainingSec, setRemainingSec] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sessionsToday, setSessionsToday] = useState(0);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [tasksShelfOpen, setTasksShelfOpen] = useState(true);
  const [ideateFlyoutOpen, setIdeateFlyoutOpen] = useState(false);
  const [tasks, setTasks] = useState<FocusTaskItem[]>([]);
  const [draftTask, setDraftTask] = useState("");
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("session");
  const [ideateStore, setIdeateStore] = useState<IdeateStoreV2 | null>(null);
  const [ideateLevel, setIdeateLevel] = useState<IdeateLevel>("areas");
  const [selectedArea, setSelectedArea] = useState<PlanDream | null>(null);
  const [selectedTask, setSelectedTask] = useState<IdeateSubtask | null>(null);
  const [ideatePicks, setIdeatePicks] = useState<IdeatePick[]>([]);
  const [focusPattern, setFocusPattern] = useState<FocusPatternId>("default");
  const [patternPickerOpen, setPatternPickerOpen] = useState(false);
  const [focusMix, setFocusMix] = useState<MixEditorValues>({
    ...DEFAULT_MIX_EDITOR_VALUES,
  });
  const [mixPanelOpen, setMixPanelOpen] = useState(false);
  const [mixNature, setMixNature] = useState<BackgroundAudioItem[]>([]);
  const [mixMusic, setMixMusic] = useState<BackgroundAudioItem[]>([]);
  const [mixDrums, setMixDrums] = useState<BackgroundAudioItem[]>([]);
  const [mixNoise, setMixNoise] = useState<BackgroundAudioItem[]>([]);
  const [mixCompositions, setMixCompositions] = useState<BackgroundAudioItem[]>(
    [],
  );
  const endAtRef = useRef<number | null>(null);
  const remainingRef = useRef(remainingSec);
  const ideateFlyoutRef = useRef<HTMLDivElement>(null);
  const ideateButtonRef = useRef<HTMLButtonElement>(null);
  const patternPickerRef = useRef<HTMLDivElement>(null);
  const soundsButtonRef = useRef<HTMLButtonElement>(null);
  const mixCloseRef = useRef<(() => void) | null>(null);
  const mixCompositionsRef = useRef(mixCompositions);
  mixCompositionsRef.current = mixCompositions;

  useEffect(() => {
    remainingRef.current = remainingSec;
  }, [remainingSec]);

  useEffect(() => {
    const main = document.querySelector("main[data-app-layout='focus']");
    const root = document.documentElement;
    const value = tasksShelfOpen ? "open" : "closed";
    if (main instanceof HTMLElement) main.dataset.focusTasks = value;
    root.dataset.focusTasks = value;
    root.style.setProperty(
      "--focus-tasks-w",
      tasksShelfOpen ? "320px" : "0px",
    );
    return () => {
      if (main instanceof HTMLElement) delete main.dataset.focusTasks;
      delete root.dataset.focusTasks;
      root.style.removeProperty("--focus-tasks-w");
    };
  }, [tasksShelfOpen]);

  useEffect(() => {
    if (!tasksShelfOpen && ideateFlyoutOpen) closeIdeateFlyout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksShelfOpen]);

  useEffect(() => {
    const label =
      getMedimadeSessionDisplayName()?.trim() ||
      getMedimadeSessionEmail()?.trim() ||
      "there";
    setName(firstNameFromLabel(label));
    setGreeting(timeOfDayGreeting());
    setTasks(readFocusTasksList());
    setSessionsToday(readSessionsCompletedToday());
    setFocusPattern(loadFocusPattern());
    setFocusMix(loadFocusMix());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listBackgroundAudio()
      .then((data) => {
        if (cancelled) return;
        setMixNature(data.nature ?? []);
        setMixMusic(data.music ?? []);
        setMixDrums(data.drums ?? []);
        setMixNoise(data.noise ?? []);
        setMixCompositions(data.compositions ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setMixNature([]);
        setMixMusic([]);
        setMixDrums([]);
        setMixNoise([]);
        setMixCompositions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const focusAmbientTitle = useCallback(
    (mix: MixEditorValues) => {
      const musicKey = mix.musicKey.trim();
      if (musicKey) {
        const hit = mixCompositionsRef.current.find((c) => c.key === musicKey);
        if (hit) return soundDisplayName(hit.name);
      }

      const nameFor = (
        items: BackgroundAudioItem[],
        key: string,
      ): string | null => {
        const k = key.trim();
        if (!k) return null;
        const hit = items.find((item) => item.key === k);
        return hit ? soundDisplayName(hit.name) : null;
      };

      // Same order as the Build-your-own faders: Music, Ambience, Drums, Noise.
      const names = [
        nameFor(mixMusic, mix.musicKey),
        nameFor(mixNature, mix.natureKey),
        nameFor(mixDrums, mix.drumsKey),
        nameFor(mixNoise, mix.noiseKey),
      ].filter((n): n is string => Boolean(n));

      if (names.length === 0) return "Focus sounds";
      return `Focus Mix: ${names.join(", ")}`;
    },
    [mixMusic, mixNature, mixDrums, mixNoise],
  );

  const syncFocusAmbientPlayer = useCallback(
    (mix: MixEditorValues) => {
      unlockHtmlMediaPlayback();
      const mediaBase = getMedimadeMediaBaseUrl();
      const next = trackFromFocusMix(mix, {
        mediaBase,
        compositions: mixCompositionsRef.current,
        title: focusAmbientTitle(mix),
      });
      const playingFocus =
        nowPlaying?.s3Key?.startsWith(FOCUS_AMBIENT_S3_PREFIX) === true;
      if (!next) {
        if (playingFocus) dismiss();
        return;
      }
      // Same stem already in the strip — toggle play/pause (covers re-clicking
      // a saved selection that looked selected but never started).
      if (playingFocus && nowPlaying?.s3Key === next.s3Key) {
        toggleCurrent();
        return;
      }
      if (
        playingFocus &&
        nowPlaying &&
        next.ambientKind === "mix" &&
        nowPlaying.ambientKind === "mix"
      ) {
        patchNowPlaying(() => next);
        return;
      }
      playTrack(next);
    },
    [
      dismiss,
      focusAmbientTitle,
      nowPlaying,
      patchNowPlaying,
      playTrack,
      toggleCurrent,
    ],
  );

  const persistFocusMix = useCallback(
    (mix: MixEditorValues) => {
      setFocusMix(mix);
      saveFocusMix(mix);
      syncFocusAmbientPlayer(mix);
    },
    [syncFocusAmbientPlayer],
  );

  const closeMixPanel = useCallback(() => {
    setMixPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!patternPickerOpen) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (patternPickerRef.current?.contains(t)) return;
      setPatternPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPatternPickerOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [patternPickerOpen]);

  useEffect(() => {
    if (!running) {
      endAtRef.current = null;
      return;
    }
    endAtRef.current = Date.now() + remainingRef.current * 1000;
    const id = window.setInterval(() => {
      const endAt = endAtRef.current;
      if (endAt == null) return;
      const next = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
      setRemainingSec(next);
      if (next <= 0) {
        setRunning(false);
        endAtRef.current = null;
        setSessionsToday((prev) => {
          const count = prev + 1;
          writeSessionsCompletedToday(count);
          return count;
        });
        setRemainingSec(0);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!tasksOpen && !ideateFlyoutOpen) return;
    const sync = () => setIdeateStore(loadIdeateStore());
    sync();
    void pullIdeateStoreFromCloud().finally(sync);
    return subscribeIdeateCloud(sync);
  }, [tasksOpen, ideateFlyoutOpen]);

  useEffect(() => {
    if (!ideateFlyoutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeIdeateFlyout();
    };
    const onPointer = (e: MouseEvent | PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (ideateFlyoutRef.current?.contains(t)) return;
      if (ideateButtonRef.current?.contains(t)) return;
      closeIdeateFlyout();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
    // closeIdeateFlyout is stable enough via setters; intentional deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ideateFlyoutOpen]);

  const progress = useMemo(() => {
    if (durationSec <= 0) return 1;
    return Math.min(1, Math.max(0, (durationSec - remainingSec) / durationSec));
  }, [durationSec, remainingSec]);

  const clock = splitMmSs(remainingSec);

  const lifeAreas = useMemo(() => {
    if (!ideateStore) return [];
    return [...ideateStore.dreams]
      .filter((d) => !isDemoIdeateDream(d) && !d.completedAt)
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
  }, [ideateStore]);

  const areaTasks = useMemo(() => {
    if (!ideateStore || !selectedArea) return [];
    return subtasksForProject(ideateStore, selectedArea.id);
  }, [ideateStore, selectedArea]);

  const taskTodos = useMemo(() => {
    if (!ideateStore || !selectedTask) return [];
    return todosForSubtask(ideateStore, selectedTask.id);
  }, [ideateStore, selectedTask]);

  const pickSet = useMemo(
    () => new Set(ideatePicks.map(pickKey)),
    [ideatePicks],
  );

  function applyDuration(seconds: number) {
    setDurationSec(seconds);
    setRemainingSec(seconds);
    remainingRef.current = seconds;
    setRunning(false);
    endAtRef.current = null;
  }

  function selectMode(next: TimerMode) {
    if (next === mode) return;
    setMode(next);
    const mins =
      next === "focus" ? focusMinutes : MODE_DEFAULT_MINUTES[next];
    applyDuration(mins * 60);
  }

  function selectFocusMinutes(mins: number) {
    setFocusMinutes(mins);
    if (mode === "focus") applyDuration(mins * 60);
  }

  function resetTimer() {
    applyDuration(durationSec);
  }

  function skipSession() {
    setRunning(false);
    endAtRef.current = null;
    if (mode === "focus" && remainingSec < durationSec) {
      setSessionsToday((prev) => {
        const count = prev + 1;
        writeSessionsCompletedToday(count);
        return count;
      });
    }
    const mins =
      mode === "focus" ? focusMinutes : MODE_DEFAULT_MINUTES[mode];
    applyDuration(mins * 60);
  }

  function toggleRunning() {
    if (remainingSec <= 0) {
      const mins =
        mode === "focus" ? focusMinutes : MODE_DEFAULT_MINUTES[mode];
      applyDuration(mins * 60);
      setRunning(true);
      return;
    }
    setRunning((v) => !v);
  }

  function persistTasks(next: FocusTaskItem[]) {
    setTasks(next);
    writeFocusTasksList(next);
  }

  function toggleTaskDone(id: string) {
    persistTasks(
      tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    );
  }

  function removeTask(id: string) {
    persistTasks(tasks.filter((t) => t.id !== id));
  }

  function addTaskFromMainInput() {
    const text = taskInput.trim();
    if (!text) return;
    persistTasks([...tasks, { id: newTaskId(), text, done: false }]);
    setTaskInput("");
  }

  function addTask() {
    const text = draftTask.trim();
    if (!text) return;
    persistTasks([
      ...tasks,
      { id: newTaskId(), text, done: false },
    ]);
    setDraftTask("");
  }

  function openTasksDrawer() {
    setDrawerTab("session");
    setIdeateLevel("areas");
    setSelectedArea(null);
    setSelectedTask(null);
    setIdeatePicks([]);
    setIdeateFlyoutOpen(false);
    setTasksOpen(true);
  }

  function closeIdeateFlyout() {
    setIdeateFlyoutOpen(false);
    setIdeateLevel("areas");
    setSelectedArea(null);
    setSelectedTask(null);
    setIdeatePicks([]);
  }

  function openIdeatePicker() {
    if (ideateFlyoutOpen) {
      closeIdeateFlyout();
      return;
    }
    setTasksOpen(false);
    setIdeateLevel("areas");
    setSelectedArea(null);
    setSelectedTask(null);
    setIdeatePicks([]);
    setIdeateFlyoutOpen(true);
  }

  function toggleIdeatePick(pick: IdeatePick) {
    const key = pickKey(pick);
    setIdeatePicks((prev) => {
      if (prev.some((p) => pickKey(p) === key)) {
        return prev.filter((p) => pickKey(p) !== key);
      }
      return [...prev, pick];
    });
  }

  function addIdeatePicksToSession() {
    if (!ideateStore || ideatePicks.length === 0) return;
    const existing = new Set(
      tasks
        .filter((t) => t.ideateKind && t.ideateId)
        .map((t) => `${t.ideateKind}:${t.ideateId}`),
    );
    const additions: FocusTaskItem[] = [];
    for (const pick of ideatePicks) {
      if (pick.kind !== "todo") continue;
      const key = pickKey(pick);
      if (existing.has(key)) continue;
      const todo = ideateStore.todos.find((t) => t.id === pick.id);
      if (!todo) continue;
      const sub = ideateStore.subtasks.find((s) => s.id === todo.subtaskId);
      const area = sub
        ? ideateStore.dreams.find((d) => d.id === sub.projectId)
        : undefined;
      additions.push({
        id: newTaskId(),
        text: todo.title,
        done: false,
        lifeAreaId: area?.id ?? null,
        lifeAreaTitle: area?.title?.trim() || null,
        ideateKind: "todo",
        ideateId: todo.id,
      });
    }
    if (additions.length > 0) persistTasks([...tasks, ...additions]);
    setIdeatePicks([]);
    setIdeateLevel("areas");
    setSelectedArea(null);
    setSelectedTask(null);
    if (ideateFlyoutOpen) {
      setIdeateFlyoutOpen(false);
    } else {
      setDrawerTab("session");
    }
  }

  function markDoneInIdeate(item: FocusTaskItem) {
    if (!item.ideateKind || !item.ideateId) return;
    let store = loadIdeateStore();
    const now = new Date().toISOString();
    if (item.ideateKind === "todo") {
      const todo = store.todos.find((t) => t.id === item.ideateId);
      if (!todo) return;
      store = upsertTodo(store, {
        ...todo,
        isChecked: true,
        checkedAt: now,
      });
      store = recomputeSubtaskStatus(store, todo.subtaskId);
    } else {
      const sub = store.subtasks.find((s) => s.id === item.ideateId);
      if (!sub) return;
      store = upsertSubtask(store, {
        ...sub,
        status: "done",
        completedAt: now,
        completedManually: true,
      });
    }
    saveIdeateStore(store);
    setIdeateStore(store);
  }

  function drillIntoArea(area: PlanDream) {
    setSelectedArea(area);
    setSelectedTask(null);
    setIdeateLevel("tasks");
  }

  function drillIntoTask(task: IdeateSubtask) {
    setSelectedTask(task);
    setIdeateLevel("subtasks");
  }

  function ideateBack() {
    if (ideateLevel === "subtasks") {
      setSelectedTask(null);
      setIdeateLevel("tasks");
      return;
    }
    if (ideateLevel === "tasks") {
      setSelectedArea(null);
      setIdeateLevel("areas");
    }
  }

  const modeOptions = [
    { id: "focus" as const, label: "Focus" },
    { id: "shortBreak" as const, label: "Short break" },
    { id: "longBreak" as const, label: "Long break" },
  ];

  const durationOptions = FOCUS_DURATION_OPTIONS.map((m) => ({
    id: String(m),
    label: String(m),
  }));

  const drawerTabOptions = [
    { id: "session" as const, label: "Session tasks" },
    { id: "ideate" as const, label: "Import from Ideate" },
  ];

  function taskCountForArea(areaId: string): number {
    if (!ideateStore) return 0;
    return subtasksForProject(ideateStore, areaId).length;
  }

  function todosForTask(task: IdeateSubtask): IdeateTodo[] {
    if (!ideateStore) return [];
    return todosForSubtask(ideateStore, task.id);
  }

  const ideateFlyout = ideateFlyoutOpen ? (
    <div
      ref={ideateFlyoutRef}
      role="dialog"
      aria-label="Add from Ideate"
      className="focus-ideate-flyout absolute left-0 top-full z-[160] mt-2 w-[min(100vw-2rem,18.5rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2.5">
        {ideateLevel !== "areas" ? (
          <button
            type="button"
            onClick={ideateBack}
            aria-label="Back"
            className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
          >
            <ChevronLeft />
          </button>
        ) : null}
        <p className="min-w-0 flex-1 truncate text-left text-[10px] font-semibold uppercase tracking-wide text-muted">
          {ideateLevel === "areas" ? (
            "Life areas"
          ) : (
            <>
              {selectedArea?.title?.trim() || "Life area"}
              {selectedTask ? (
                <>
                  <span className="mx-1 normal-case tracking-normal text-muted/60">
                    →
                  </span>
                  <span className="normal-case tracking-normal text-foreground">
                    {selectedTask.title}
                  </span>
                </>
              ) : null}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={closeIdeateFlyout}
          aria-label="Close"
          className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="max-h-[min(50vh,22rem)] overflow-y-auto px-2 py-2">
        {ideateLevel === "areas" ? (
          lifeAreas.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">
              No life areas yet.{" "}
              <Link
                href="/ideate/my?new=1"
                className="font-medium text-accent-link underline-offset-2 hover:underline"
              >
                Add one in Ideate
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col">
              {lifeAreas.map((area) => {
                const count = taskCountForArea(area.id);
                return (
                  <li key={area.id}>
                    <button
                      type="button"
                      onClick={() => drillIntoArea(area)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-nav-active"
                    >
                      <span className="min-w-0 flex-1 font-display text-[15px] font-medium tracking-tight text-foreground">
                        {area.title.trim() || "Untitled"}
                      </span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {count}
                      </span>
                      <ChevronRight className="shrink-0 text-muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {ideateLevel === "tasks" ? (
          areaTasks.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">
              No tasks in this life area.
            </p>
          ) : (
            <ul className="flex flex-col">
              {areaTasks.map((task) => {
                const todos = todosForTask(task);
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      onClick={() => drillIntoTask(task)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-nav-active"
                    >
                      <span className="min-w-0 flex-1 text-[14px] text-foreground">
                        {task.title}
                      </span>
                      <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        {todos.length}
                      </span>
                      <ChevronRight className="shrink-0 text-muted" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}

        {ideateLevel === "subtasks" ? (
          taskTodos.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted">
              No subtasks under this task.
            </p>
          ) : (
            <ul className="flex flex-col">
              {taskTodos.map((todo) => {
                const checked = pickSet.has(
                  pickKey({ kind: "todo", id: todo.id }),
                );
                return (
                  <li key={todo.id}>
                    <button
                      type="button"
                      onClick={() =>
                        toggleIdeatePick({
                          kind: "todo",
                          id: todo.id,
                        })
                      }
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-nav-active"
                    >
                      <span
                        className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border ${
                          checked
                            ? "border-accent bg-accent-soft text-accent-link"
                            : "border-border text-transparent"
                        }`}
                        aria-hidden
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="12"
                          height="12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </span>
                      <span className="min-w-0 flex-1 text-[14px] text-foreground">
                        {todo.title}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>

      <div className="border-t border-border/70 p-3">
        <button
          type="button"
          disabled={ideatePicks.length === 0}
          onClick={addIdeatePicksToSession}
          className="accent-fill-gradient w-full cursor-pointer rounded-full px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add to session
          {ideatePicks.length > 0 ? ` (${ideatePicks.length})` : ""}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div className="group/focus relative flex min-h-0 w-full flex-1 flex-row overflow-hidden">
      {/* LEFT — timer (number vertically centred in the focus column) */}
      <div
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col px-12 py-10 ${
          tasksShelfOpen ? "border-r-[0.5px] border-border" : ""
        }`}
      >
        <div
          ref={patternPickerRef}
          className="absolute bottom-4 right-4 z-[20] sm:bottom-5 sm:right-5"
        >
          <button
            type="button"
            onClick={() => setPatternPickerOpen((o) => !o)}
            aria-label="Change focus pattern"
            aria-expanded={patternPickerOpen}
            title="Pattern"
            className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-border bg-card/90 text-foreground shadow-md backdrop-blur-sm transition-[opacity,colors] hover:border-accent/50 hover:bg-card ${
              patternPickerOpen
                ? "opacity-100"
                : "opacity-0 group-hover/focus:opacity-100 group-focus-within/focus:opacity-100 max-md:opacity-70"
            }`}
          >
            <IconPencil size={15} stroke={1.75} aria-hidden />
          </button>
          {patternPickerOpen ? (
            <div
              role="listbox"
              aria-label="Focus edge pattern"
              className="absolute bottom-full right-0 z-20 mb-2 grid w-[14.5rem] grid-cols-3 gap-3 rounded-xl border border-border bg-card p-3 shadow-lg"
            >
              {FOCUS_PATTERN_OPTIONS.map((opt) => {
                const selected = opt.id === focusPattern;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    aria-label={opt.label}
                    title={opt.label}
                    onClick={() => {
                      setFocusPattern(opt.id);
                      saveFocusPattern(opt.id);
                      setPatternPickerOpen(false);
                    }}
                    className={`mx-auto h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border bg-cover bg-center transition-[box-shadow] ${
                      selected
                        ? "border-transparent ring-2 ring-accent ring-offset-2 ring-offset-card"
                        : "border-border hover:border-accent/50"
                    }`}
                    style={{
                      backgroundColor: opt.swatch,
                      backgroundImage: opt.swatchImage
                        ? `url(${opt.swatchImage})`
                        : undefined,
                    }}
                  />
                );
              })}
            </div>
          ) : null}
        </div>

        <button
          ref={soundsButtonRef}
          type="button"
          aria-expanded={mixPanelOpen}
          aria-haspopup="dialog"
          onClick={() => {
            if (mixPanelOpen) {
              mixCloseRef.current?.();
              return;
            }
            unlockHtmlMediaPlayback();
            setMixPanelOpen(true);
          }}
          className="absolute left-4 top-4 z-[20] cursor-pointer rounded-full border border-border bg-card/90 px-3.5 py-1.5 text-sm font-medium text-muted shadow-sm backdrop-blur-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/40 hover:text-foreground sm:left-5 sm:top-5"
        >
          Sounds
        </button>

        {!tasksShelfOpen ? (
          <button
            type="button"
            onClick={() => setTasksShelfOpen(true)}
            className="absolute right-4 top-4 z-[20] cursor-pointer rounded-full border border-border bg-card/90 px-3.5 py-1.5 text-sm font-medium text-muted shadow-sm backdrop-blur-sm transition-colors hover:border-accent/40 hover:bg-accent-soft/40 hover:text-foreground sm:right-5 sm:top-5"
          >
            Tasks
          </button>
        ) : null}

        {mixPanelOpen ? (
          <MixEditorPanel
            key="focus-mix"
            title=""
            editorKey="focus"
            anchorEl={soundsButtonRef.current}
            natureItems={mixNature}
            musicItems={mixMusic}
            drumsItems={mixDrums}
            noiseItems={mixNoise}
            compositionItems={mixCompositions}
            error={null}
            initialMix={focusMix}
            resetMix={DEFAULT_MIX_EDITOR_VALUES}
            onLiveVolume={(channel, gain) => {
              if (!nowPlaying?.s3Key?.startsWith(FOCUS_AMBIENT_S3_PREFIX)) {
                return;
              }
              bedVolumeApiRef.current?.setBedVolume(channel, gain);
            }}
            onPreview={persistFocusMix}
            onPersist={persistFocusMix}
            onClose={closeMixPanel}
            closeRef={mixCloseRef}
            placement="below-start"
            showReset={false}
            disableLocalPreview
            stripPlayingMusicKey={
              playingS3Key?.startsWith(FOCUS_AMBIENT_S3_PREFIX)
                ? (nowPlaying?.musicKey ?? null)
                : null
            }
          />
        ) : null}

        <div className="relative mx-auto h-full w-full max-w-[28rem] min-h-0 text-center">
          {/* Greeting + mode sit above the timer number */}
          <div className="absolute inset-x-0 bottom-1/2 mb-[9.25rem] flex flex-col items-center gap-3">
            <p className="font-display text-lg font-light text-muted sm:text-xl">
              {greeting}, {name}.
            </p>
            <SegmentedPillTabs
              aria-label="Timer mode"
              options={modeOptions}
              value={mode}
              onChange={selectMode}
            />
          </div>

          <div
            className="absolute inset-x-0 bottom-1/2 mb-5 flex justify-center font-display text-[7.5rem] font-light leading-none tracking-tight text-foreground"
            aria-live="polite"
            aria-atomic
            aria-label={formatMmSs(remainingSec)}
          >
            {/* Colon is the only in-flow glyph — fixed at the column centre. */}
            <span className="relative inline-block">
              <span className="invisible select-none" aria-hidden>
                :
              </span>
              <span className="absolute right-full top-0 pr-[0.06em] tabular-nums">
                {clock.mm}
              </span>
              <span className="absolute left-0 top-0" aria-hidden>
                :
              </span>
              <span className="absolute left-full top-0 pl-[0.06em] tabular-nums">
                {clock.ss}
              </span>
            </span>
          </div>

          {/* Progress bar vertically centred in the focus column */}
          <div className="absolute inset-x-0 top-1/2 w-full -translate-y-1/2">
            <div className="focus-progress-track w-full">
              <div
                className="relative h-2.5 w-full overflow-visible rounded-full bg-border"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={durationSec}
                aria-valuenow={durationSec - remainingSec}
                aria-label="Session progress"
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-gold transition-[width] duration-1000 ease-linear"
                  style={{ width: `${progress * 100}%` }}
                />
                <span
                  className="absolute top-1/2 size-3.5 -translate-y-1/2 rounded-full bg-gold ring-2 ring-accent/35"
                  style={{ left: `calc(${progress * 100}% - 7px)` }}
                  aria-hidden
                />
              </div>
            </div>
          </div>

          {/* Duration labels + controls sit below the centred bar */}
          <div className="absolute inset-x-0 top-1/2 mt-2.5 flex w-full flex-col items-center">
            <div className="flex w-full items-center justify-between font-display text-xs font-medium tabular-nums tracking-tight text-muted sm:text-sm">
              <span>0:00</span>
              <span>{formatDurationLabel(durationSec)}</span>
            </div>

            <div className="mt-6 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={resetTimer}
                aria-label="Reset timer"
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-nav-active"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 12a9 9 0 1 0 3-6.7" />
                  <path d="M3 4v5h5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={toggleRunning}
                className="accent-fill-gradient inline-flex min-w-[7.5rem] cursor-pointer items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
              >
                {running ? "Pause" : "Start"}
              </button>
              <button
                type="button"
                onClick={skipSession}
                aria-label="Skip session"
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-nav-active"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 4l10 8-10 8V4z" />
                  <path d="M19 5v14" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT — tasks */}
      {tasksShelfOpen ? (
      <aside className="focus-task-shelf relative flex h-full w-[320px] shrink-0 flex-col px-6 pb-5 pt-7">
        <div className="mb-3.5 flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Tasks
          </p>
          <button
            type="button"
            onClick={() => setTasksShelfOpen(false)}
            aria-label="Close tasks"
            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <input
          id="focus-task-input"
          type="text"
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTaskFromMainInput();
            }
          }}
          placeholder="Add a task..."
          className="w-full border-0 border-b border-border bg-transparent pb-2 font-display text-[15px] font-normal italic leading-snug text-foreground outline-none ring-0 placeholder:text-muted/70 focus:ring-0"
        />

        <div className="relative mt-3 self-start">
          <button
            ref={ideateButtonRef}
            type="button"
            aria-expanded={ideateFlyoutOpen}
            aria-haspopup="dialog"
            onClick={openIdeatePicker}
            className="cursor-pointer rounded-full border border-border bg-background/80 px-3 py-1 text-sm font-medium text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft/40 hover:text-foreground"
          >
            Add from Ideate →
          </button>
          {ideateFlyout}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          {tasks.length > 0 ? (
            <ul className="flex w-full flex-col gap-0.5 text-left">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex w-full items-start gap-2.5 border-b border-border/40 py-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleTaskDone(t.id)}
                    aria-pressed={t.done}
                    aria-label={t.done ? "Mark incomplete" : "Mark complete"}
                    className={`mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                      t.done
                        ? "border-accent bg-accent-soft text-accent-link"
                        : "border-border bg-transparent text-transparent hover:border-accent/50"
                    }`}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`text-[13px] leading-snug ${
                          t.done
                            ? "text-muted line-through"
                            : "text-foreground"
                        }`}
                      >
                        {t.text}
                      </span>
                      {t.lifeAreaTitle ? (
                        <span className="rounded-full bg-accent-soft/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
                          {t.lifeAreaTitle}
                        </span>
                      ) : null}
                    </div>
                    {t.done && t.ideateKind && t.ideateId ? (
                      <button
                        type="button"
                        onClick={() => markDoneInIdeate(t)}
                        className="mt-0.5 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                      >
                        Mark as done in Ideate →
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeTask(t.id)}
                    aria-label={`Remove ${t.text}`}
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted/70 transition-colors hover:bg-nav-active hover:text-foreground"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      aria-hidden
                    >
                      <path d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-3 shrink-0 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Today
              </p>
              <div
                className="flex items-center gap-1.5"
                aria-label="Sessions today"
              >
                {Array.from({ length: SESSION_DOT_COUNT }, (_, i) => {
                  const completed = i < sessionsToday;
                  const current =
                    i === sessionsToday && running && mode === "focus";
                  return (
                    <span
                      key={i}
                      className={`size-[7px] rounded-full ${
                        completed
                          ? "bg-gold"
                          : current
                            ? "bg-gold/70 ring-2 ring-accent/35"
                            : "bg-border/60"
                      }`}
                      aria-hidden
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              <Link
                href="/meditate/sounds"
                className="rounded-full border border-transparent px-2 py-1 text-sm text-muted transition-colors hover:border-border hover:bg-accent-soft/40 hover:text-foreground"
              >
                Sounds
              </Link>
              <button
                type="button"
                disabled
                title="Coming soon"
                className="cursor-not-allowed rounded-full border border-transparent px-2 py-1 text-sm text-muted/50"
              >
                History
              </button>
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Min
            </p>
            <SegmentedPillTabs
              aria-label="Focus duration minutes"
              options={durationOptions}
              value={String(focusMinutes)}
              onChange={(id) => selectFocusMinutes(Number(id))}
            />
          </div>
        </div>
      </aside>
      ) : null}

      {tasksOpen ? (
        <>
          <button
            type="button"
            aria-label="Close tasks"
            className="fixed inset-0 z-[140] bg-black/25 md:left-[200px]"
            onClick={() => setTasksOpen(false)}
          />
          <div
            role="dialog"
            aria-modal
            aria-label="Tasks"
            className="fixed inset-x-0 bottom-0 z-[150] flex max-h-[75vh] flex-col rounded-t-2xl border-t border-border bg-background/95 shadow-xl backdrop-blur-md md:left-[200px]"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col overflow-hidden px-4 pb-6 pt-4 sm:px-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Tasks
                </p>
                <button
                  type="button"
                  onClick={() => setTasksOpen(false)}
                  aria-label="Close"
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <div className="mb-4">
                <SegmentedPillTabs
                  aria-label="Tasks drawer mode"
                  options={drawerTabOptions}
                  value={drawerTab}
                  onChange={setDrawerTab}
                  equalWidth
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {drawerTab === "session" ? (
                  <>
                    <ul className="flex flex-col gap-2">
                      {tasks.length === 0 ? (
                        <li className="py-2 text-sm text-muted">
                          No tasks yet. Add one below or import from Ideate.
                        </li>
                      ) : (
                        tasks.map((t) => (
                          <li key={t.id} className="flex items-start gap-3 py-1.5">
                            <button
                              type="button"
                              onClick={() => toggleTaskDone(t.id)}
                              aria-pressed={t.done}
                              aria-label={
                                t.done ? "Mark incomplete" : "Mark complete"
                              }
                              className={`mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                                t.done
                                  ? "border-accent bg-accent-soft text-accent-link"
                                  : "border-border bg-transparent text-transparent hover:border-accent/50"
                              }`}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="12"
                                height="12"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <path d="M5 12l5 5L20 7" />
                              </svg>
                            </button>
                            <div className="min-w-0 flex-1 text-left">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`text-[15px] leading-snug ${
                                    t.done
                                      ? "text-muted line-through"
                                      : "text-foreground"
                                  }`}
                                >
                                  {t.text}
                                </span>
                                {t.lifeAreaTitle ? (
                                  <span className="rounded-full bg-accent-soft/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-link">
                                    {t.lifeAreaTitle}
                                  </span>
                                ) : null}
                              </div>
                              {t.done && t.ideateKind && t.ideateId ? (
                                <button
                                  type="button"
                                  onClick={() => markDoneInIdeate(t)}
                                  className="mt-1 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                                >
                                  Mark as done in Ideate →
                                </button>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => removeTask(t.id)}
                              aria-label={`Remove ${t.text}`}
                              className="mt-0.5 inline-flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted/70 transition-colors hover:bg-nav-active hover:text-foreground"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                width="14"
                                height="14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                aria-hidden
                              >
                                <path d="M6 6l12 12M18 6L6 18" />
                              </svg>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>

                    <div className="mt-4 flex items-center gap-2 border-t border-border/70 pt-4">
                      <input
                        type="text"
                        value={draftTask}
                        onChange={(e) => setDraftTask(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTask();
                          }
                        }}
                        placeholder="New task"
                        className="min-w-0 flex-1 border-0 bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted/70"
                      />
                      <button
                        type="button"
                        onClick={addTask}
                        className="cursor-pointer text-sm font-medium text-accent-link underline-offset-2 hover:underline"
                      >
                        + Add task
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-3">
                    {ideateLevel !== "areas" ? (
                      <div className="flex items-center gap-2 text-left">
                        <button
                          type="button"
                          onClick={ideateBack}
                          aria-label="Back"
                          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
                        >
                          <ChevronLeft />
                        </button>
                        <p className="min-w-0 truncate text-sm text-muted">
                          {selectedArea?.title?.trim() || "Life area"}
                          {selectedTask ? (
                            <>
                              <span className="mx-1.5 text-muted/60">→</span>
                              <span className="text-foreground">
                                {selectedTask.title}
                              </span>
                            </>
                          ) : null}
                        </p>
                      </div>
                    ) : null}

                    {ideateLevel === "areas" ? (
                      lifeAreas.length === 0 ? (
                        <p className="py-2 text-sm text-muted">
                          No life areas yet.{" "}
                          <Link
                            href="/ideate/my?new=1"
                            className="font-medium text-accent-link underline-offset-2 hover:underline"
                          >
                            Add one in Ideate
                          </Link>
                          .
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {lifeAreas.map((area) => {
                            const count = taskCountForArea(area.id);
                            return (
                              <li key={area.id}>
                                <button
                                  type="button"
                                  onClick={() => drillIntoArea(area)}
                                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-nav-active"
                                >
                                  <span className="min-w-0 flex-1 font-display text-[17px] font-medium tracking-tight text-foreground">
                                    {area.title.trim() || "Untitled"}
                                  </span>
                                  <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted">
                                    {count}
                                  </span>
                                  <ChevronRight className="shrink-0 text-muted" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )
                    ) : null}

                    {ideateLevel === "tasks" ? (
                      areaTasks.length === 0 ? (
                        <p className="py-2 text-sm text-muted">
                          No tasks in this life area.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {areaTasks.map((task) => {
                            const todos = todosForTask(task);
                            return (
                              <li key={task.id}>
                                <button
                                  type="button"
                                  onClick={() => drillIntoTask(task)}
                                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-nav-active"
                                >
                                  <span className="min-w-0 flex-1 text-[15px] text-foreground">
                                    {task.title}
                                  </span>
                                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted">
                                    {todos.length}
                                  </span>
                                  <ChevronRight className="shrink-0 text-muted" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )
                    ) : null}

                    {ideateLevel === "subtasks" ? (
                      taskTodos.length === 0 ? (
                        <p className="py-2 text-sm text-muted">
                          No subtasks under this task.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1">
                          {taskTodos.map((todo) => {
                            const checked = pickSet.has(
                              pickKey({ kind: "todo", id: todo.id }),
                            );
                            return (
                              <li key={todo.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleIdeatePick({
                                      kind: "todo",
                                      id: todo.id,
                                    })
                                  }
                                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-nav-active"
                                >
                                  <span
                                    className={`inline-flex size-5 shrink-0 items-center justify-center rounded-full border ${
                                      checked
                                        ? "border-accent bg-accent-soft text-accent-link"
                                        : "border-border text-transparent"
                                    }`}
                                    aria-hidden
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="12"
                                      height="12"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="3"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M5 12l5 5L20 7" />
                                    </svg>
                                  </span>
                                  <span className="min-w-0 flex-1 text-[15px] text-foreground">
                                    {todo.title}
                                  </span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )
                    ) : null}
                  </div>
                )}
              </div>

              {drawerTab === "ideate" ? (
                <div className="mt-4 border-t border-border/70 pt-4">
                  <button
                    type="button"
                    disabled={ideatePicks.length === 0}
                    onClick={addIdeatePicksToSession}
                    className="accent-fill-gradient w-full cursor-pointer rounded-full px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add to session
                    {ideatePicks.length > 0
                      ? ` (${ideatePicks.length})`
                      : ""}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
