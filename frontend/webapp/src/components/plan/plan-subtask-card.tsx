"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlanDrvSection } from "@/components/plan/plan-drv-section";
import { PlanResistanceNudge } from "@/components/plan/plan-resistance-nudge";
import {
  PlanTodoDraftList,
  type TodoDraftRow,
} from "@/components/plan/plan-todo-draft-list";
import { breakDownIntoTodoTitles } from "@/lib/plan-breakdown-claude";
import {
  createTodo,
  deleteSubtask,
  loadIdeateStore,
  recomputeSubtaskStatus,
  saveIdeateStore,
  todosForSubtask,
  upsertSubtask,
  upsertTodo,
  type IdeateSubtask,
  type IdeateTodo,
} from "@/lib/plan-ideate-store";
import { findStalledTodo } from "@/lib/plan-stalled-todos";

const SUBTASK_REFLECT_PREFIX =
  "You are a warm thinking partner. The user is exploring one piece of a larger project. Reply in 2–6 short sentences.\n\nTheir words:\n\n";

const SUBTASK_OBSTACLE_PREFIX =
  "You are a gentle thinking partner. The user named what feels in the way of this specific piece—not the whole project. Respond in 2–6 sentences.\n\nWhat they shared:\n\n";

const SUBTASK_VISION_PREFIX =
  "Help them deepen one moment when this single piece is done. Present tense, sensory, intimate. Two short paragraphs max.\n\nTheir draft:\n\n";

const SUBTASK_DRV_COPY = {
  dreamTitle: "What would doing this well look like?",
  dreamHint: "Stay with this one piece—not the whole project.",
  dreamPlaceholder: "Describe what good enough would feel like here.",
  dreamButton: "Reflect",
  obstacleTitle: "What's in the way of this piece?",
  obstacleHint: "Resistance for this step, not the whole dream.",
  obstaclePlaceholder: "Name it without fixing it yet.",
  obstacleButton: "Explore",
  visionTitle: "A moment where this is done",
  visionHint: "One specific moment—not the whole album, just this reel.",
  visionPlaceholder: "Where are you, what happened, what do you notice?",
  visionButton: "Build my vision",
};

type Props = {
  subtask: IdeateSubtask;
  todos: IdeateTodo[];
  projectTitle: string;
  projectVision?: string;
  onRefresh: () => void;
  allowNudge: boolean;
  onNudgeUsed: () => void;
  defaultExpanded?: boolean;
};

function formatStepDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export function PlanSubtaskCard({
  subtask,
  todos,
  projectTitle,
  projectVision,
  onRefresh,
  allowNudge,
  onNudgeUsed,
  defaultExpanded = true,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const [showFullFlow, setShowFullFlow] = useState(subtask.usedFullFlow);
  const [draftRows, setDraftRows] = useState<TodoDraftRow[] | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [specifyingId, setSpecifyingId] = useState<string | null>(null);
  const [breakdownErr, setBreakdownErr] = useState<string | null>(null);
  const [showUndoDone, setShowUndoDone] = useState(false);
  const [nudgeTodoId, setNudgeTodoId] = useState<string | null>(null);
  const [dismissedNudge, setDismissedNudge] = useState(false);
  const autoDoneTimer = useRef<number | null>(null);
  const suppressNudgeUntil = useRef(0);

  const patchSubtask = useCallback(
    (partial: Partial<IdeateSubtask>) => {
      let store = loadIdeateStore();
      const cur = store.subtasks.find((s) => s.id === subtask.id);
      if (!cur) return;
      store = upsertSubtask(store, { ...cur, ...partial });
      saveIdeateStore(store);
      onRefresh();
    },
    [subtask.id, onRefresh],
  );

  const patchTodo = useCallback(
    (todoId: string, partial: Partial<IdeateTodo>) => {
      let store = loadIdeateStore();
      const cur = store.todos.find((t) => t.id === todoId);
      if (!cur) return;
      store = upsertTodo(store, { ...cur, ...partial });
      store = recomputeSubtaskStatus(store, subtask.id);
      const updated = store.subtasks.find((s) => s.id === subtask.id);
      if (
        updated?.status === "done" &&
        updated.completedAt &&
        !updated.completedManually
      ) {
        setShowUndoDone(true);
        if (autoDoneTimer.current) window.clearTimeout(autoDoneTimer.current);
        autoDoneTimer.current = window.setTimeout(() => setShowUndoDone(false), 8000);
      }
      saveIdeateStore(store);
      onRefresh();
    },
    [subtask.id, onRefresh],
  );

  useEffect(() => {
    return () => {
      if (autoDoneTimer.current) window.clearTimeout(autoDoneTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!allowNudge || dismissedNudge || todos.length === 0) return;
    if (Date.now() < suppressNudgeUntil.current) return;
    const stalled = findStalledTodo(todos, subtask);
    if (!stalled) return;
    if (stalled.todo.stalledNudgeShownAt) {
      const shown = new Date(stalled.todo.stalledNudgeShownAt).getTime();
      if (Date.now() - shown < 1000 * 60 * 60 * 24) return;
    }
    setNudgeTodoId(stalled.todo.id);
    onNudgeUsed();
  }, [allowNudge, dismissedNudge, todos, subtask, onNudgeUsed]);

  const viewedTodos = useRef(new Set<string>());

  useEffect(() => {
    for (const t of todos) {
      if (t.isChecked || viewedTodos.current.has(t.id)) continue;
      viewedTodos.current.add(t.id);
      patchTodo(t.id, { viewCount: t.viewCount + 1 });
    }
  }, [todos, patchTodo]);

  const breakdownContext = useMemo(() => {
    if (subtask.usedFullFlow || showFullFlow) {
      return [
        subtask.dreamText.trim() && `Dream:\n${subtask.dreamText.trim()}`,
        subtask.resistanceText.trim() &&
          `Resistance:\n${subtask.resistanceText.trim()}`,
        subtask.visionText.trim() && `Vision:\n${subtask.visionText.trim()}`,
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    return subtask.dreamText.trim();
  }, [subtask, showFullFlow]);

  async function runBreakdown(opts?: { specifyItem?: string; replaceRowId?: string }) {
    const specifyItem = opts?.specifyItem;
    if (!breakdownContext.trim() && !specifyItem) {
      setBreakdownErr("Write a little context first.");
      return;
    }
    setBreakdownErr(null);
    setBreakdownLoading(true);
    try {
      const titles = await breakDownIntoTodoTitles({
        projectTitle,
        subtaskTitle: subtask.title,
        contextText: breakdownContext,
        projectVision,
        specifyItem,
      });
      if (specifyItem && draftRows) {
        const i = opts?.replaceRowId
          ? draftRows.findIndex((r) => r.id === opts.replaceRowId)
          : draftRows.findIndex((r) => r.title === specifyItem);
        const expanded = titles.map((title, idx) => ({
          id: `draft_${idx}_${Math.random().toString(16).slice(2)}`,
          title,
        }));
        if (i >= 0) {
          const next = [...draftRows];
          next.splice(i, 1, ...expanded);
          setDraftRows(next);
        } else {
          setDraftRows([
            ...draftRows,
            ...expanded.map((r) => ({ id: r.id, title: r.title })),
          ]);
        }
      } else {
        setDraftRows(
          titles.map((title, idx) => ({
            id: `draft_${idx}_${Math.random().toString(16).slice(2)}`,
            title,
          })),
        );
      }
    } catch (e) {
      setBreakdownErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBreakdownLoading(false);
      setSpecifyingId(null);
    }
  }

  function saveDraftAsTodos() {
    if (!draftRows?.length) return;
    let store = loadIdeateStore();
    const existing = todosForSubtask(store, subtask.id);
    let order = existing.length
      ? Math.max(...existing.map((t) => t.order)) + 1
      : 0;
    for (const row of draftRows) {
      const title = row.title.trim();
      if (!title) continue;
      store = upsertTodo(store, createTodo(subtask.id, title, order));
      order += 1;
    }
    store = recomputeSubtaskStatus(store, subtask.id);
    const cur = store.subtasks.find((s) => s.id === subtask.id);
    if (cur) store = upsertSubtask(store, cur);
    saveIdeateStore(store);
    setDraftRows(null);
    onRefresh();
  }

  function toggleTodo(todo: IdeateTodo) {
    const nextChecked = !todo.isChecked;
    if (nextChecked) {
      suppressNudgeUntil.current = Date.now() + 10_000;
      setDismissedNudge(false);
      setNudgeTodoId(null);
    } else {
      suppressNudgeUntil.current = 0;
    }
    patchTodo(todo.id, {
      isChecked: nextChecked,
      checkedAt: nextChecked ? new Date().toISOString() : null,
      wasUnchecked: todo.isChecked && !nextChecked,
    });
  }

  function undoSubtaskDone() {
    patchSubtask({
      status: "in_progress",
      completedAt: null,
      completedManually: false,
    });
    setShowUndoDone(false);
  }

  function markSubtaskNotDone() {
    patchSubtask({
      status: "in_progress",
      completedAt: null,
      completedManually: true,
    });
  }

  const isDone = subtask.status === "done";
  const nudgeTodo =
    nudgeTodoId && !dismissedNudge
      ? todos.find((t) => t.id === nudgeTodoId) ?? null
      : null;
  const todoDone = todos.filter((t) => t.isChecked).length;
  const todoTotal = todos.length;
  const createdLabel = formatStepDate(subtask.createdAt);
  const updatedLabel = formatStepDate(subtask.updatedAt);

  return (
    <article
      className={`rounded-2xl border shadow-sm transition-all ${
        isDone
          ? "border-border/60 bg-card/40 opacity-80"
          : "border-border bg-card"
      }`}
    >
      <div className="flex items-start gap-2 p-4 pb-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent-soft/25 hover:text-foreground"
        >
          <span
            aria-hidden
            className={`inline-block text-xs transition-transform ${open ? "rotate-90" : ""}`}
          >
            ›
          </span>
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full cursor-pointer text-left"
          >
            <h3 className="font-display text-lg font-medium leading-snug text-foreground">
              {isDone ? (
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="text-accent-link">
                    ✓
                  </span>
                  {subtask.title}
                </span>
              ) : (
                subtask.title
              )}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>Created {createdLabel}</span>
              <span>Updated {updatedLabel}</span>
              {todoTotal > 0 ? (
                <span>
                  {todoDone} of {todoTotal}
                </span>
              ) : null}
            </div>
          </button>
          {open && isDone && showUndoDone ? (
            <button
              type="button"
              onClick={() => undoSubtaskDone()}
              className="mt-1 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
            >
              Mark not actually done
            </button>
          ) : open && isDone ? (
            <button
              type="button"
              onClick={() => markSubtaskNotDone()}
              className="mt-1 cursor-pointer text-xs text-muted hover:text-foreground"
            >
              Reopen
            </button>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Remove subtask"
          onClick={() => {
            if (!window.confirm("Remove this subtask and its todos?")) return;
            let store = loadIdeateStore();
            store = deleteSubtask(store, subtask.id);
            saveIdeateStore(store);
            onRefresh();
          }}
          className="cursor-pointer shrink-0 text-xs text-muted hover:text-foreground"
        >
          Remove
        </button>
      </div>

      {open ? (
        <div className="border-t border-border/60 px-4 pb-4 pt-3">
      {!isDone && !showFullFlow ? (
        <div className="mt-4">
          <label className="block text-sm font-medium text-foreground">
            What does this actually involve?
            <textarea
              value={subtask.dreamText}
              onChange={(e) => patchSubtask({ dreamText: e.target.value })}
              rows={4}
              className="mt-1.5 w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
              placeholder="A sentence or two is enough."
            />
          </label>
          <button
            type="button"
            disabled={breakdownLoading}
            onClick={() => void runBreakdown()}
            className="mt-3 cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
          >
            {breakdownLoading ? "Breaking it down…" : "Break it down"}
          </button>
          {!subtask.usedFullFlow ? (
            <button
              type="button"
              onClick={() => {
                setShowFullFlow(true);
                patchSubtask({ usedFullFlow: true });
              }}
              className="mt-2 block cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
            >
              Go deeper on this
            </button>
          ) : null}
        </div>
      ) : null}

      {!isDone && showFullFlow ? (
        <div className="mt-2">
          <PlanDrvSection
            copy={SUBTASK_DRV_COPY}
            values={{
              dreamText: subtask.dreamText,
              obstacleText: subtask.resistanceText,
              visionText: subtask.visionText,
              dreamReflectReply: subtask.dreamReflectReply,
              obstacleExploreReply: subtask.obstacleExploreReply,
              visionBuildReply: subtask.visionBuildReply,
            }}
            onPatch={(p) => {
              patchSubtask({
                ...(p.dreamText !== undefined ? { dreamText: p.dreamText } : {}),
                ...(p.obstacleText !== undefined
                  ? { resistanceText: p.obstacleText }
                  : {}),
                ...(p.visionText !== undefined ? { visionText: p.visionText } : {}),
                ...(p.dreamReflectReply !== undefined
                  ? { dreamReflectReply: p.dreamReflectReply }
                  : {}),
                ...(p.obstacleExploreReply !== undefined
                  ? { obstacleExploreReply: p.obstacleExploreReply }
                  : {}),
                ...(p.visionBuildReply !== undefined
                  ? { visionBuildReply: p.visionBuildReply }
                  : {}),
                usedFullFlow: true,
              });
            }}
            reflectPrefix={SUBTASK_REFLECT_PREFIX}
            obstaclePrefix={SUBTASK_OBSTACLE_PREFIX}
            visionPrefix={SUBTASK_VISION_PREFIX}
            afterVision={
              subtask.visionBuildReply || subtask.visionText.trim() ? (
                <button
                  type="button"
                  disabled={breakdownLoading}
                  onClick={() => void runBreakdown()}
                  className="mt-4 cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
                >
                  {breakdownLoading ? "Breaking it down…" : "Break into steps"}
                </button>
              ) : null
            }
          />
          {!subtask.usedFullFlow ? (
            <button
              type="button"
              onClick={() => setShowFullFlow(false)}
              className="mt-2 cursor-pointer text-xs text-muted hover:text-foreground"
            >
              Use light flow instead
            </button>
          ) : null}
        </div>
      ) : null}

      {breakdownErr ? (
        <p className="mt-2 text-sm text-danger">
          {breakdownErr}
        </p>
      ) : null}

      {draftRows ? (
        <PlanTodoDraftList
          rows={draftRows}
          onChange={setDraftRows}
          specifyingId={specifyingId}
          onSpecifyRow={async (row) => {
            setSpecifyingId(row.id);
            await runBreakdown({ specifyItem: row.title, replaceRowId: row.id });
          }}
          onSave={() => saveDraftAsTodos()}
        />
      ) : null}

      {todos.length > 0 ? (
        <div className="mt-4">
          <ul className="space-y-2">
            {todos.map((todo) => (
              <li key={todo.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-background/80 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={todo.isChecked}
                    onChange={() => toggleTodo(todo)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span
                    className={`text-sm leading-relaxed ${
                      todo.isChecked ? "text-muted line-through" : "text-foreground"
                    }`}
                  >
                    {todo.title}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {nudgeTodo ? (
            <PlanResistanceNudge
              todo={nudgeTodo}
              projectId={subtask.projectId}
              subtaskId={subtask.id}
              copySeed={nudgeTodo.id}
              onDismiss={() => {
                setDismissedNudge(true);
                setNudgeTodoId(null);
              }}
              onRecorded={() => onRefresh()}
            />
          ) : null}
        </div>
      ) : null}
        </div>
      ) : null}
    </article>
  );
}
