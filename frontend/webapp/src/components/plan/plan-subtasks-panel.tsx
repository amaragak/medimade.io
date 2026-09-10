"use client";

import { useCallback, useMemo, useState } from "react";
import { PlanSubtaskCard } from "@/components/plan/plan-subtask-card";
import {
  allSubtasksDone,
  createSubtask,
  loadIdeateStore,
  saveIdeateStore,
  sortSubtasks,
  subtasksForProject,
  todosForSubtask,
  upsertDream,
  upsertSubtask,
  type SubtaskSortKey,
} from "@/lib/plan-ideate-store";
import type { PlanDream } from "@/lib/plan-dreams";

const SORT_OPTIONS: { value: SubtaskSortKey; label: string }[] = [
  { value: "created_asc", label: "Created · oldest first" },
  { value: "created_desc", label: "Created · newest first" },
  { value: "updated_desc", label: "Updated · recent first" },
  { value: "updated_asc", label: "Updated · oldest first" },
  { value: "title_asc", label: "Title · A–Z" },
];

/** Soft adjacent marketing bands (theme tokens — cream pair / navy pair). */
const TASK_BAND_CLASSES = [
  "bg-marketing-band-d",
  "bg-marketing-band-ideate",
] as const;

const BAND_INNER = "mx-auto max-w-6xl px-4 sm:px-6";

type Props = {
  project: PlanDream;
  onRefresh: () => void;
  storeTick?: number;
  embedded?: boolean;
};

export function PlanSubtasksPanel({
  project,
  onRefresh,
  storeTick = 0,
  embedded = false,
}: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [sort, setSort] = useState<SubtaskSortKey>("created_asc");

  const refresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  const store = useMemo(() => {
    void storeTick;
    return loadIdeateStore();
  }, [storeTick]);

  const subtasks = useMemo(() => {
    return sortSubtasks(subtasksForProject(store, project.id), sort);
  }, [project.id, sort, store]);

  const todosBySubtask = useMemo(() => {
    const map = new Map<string, ReturnType<typeof todosForSubtask>>();
    for (const s of subtasks) {
      map.set(s.id, todosForSubtask(store, s.id));
    }
    return map;
  }, [store, subtasks]);

  const allDone = allSubtasksDone(store, project.id);
  const showCompletePrompt =
    allDone && !project.completedAt && subtasks.length > 0;

  function addSubtask() {
    const title = newTitle.trim();
    if (!title) return;
    let s = loadIdeateStore();
    s = upsertSubtask(s, createSubtask(project.id, title));
    saveIdeateStore(s);
    setNewTitle("");
    refresh();
  }

  function markProjectComplete() {
    let s = loadIdeateStore();
    const d = s.dreams.find((x) => x.id === project.id);
    if (!d) return;
    s = upsertDream(s, {
      ...d,
      completedAt: new Date().toISOString(),
      state: "in_motion",
    });
    saveIdeateStore(s);
    refresh();
  }

  return (
    <section className={embedded ? undefined : "mt-16"}>
      <div className={`${BAND_INNER} pb-6`}>
        {showCompletePrompt ? (
          <div className="mb-6 rounded-2xl border border-accent/20 bg-accent-soft/10 px-4 py-4">
            <p className="text-sm leading-relaxed text-foreground">
              All the pieces are in place — is this done?
            </p>
            <button
              type="button"
              onClick={() => markProjectComplete()}
              className="mt-3 cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-accent/40"
            >
              Mark project complete
            </button>
          </div>
        ) : project.completedAt ? (
          <p className="mb-4 text-sm text-muted">
            Project marked complete{" "}
            {new Date(project.completedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        ) : allDone && subtasks.length > 0 ? (
          <p className="mb-4 inline-block rounded-full border border-accent/20 bg-accent-soft/15 px-3 py-1 text-xs font-medium text-accent-link">
            All subtasks done
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Add a task..."
            className="min-w-[12rem] flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none ring-accent/25 focus:ring-2"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSubtask();
              }
            }}
          />
          <button
            type="button"
            disabled={!newTitle.trim()}
            onClick={() => addSubtask()}
            className="cursor-pointer rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-accent/40 disabled:opacity-50"
          >
            Add
          </button>
          <label className="ml-auto flex shrink-0 items-center gap-1.5 text-[12px] text-muted">
            <span className="sr-only">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SubtaskSortKey)}
              className="cursor-pointer border-0 bg-transparent py-1 text-[12px] text-muted outline-none hover:text-foreground"
              aria-label="Sort tasks"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {subtasks.length === 0 ? (
          <p className="mt-8 text-sm text-muted">
            No tasks yet — add one when you&apos;re ready.
          </p>
        ) : null}
      </div>

      {subtasks.length > 0 ? (
        <ul className="w-full">
          {subtasks.map((subtask, index) => (
            <li
              key={subtask.id}
              className={`mm-task-band w-full border-b-[0.5px] border-marketing-ink/15 ${
                TASK_BAND_CLASSES[index % 2]!
              }`}
            >
              <div className={BAND_INNER}>
                <PlanSubtaskCard
                  subtask={subtask}
                  todos={todosBySubtask.get(subtask.id) ?? []}
                  projectTitle={project.title}
                  projectVision={project.visionText}
                  onRefresh={refresh}
                  defaultExpanded={subtask.status !== "done"}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
