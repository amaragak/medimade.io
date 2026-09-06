"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconEye, IconSparkles, IconWind } from "@tabler/icons-react";
import {
  createPlanDream,
  dreamExcerpt,
  loadPlanDreamsStore,
  savePlanDreamsStore,
  upsertPlanDream,
  type PlanDream,
} from "@/lib/plan-dreams";
import { PlanResistanceThreadBanner } from "@/components/plan/plan-resistance-thread-banner";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import { globalResistanceThreads } from "@/lib/plan-resistance-threads";
import {
  loadIdeateVisionBoardStore,
  type VisionBoardItem,
} from "@/lib/ideate-vision-board";
import {
  addCustomQuestion,
  addPresetQuestion,
  availablePresets,
  loadIdeateReflectionQuestionsStore,
  patchQuestionAnswer,
  saveIdeateReflectionQuestionsStore,
  type IdeateReflectionQuestion,
} from "@/lib/ideate-reflection-questions";
import {
  VisionBoardMosaic,
  VISION_BOARD_EMPTY_COLORS,
} from "@/components/plan/vision-board-mosaic";
import { useIdeateCloud } from "@/components/plan/ideate-cloud-provider";

const SECTION_LABEL =
  "text-sm font-medium uppercase tracking-widest text-[#8A7566]";

function lifeAreaSnippet(d: PlanDream): string | null {
  const raw = (d.dreamText || d.firstThought || d.visionText || "").trim();
  if (!raw) return null;
  return dreamExcerpt(d) === "—" ? null : dreamExcerpt(d);
}

function mosaicColors(items: VisionBoardItem[]): readonly string[] {
  if (items.length === 0) return VISION_BOARD_EMPTY_COLORS;
  return items.map((i) => i.color);
}

