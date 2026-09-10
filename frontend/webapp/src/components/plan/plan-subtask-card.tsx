"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import { PlanResistanceNudge } from "@/components/plan/plan-resistance-nudge";
import {
  PlanTodoDraftList,
  type TodoDraftRow,
} from "@/components/plan/plan-todo-draft-list";
import { breakDownIntoTodoDraft, titlesLikelySameTask } from "@/lib/plan-breakdown-claude";
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

type Props = {
  subtask: IdeateSubtask;
  todos: IdeateTodo[];
  projectTitle: string;
  projectVision?: string;
  onRefresh: () => void;
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

function normStepTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Local fallback when the model returns no fromYou: split obvious lists
 * (newlines, bullets, comma / semicolon chains of short clauses).
 */
function extractListedSteps(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  function push(raw: string) {
    const line = raw.replace(/^[-*•–—\d.)]+\s+/, "").trim();
    if (line.length < 3 || line.length > 140) return;
    if (line.length > 90 && /[.!?].+\s/.test(line)) return;
    const key = normStepTitle(line);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(line);
  }

  for (const raw of text.split(/\n+/)) {
    const line = raw.replace(/^[-*•–—\d.)]+\s+/, "").trim();
    if (!line) continue;
    const commaParts = line
      .split(/[,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    // Several short clauses → treat as a list; one long clause → keep whole.
    const looksLikeList =
      commaParts.length >= 2 &&
      commaParts.every((p) => p.length <= 60) &&
      commaParts.filter((p) => p.split(/\s+/).length <= 10).length >=
        commaParts.length - 1;
    if (looksLikeList) {
      for (const p of commaParts) push(p);
    } else {
      push(line);
    }
  }
  return out;
}

function draftId(): string {
  return `draft_${Math.random().toString(16).slice(2)}`;
}

function mergeBreakdownDraftRows(input: {
  existingTodoTitles: string[];
  fromYou: string[];
  suggestions: string[];
  /** Only used if the model left fromYou empty. */
  listedFromContextFallback: string[];
}): TodoDraftRow[] {
  const yours: string[] = [];
  const seen = new Set<string>();

  function takeYours(title: string) {
    const t = title.trim();
    if (!t) return;
    const key = normStepTitle(t);
    if (seen.has(key)) return;
    if ([...yours].some((y) => titlesLikelySameTask(y, t))) return;
    seen.add(key);
    yours.push(t);
  }

  for (const title of input.existingTodoTitles) takeYours(title);
  for (const title of input.fromYou) takeYours(title);
  if (input.fromYou.length === 0) {
    for (const title of input.listedFromContextFallback) takeYours(title);
  }

  const suggestions: string[] = [];
  for (const title of input.suggestions) {
    const t = title.trim();
    if (!t) continue;
    const key = normStepTitle(t);
    if (seen.has(key)) continue;
    if (yours.some((y) => titlesLikelySameTask(y, t))) continue;
    if (suggestions.some((s) => titlesLikelySameTask(s, t))) continue;
    seen.add(key);
    suggestions.push(t);
  }

  return [
    ...yours.map((title) => ({
      id: draftId(),
      title,
      selected: true,
      kind: "yours" as const,
    })),
    ...suggestions.map((title) => ({
      id: draftId(),
      title,
      selected: true,
      kind: "suggestion" as const,
    })),
  ];
}

export function PlanSubtaskCard({
  subtask,
  todos,
  projectTitle,
  projectVision,
  onRefresh,
  defaultExpanded = true,
}: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const [draftRows, setDraftRows] = useState<TodoDraftRow[] | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [specifyingId, setSpecifyingId] = useState<string | null>(null);
  const [breakdownErr, setBreakdownErr] = useState<string | null>(null);
  const [showUndoDone, setShowUndoDone] = useState(false);
  const autoDoneTimer = useRef<number | null>(null);

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

  const viewedTodos = useRef(new Set<string>());

  useEffect(() => {
    for (const t of todos) {
      if (t.isChecked || viewedTodos.current.has(t.id)) continue;
      viewedTodos.current.add(t.id);
      patchTodo(t.id, { viewCount: t.viewCount + 1 });
    }
  }, [todos, patchTodo]);

  const breakdownContext = useMemo(
    () => subtask.dreamText.trim(),
    [subtask.dreamText],
  );

  async function runBreakdown(opts?: {
    specifyItem?: string;
    replaceRowId?: string;
  }) {
    const specifyItem = opts?.specifyItem;
    if (!breakdownContext.trim() && !specifyItem) {
      setBreakdownErr("Write a little context first.");
      return;
    }
    setBreakdownErr(null);
    setBreakdownLoading(true);
    try {
      const draft = await breakDownIntoTodoDraft({
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
        const expanded = draft.suggestions.map((title) => ({
          id: draftId(),
          title,
          selected: true,
          kind: "suggestion" as const,
        }));
        if (i >= 0) {
          const next = [...draftRows];
          next.splice(i, 1, ...expanded);
          setDraftRows(next);
        } else {
          setDraftRows([...draftRows, ...expanded]);
        }
      } else {
        setDraftRows(
          mergeBreakdownDraftRows({
            existingTodoTitles: todos.map((t) => t.title),
            fromYou: draft.fromYou,
            suggestions: draft.suggestions,
            listedFromContextFallback: extractListedSteps(breakdownContext),
          }),
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
    const existingKeys = new Set(existing.map((t) => normStepTitle(t.title)));
    let order = existing.length
      ? Math.max(...existing.map((t) => t.order)) + 1
      : 0;
    for (const row of draftRows) {
      const title = row.title.trim();
      if (!title) continue;
      const key = normStepTitle(title);
      if (existingKeys.has(key)) continue;
      store = upsertTodo(store, createTodo(subtask.id, title, order));
      existingKeys.add(key);
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

  function toggleSubtaskChecked() {
    if (isDone) {
      markSubtaskNotDone();
      return;
    }
    patchSubtask({
      status: "done",
      completedAt: new Date().toISOString(),
      completedManually: true,
    });
    setShowUndoDone(false);
  }

  const collapsed = !open;
  const nudgeTodo =
    todos.find((t) => !t.isChecked) ?? todos[0] ?? null;
  const todoDone = todos.filter((t) => t.isChecked).length;
  const todoTotal = todos.length;
  const createdLabel = formatStepDate(subtask.createdAt);
  const updatedLabel = formatStepDate(subtask.updatedAt);
  const collapsedSummary =
    subtask.dreamText.trim() ||
    (todoTotal > 0 ? `${todoDone} of ${todoTotal} done` : "Nothing written yet");

  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el || collapsed) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
  }, [subtask.dreamText, collapsed, isDone]);

  return (
    <article
      className={`group cursor-pointer pt-6 ${isDone ? "opacity-80" : ""}`}
    >
      <div
        className={`flex w-full items-start justify-between gap-4 text-left ${
          collapsed ? "pb-6" : "pb-2"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <input
            type="checkbox"
            checked={isDone}
            onChange={() => toggleSubtaskChecked()}
            onClick={(e) => e.stopPropagation()}
            aria-label={isDone ? "Mark task not done" : "Mark task done"}
            className="mt-1.5 h-4 w-4 shrink-0 cursor-pointer accent-accent"
          />
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 flex-1 cursor-pointer items-start gap-4 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
                <h3
                  className={`shrink-0 font-display text-[18px] font-normal leading-snug text-foreground ${
                    isDone ? "line-through text-muted" : ""
                  }`}
                >
                  {subtask.title}
                </h3>
                {collapsed ? (
                  <span className="max-w-[320px] overflow-hidden text-ellipsis whitespace-nowrap font-sans text-[14px] font-normal italic text-muted/50">
                    {collapsedSummary}
                  </span>
                ) : null}
              </div>
              {!collapsed ? (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
                  <span>Created {createdLabel}</span>
                  <span>Updated {updatedLabel}</span>
                  {todoTotal > 0 ? (
                    <span>
                      {todoDone} of {todoTotal}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5">
          <button
            type="button"
            aria-label="Remove subtask"
            onClick={(e) => {
              e.stopPropagation();
              if (!window.confirm("Remove this subtask and its todos?")) return;
              let store = loadIdeateStore();
              store = deleteSubtask(store, subtask.id);
              saveIdeateStore(store);
              onRefresh();
            }}
            className="cursor-pointer text-[12px] text-muted hover:text-foreground"
          >
            Remove
          </button>
          <button
            type="button"
            aria-expanded={open}
            aria-label={collapsed ? "Expand task" : "Collapse task"}
            onClick={() => setOpen((v) => !v)}
            className="cursor-pointer text-muted"
          >
            <IconChevronDown
              size={18}
              stroke={2}
              aria-hidden
              className={`transition-transform duration-200 ease-[ease] ${
                collapsed ? "" : "rotate-180"
              }`}
            />
          </button>
        </div>
      </div>

      {collapsed ? (
        <div
          aria-hidden
          className="-mb-px border-b border-border transition-[border-color] duration-200 ease-[ease] group-hover:border-[#F0A855]"
        />
      ) : null}

      <div
        className="grid transition-[grid-template-rows] duration-200 ease-[ease]"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div
          className={`min-h-0 ${collapsed ? "overflow-hidden" : "overflow-visible"}`}
        >
          <div className={collapsed ? "" : "pb-7 pt-4"}>
            {open && isDone && showUndoDone ? (
              <button
                type="button"
                onClick={() => undoSubtaskDone()}
                className="mb-2 cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
              >
                Mark not actually done
              </button>
            ) : open && isDone ? (
              <button
                type="button"
                onClick={() => markSubtaskNotDone()}
                className="mb-2 cursor-pointer text-xs text-muted hover:text-foreground"
              >
                Reopen
              </button>
            ) : null}

            {!isDone ? (
              <div>
                <textarea
                  ref={descriptionRef}
                  value={subtask.dreamText}
                  onChange={(e) => {
                    patchSubtask({ dreamText: e.target.value });
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = `${Math.max(el.scrollHeight, 24)}px`;
                  }}
                  rows={1}
                  aria-label="What this involves"
                  className="w-full resize-none overflow-hidden border-0 bg-transparent px-0 py-0 text-[14px] italic leading-relaxed text-muted outline-none ring-0 placeholder:text-muted/50 focus:ring-0"
                  placeholder="What this involves…"
                />
                <button
                  type="button"
                  disabled={breakdownLoading || !subtask.dreamText.trim()}
                  onClick={() => void runBreakdown()}
                  className="mt-3 cursor-pointer rounded-full border border-[#1E2530] bg-transparent px-4 py-2 text-sm font-medium text-[#1E2530] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#F4F0E8] dark:text-[#F4F0E8]"
                >
                  {breakdownLoading ? "Creating…" : "Create subtasks"}
                </button>
              </div>
            ) : null}

            {breakdownErr ? (
              <p className="mt-2 text-sm text-danger">{breakdownErr}</p>
            ) : null}

            {draftRows ? (
              <PlanTodoDraftList
                rows={draftRows}
                onChange={setDraftRows}
                specifyingId={specifyingId}
                onSpecifyRow={async (row) => {
                  setSpecifyingId(row.id);
                  await runBreakdown({
                    specifyItem: row.title,
                    replaceRowId: row.id,
                  });
                }}
                onSave={() => saveDraftAsTodos()}
              />
            ) : null}

            {todos.length > 0 ? (
              <div className="mt-4">
                <ul className="space-y-1">
                  {todos.map((todo) => (
                    <li key={todo.id}>
                      <label className="flex cursor-pointer items-start gap-3 py-2">
                        <input
                          type="checkbox"
                          checked={todo.isChecked}
                          onChange={() => toggleTodo(todo)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                        />
                        <span
                          className={`text-sm leading-relaxed ${
                            todo.isChecked
                              ? "text-muted line-through"
                              : "text-foreground"
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
                    persistent
                    onRecorded={() => onRefresh()}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
