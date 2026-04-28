"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DREAM_STATE_LABEL,
  DREAM_STATE_ORDER,
  dreamExcerpt,
  loadPlanDreamsStore,
  savePlanDreamsStore,
  createPlanDream,
  upsertPlanDream,
  type DreamState,
  type PlanDream,
} from "@/lib/plan-dreams";

type FilterTab = "all" | DreamState;

function formatAdded(iso: string): string {
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

export function PlanHomeClient() {
  const [dreams, setDreams] = useState<PlanDream[]>([]);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newThought, setNewThought] = useState("");

  const refresh = useCallback(() => {
    setDreams(loadPlanDreamsStore().dreams);
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => refresh());
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onFocus);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onFocus);
    };
  }, [refresh]);

  const filtered = useMemo(() => {
    if (filter === "all") return dreams;
    return dreams.filter((d) => d.state === filter);
  }, [dreams, filter]);

  const sorted = useMemo(
    () =>
      [...filtered].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [filtered],
  );

  function addDream() {
    const title = newTitle.trim();
    if (!title) return;
    const store = loadPlanDreamsStore();
    const dream = createPlanDream({
      title,
      firstThought: newThought.trim() || undefined,
    });
    savePlanDreamsStore(upsertPlanDream(store, dream));
    setNewTitle("");
    setNewThought("");
    setModalOpen(false);
    refresh();
  }

  const tabs: { id: FilterTab; label: string }[] = [
    { id: "all", label: "All" },
    ...DREAM_STATE_ORDER.map((s) => ({ id: s, label: DREAM_STATE_LABEL[s] })),
  ];

  return (
    <div className="mesh-hero min-h-[calc(100vh-3.5rem)] pb-28">
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
        <p className="text-sm font-medium uppercase tracking-widest text-accent">
          PLAN
        </p>
        <h1 className="mt-3 font-display text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          Dreams → reality
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted">
          Add a dream or goal, explore what&apos;s underneath it, then generate a
          visualisation meditation to make it feel real.
        </p>

        <div className="mt-8 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const active = filter === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilter(t.id)}
                className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "border-accent/40 bg-accent-soft/35 text-foreground shadow-sm"
                    : "border-border bg-card/80 text-muted hover:border-accent/25 hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {sorted.length === 0 ? (
          <p className="mt-14 max-w-md font-hand text-xl font-medium leading-snug text-accent sm:text-2xl">
            No dreams yet — what are you quietly hoping for?
          </p>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2">
            {sorted.map((d) => (
              <li key={d.id}>
                <Link
                  href={`/plan/goal/${encodeURIComponent(d.id)}`}
                  className="block rounded-2xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-accent/35 hover:bg-accent-soft/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-lg font-medium leading-snug text-foreground">
                      {d.title.trim() || "Untitled"}
                    </h2>
                    <span className="shrink-0 rounded-full border border-accent/25 bg-accent-soft/20 px-2.5 py-0.5 text-xs font-medium text-accent">
                      {DREAM_STATE_LABEL[d.state]}
                    </span>
                  </div>
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted">
                    {dreamExcerpt(d)}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span>Added {formatAdded(d.createdAt)}</span>
                    <span>
                      {d.meditationsGenerated}{" "}
                      {d.meditationsGenerated === 1
                        ? "meditation"
                        : "meditations"}{" "}
                      generated
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="fixed bottom-6 right-6 z-40 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-90 dark:text-deep"
        aria-haspopup="dialog"
      >
        Add a dream
      </button>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-4 backdrop-blur-[2px] sm:items-center"
          role="presentation"
          onClick={() => setModalOpen(false)}
        >
          <div
            role="dialog"
            aria-labelledby="plan-add-dream-title"
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="plan-add-dream-title"
              className="font-display text-xl font-medium text-foreground"
            >
              New dream
            </h2>
            <p className="mt-1 text-sm text-muted">
              Name it softly—you can shape the rest inside the workspace.
            </p>
            <label className="mt-5 block text-sm font-medium text-foreground">
              Title
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. A calmer mornings"
                className="mt-1.5 w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none ring-accent/30 focus:ring-2"
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-foreground">
              First thought{" "}
              <span className="font-normal text-muted">(optional)</span>
              <textarea
                value={newThought}
                onChange={(e) => setNewThought(e.target.value)}
                placeholder="A sentence or fragment—no need to polish."
                rows={4}
                className="mt-1.5 w-full resize-none rounded-xl border border-border bg-background px-3 py-2.5 text-sm leading-relaxed outline-none ring-accent/30 focus:ring-2"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:bg-accent-soft/30 hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newTitle.trim()}
                onClick={() => addDream()}
                className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:text-deep"
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
