"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
  const nudgedSubtasks = useRef(new Set<string>());

  const refresh = useCallback(() => {
    onRefresh();
  }, [onRefresh]);

  const store = loadIdeateStore();
  void storeTick;
  const subtasks = useMemo(() => {
    const s = loadIdeateStore();
    return sortSubtasks(subtasksForProject(s, project.id), sort);
  }, [project.id, sort, storeTick]);
  const todosBySubtask = new Map<string, ReturnType<typeof todosForSubtask>>();
  for (const s of subtasks) {
    todosBySubtask.set(s.id, todosForSubtask(store, s.id));
  }

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
    <section className={embedded ? "mt-6" : "mt-16 border-t border-border/80 pt-12"}>
      <h2 className="font-display text-xl font-medium text-foreground">Steps</h2>
      <p className="mt-1 text-sm text-muted">
        Concrete pieces of this project—each with its own small todo list.
      </p>

      {showCompletePrompt ? (
        <div className="mt-6 rounded-2xl border border-accent/20 bg-accent-soft/10 px-4 py-4">
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
        <p className="mt-4 text-sm text-muted">
          Project marked complete{" "}
          {new Date(project.completedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      ) : allDone && subtasks.length > 0 ? (
        <p className="mt-4 inline-block rounded-full border border-accent/20 bg-accent-soft/15 px-3 py-1 text-xs font-medium text-accent-link">
          All subtasks done
        </p>
      ) : null}

      {subtasks.length > 0 ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="font-medium">Sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SubtaskSortKey)}
              className="cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none ring-accent/25 focus:ring-2"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="What's the next concrete piece of this?"
          className="min-w-[16rem] flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none ring-accent/25 focus:ring-2"
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
      </div>

      {subtasks.length === 0 ? (
        <p className="mt-8 text-sm text-muted">
          No steps yet — name one small piece when you&apos;re ready.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {subtasks.map((subtask) => (
            <li key={subtask.id}>
              <PlanSubtaskCard
                subtask={subtask}
                todos={todosBySubtask.get(subtask.id) ?? []}
                projectTitle={project.title}
                projectVision={project.visionText}
                onRefresh={refresh}
                allowNudge={!nudgedSubtasks.current.has(subtask.id)}
                onNudgeUsed={() => {
                  nudgedSubtasks.current.add(subtask.id);
                }}
                defaultExpanded={subtask.status !== "done"}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