export function PlanHomeClient() {
  const [dreams, setDreams] = useState<PlanDream[]>([]);
  const [visionItems, setVisionItems] = useState<VisionBoardItem[]>([]);
  const [questions, setQuestions] = useState<IdeateReflectionQuestion[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDream, setNewDream] = useState("");
  const [newObstacle, setNewObstacle] = useState("");
  const [newVision, setNewVision] = useState("");
  const [addQuestionOpen, setAddQuestionOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [writingCustom, setWritingCustom] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [draftAnswer, setDraftAnswer] = useState("");
  const addPickerRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setDreams(loadPlanDreamsStore().dreams);
    setVisionItems(loadIdeateVisionBoardStore().items);
    setQuestions(loadIdeateReflectionQuestionsStore().questions);
  }, []);

  const { ready: cloudReady, revision } = useIdeateCloud();

  useEffect(() => {
    if (!cloudReady) return;
    const id = requestAnimationFrame(() => refresh());
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onFocus);
    };
  }, [refresh, cloudReady, revision]);

  useEffect(() => {
    if (!addQuestionOpen) return;
    function onDoc(e: MouseEvent) {
      if (!addPickerRef.current?.contains(e.target as Node)) {
        setAddQuestionOpen(false);
        setWritingCustom(false);
        setCustomDraft("");
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAddQuestionOpen(false);
        setWritingCustom(false);
        setCustomDraft("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [addQuestionOpen]);

  const sortedDreams = useMemo(
    () =>
      [...dreams].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [dreams],
  );

  const unusedPresets = useMemo(
    () => availablePresets({ v: 1, questions }),
    [questions],
  );

  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === activeQuestionId) ?? null,
    [questions, activeQuestionId],
  );

  function addDream(opts?: { skipReflections?: boolean }) {
    const title = newTitle.trim();
    if (!title) return;
    const store = loadPlanDreamsStore();
    const dream = createPlanDream({
      title,
      dreamText: opts?.skipReflections ? "" : newDream,
      obstacleText: opts?.skipReflections ? "" : newObstacle,
      visionText: opts?.skipReflections ? "" : newVision,
    });
    savePlanDreamsStore(upsertPlanDream(store, dream));
    setNewTitle("");
    setNewDream("");
    setNewObstacle("");
    setNewVision("");
    setModalOpen(false);
    refresh();
  }

  function persistQuestions(next: IdeateReflectionQuestion[]) {
    saveIdeateReflectionQuestionsStore({ v: 1, questions: next });
    setQuestions(next);
  }

  function handleAddPreset(presetId: string, openAfter = false) {
    const next = addPresetQuestion({ v: 1, questions }, presetId);
    persistQuestions(next.questions);
    setAddQuestionOpen(false);
    setWritingCustom(false);
    setCustomDraft("");
    if (openAfter) {
      const added = next.questions.find((q) => q.presetId === presetId);
      if (added) openQuestion(added);
    }
  }

  function handleAddCustom() {
    const next = addCustomQuestion({ v: 1, questions }, customDraft);
    if (next.questions.length === questions.length) return;
    persistQuestions(next.questions);
    setCustomDraft("");
    setWritingCustom(false);
    setAddQuestionOpen(false);
  }

  function openQuestion(q: IdeateReflectionQuestion) {
    setActiveQuestionId(q.id);
    setDraftAnswer(q.answer);
  }

  function saveActiveAnswer() {
    if (!activeQuestionId) return;
    const next = patchQuestionAnswer(
      { v: 1, questions },
      activeQuestionId,
      draftAnswer,
    );
    persistQuestions(next.questions);
    setActiveQuestionId(null);
    setDraftAnswer("");
  }

  const resistanceThreads = globalResistanceThreads(loadIdeateStore());
  const itemCount = visionItems.length;

  if (!cloudReady) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] pb-16">
        <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <p className="text-sm text-muted">Loading…</p>
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-3.5rem)] pb-16">
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        {/* Utilitarian page label — no marketing pitch (that lives on /ideate) */}
        <h1 className="font-display text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
          My Ideas
        </h1>

        {resistanceThreads[0] ? (
          <div className="mt-6 max-w-2xl">
            <PlanResistanceThreadBanner theme={resistanceThreads[0]} />
          </div>
        ) : null}

        {/* —— Section A: Vision board (most prominent) —— */}
        <div className="mt-8">
          <p className={SECTION_LABEL}>Your dream</p>
          <Link
            href="/ideate/my/vision-board"
            className="mt-3 flex w-full flex-col gap-6 rounded-2xl border border-[#E5DFD0] bg-card p-6 shadow-sm transition-colors hover:border-accent/35 hover:bg-accent-soft/10 sm:flex-row sm:items-center sm:gap-8 sm:p-8"
          >
            <VisionBoardMosaic
              colors={mosaicColors(visionItems)}
              sizeClassName="h-[180px] w-full sm:h-[200px] sm:w-[200px] md:h-[220px] md:w-[220px]"
            />
            <div className="min-w-0 flex-1 text-left">
              <h2 className="font-display text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
                Vision board
              </h2>
              <p className="mt-2 text-base leading-relaxed text-muted">
                {itemCount === 0
                  ? "No pieces yet"
                  : `${itemCount} ${itemCount === 1 ? "piece" : "pieces"}`}
                {" · "}
                Gather images and colours for what you&apos;re moving toward.
              </p>
              <span className="mt-5 inline-block text-base font-semibold text-accent-link">
                Open →
              </span>
            </div>
          </Link>
        </div>

        {/* —— Section B: Reflection questions —— */}
        <div className="mt-14">
          <p className={SECTION_LABEL}>Sit with a question</p>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
            Optional prompts beside the board — pick one that catches, or write
            your own.
          </p>
          {questions.length === 0 ? (
            <ul className="mt-6 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
              {unusedPresets.slice(0, 3).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => handleAddPreset(p.id, true)}
                    className="w-full cursor-pointer text-left transition-opacity hover:opacity-80"
                  >
                    <span className="block text-base font-medium leading-snug text-[#1E2530] dark:text-foreground">
                      {p.text}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-[#A39C8C]">
                      {p.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-5 grid grid-cols-1 gap-x-10 gap-y-6 sm:grid-cols-2">
              {questions.map((q) => (
                <li key={q.id}>
                  <button
                    type="button"
                    onClick={() => openQuestion(q)}
                    className="w-full cursor-pointer text-left transition-opacity hover:opacity-80"
                  >
                    <span className="block text-base font-medium leading-snug text-[#1E2530] dark:text-foreground">
                      {q.text}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-[#A39C8C]">
                      {q.answer.trim()
                        ? q.answer.replace(/\s+/g, " ").slice(0, 80) +
                          (q.answer.trim().length > 80 ? "…" : "")
                        : q.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="relative mt-5" ref={addPickerRef}>
            <button
              type="button"
              onClick={() => {
                setAddQuestionOpen((o) => !o);
                setWritingCustom(false);
                setCustomDraft("");
              }}
              className="cursor-pointer text-sm font-medium text-[#B8703A] transition-opacity hover:opacity-80"
            >
              {questions.length === 0 ? "+ Add another" : "+ Add a question"}
            </button>

            {addQuestionOpen ? (
              <div
                role="dialog"
                aria-label="Add a reflection question"
                className="absolute left-0 z-30 mt-2 w-[min(100%,22rem)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
              >
                <ul className="max-h-56 overflow-y-auto py-1">
                  {unusedPresets.length === 0 ? (
                    <li className="px-3 py-2.5 text-sm text-muted">
                      All suggested questions are already added.
                    </li>
                  ) : (
                    unusedPresets.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => handleAddPreset(p.id)}
                          className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent-soft/25"
                        >
                          <span className="min-w-0 flex-1 leading-snug">
                            {p.text}
                          </span>
                          <span
                            className="shrink-0 text-base font-medium text-accent-link"
                            aria-hidden
                          >
                            +
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="border-t border-border bg-accent-soft/15 px-3 py-2.5">
                  {writingCustom ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleAddCustom();
                      }}
                      className="flex flex-col gap-2"
                    >
                      <label className="sr-only" htmlFor="ideate-custom-q">
                        Write your own question
                      </label>
                      <input
                        id="ideate-custom-q"
                        autoFocus
                        value={customDraft}
                        onChange={(e) => setCustomDraft(e.target.value)}
                        placeholder="Your question…"
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setWritingCustom(false);
                            setCustomDraft("");
                          }}
                          className="rounded-full px-3 py-1 text-xs font-medium text-muted hover:text-foreground"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!customDraft.trim()}
                          className="rounded-full accent-fill-gradient px-3 py-1 text-xs font-semibold text-on-accent disabled:opacity-40"
                        >
                          Add
                        </button>
                      </div>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setWritingCustom(true)}
                      className="flex w-full cursor-pointer items-center gap-2 text-left text-sm text-foreground transition-opacity hover:opacity-80"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-accent-link"
                        aria-hidden
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                      Write your own question…
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* —— Section C: Life areas —— */}
        <div className="mt-14">
          <p className={SECTION_LABEL}>Your life areas</p>
          {sortedDreams.length === 0 ? (
            <p className="mt-5 max-w-md text-sm italic text-[#A39C8C]">
              No life areas yet — add one below when you&apos;re ready.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border/70 border-y border-border/70">
              {sortedDreams.map((d) => {
                const snippet = lifeAreaSnippet(d);
                return (
                  <li key={d.id}>
                    <Link
                      href={`/ideate/goal/${encodeURIComponent(d.id)}`}
                      className="flex items-baseline justify-between gap-4 py-4 transition-opacity hover:opacity-80"
                    >
                      <span className="min-w-0 font-display text-lg font-medium tracking-tight text-[#1E2530] dark:text-foreground">
                        {d.title.trim() || "Untitled"}
                      </span>
                      <span
                        className={`max-w-[55%] shrink-0 truncate text-right text-sm ${
                          snippet
                            ? "text-muted"
                            : "italic text-[#A39C8C]"
                        }`}
                      >
                        {snippet ?? "Nothing written yet"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="mt-4 cursor-pointer text-sm font-medium text-[#B8703A] transition-opacity hover:opacity-80"
          >
            + Add a life area
          </button>
        </div>
      </section>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="ideate-add-dream-title"
            className="max-h-[min(92vh,40rem)] w-full max-w-lg overflow-y-auto rounded-[16px] border border-[#E5DFD0] bg-[#FAF8F3] p-6 shadow-xl dark:border-border dark:bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="ideate-add-dream-title"
              className="font-display text-xl font-medium text-[#1E2530] dark:text-foreground"
            >
              New life area
            </h2>
            <p className="mt-1 text-sm text-muted">
              Name it, and optionally seed the dream, resistance, and vision.
            </p>

            <label className="mt-5 block text-sm font-medium text-foreground">
              Title
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Music, Health, This app"
                autoFocus
                className="mt-1.5 w-full rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm outline-none ring-accent/30 focus:ring-2 dark:border-border"
              />
            </label>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#B8703A]/15 text-[#B8703A]">
                    <IconSparkles size={15} stroke={1.75} aria-hidden />
                  </span>
                  The dream
                </span>
                <textarea
                  value={newDream}
                  onChange={(e) => setNewDream(e.target.value)}
                  placeholder="Say it messy. No one is grading this."
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2 dark:border-border"
                />
              </label>

              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#A65252]/15 text-[#A65252]">
                    <IconWind size={15} stroke={1.75} aria-hidden />
                  </span>
                  What&apos;s in the way?
                </span>
                <textarea
                  value={newObstacle}
                  onChange={(e) => setNewObstacle(e.target.value)}
                  placeholder="Name it without fixing it yet."
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2 dark:border-border"
                />
              </label>

              <label className="block">
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#5A7A5E]/15 text-[#5A7A5E]">
                    <IconEye size={15} stroke={1.75} aria-hidden />
                  </span>
                  The vision
                </span>
                <textarea
                  value={newVision}
                  onChange={(e) => setNewVision(e.target.value)}
                  placeholder="A single moment when this has already happened."
                  rows={3}
                  className="mt-2 w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2 dark:border-border"
                />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => addDream({ skipReflections: true })}
                className="cursor-pointer text-sm font-medium text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Skip for now
              </button>
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => addDream()}
                className="cursor-pointer rounded-full bg-[#F0A855] px-5 py-2.5 text-sm font-semibold text-[#1E2530] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeQuestion ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => {
            setActiveQuestionId(null);
            setDraftAnswer("");
          }}
        >
          <div
            role="dialog"
            aria-labelledby="ideate-reflect-q-title"
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="ideate-reflect-q-title"
              className="font-display text-xl font-medium text-foreground"
            >
              {activeQuestion.text}
            </h2>
            {activeQuestion.description ? (
              <p className="mt-1 text-sm text-muted">
                {activeQuestion.description}
              </p>
            ) : null}
            <textarea
              value={draftAnswer}
              onChange={(e) => setDraftAnswer(e.target.value)}
              placeholder="Write freely — no need to polish."
              rows={8}
              autoFocus
              className="mt-5 w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setActiveQuestionId(null);
                  setDraftAnswer("");
                }}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-soft/30 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => saveActiveAnswer()}
                className="rounded-full accent-fill-gradient px-4 py-2 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
