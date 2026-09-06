"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlanLifeAreaReflectSections } from "@/components/plan/plan-life-area-reflect-sections";
import {
  formatLastTouched,
  PlanLooseNotesScratchpad,
  PlanSurfacedContextPanel,
} from "@/components/plan/plan-goal-reflect-stubs";
import { PlanInsightsPanel } from "@/components/plan/plan-insights-panel";
import { PlanProjectStageChip } from "@/components/plan/plan-project-stage-chip";
import { PlanSubtasksPanel } from "@/components/plan/plan-subtasks-panel";
import { activeResistanceThemesForProject } from "@/lib/plan-resistance-threads";
import {
  writePlanCreateHandoff,
  type PlanCreateHandoffV2,
} from "@/lib/plan-create-handoff";
import { type DreamState, type PlanDream } from "@/lib/plan-dreams";
import {
  loadIdeateStore,
  saveIdeateStore,
  subtasksForProject,
  upsertDream,
} from "@/lib/plan-ideate-store";
import { useIdeateCloud } from "@/components/plan/ideate-cloud-provider";

type ProjectTab = "reflect" | "steps";

function tabFromSearchParams(sp: URLSearchParams): ProjectTab {
  return sp.get("tab") === "steps" ? "steps" : "reflect";
}

function persistDream(next: PlanDream) {
  let store = loadIdeateStore();
  store = upsertDream(store, next);
  saveIdeateStore(store);
}

type Props = { dreamId: string };

export function PlanGoalWorkspace({ dreamId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = tabFromSearchParams(searchParams);
  const [dream, setDream] = useState<PlanDream | null>(null);
  const [missing, setMissing] = useState(false);
  const [storeTick, setStoreTick] = useState(0);
  const { ready: cloudReady, revision } = useIdeateCloud();

  const load = useCallback(() => {
    const d = loadIdeateStore().dreams.find((x) => x.id === dreamId);
    if (!d) {
      setMissing(true);
      setDream(null);
      return;
    }
    setMissing(false);
    setDream(d);
    setStoreTick((t) => t + 1);
  }, [dreamId]);

  useEffect(() => {
    if (!cloudReady) return;
    load();
  }, [load, cloudReady, revision]);

  useEffect(() => {
    const onStorage = () => load();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  const patch = useCallback((partial: Partial<PlanDream>) => {
    setDream((prev) => {
      if (!prev) return prev;
      const next = {
        ...prev,
        ...partial,
        updatedAt: new Date().toISOString(),
      };
      persistDream(next);
      return next;
    });
  }, []);

  function setTab(next: ProjectTab) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "steps") params.set("tab", "steps");
    else params.delete("tab");
    const q = params.toString();
    router.replace(
      q
        ? `/dream/goal/${encodeURIComponent(dreamId)}?${q}`
        : `/dream/goal/${encodeURIComponent(dreamId)}`,
      { scroll: false },
    );
  }

  function setState(next: DreamState) {
    if (!dream) return;
    if (next === "released") {
      const ok = window.confirm(
        "Releasing a goal is different from failing — it's a conscious choice. Continue?",
      );
      if (!ok) return;
    }
    patch({ state: next });
  }

  function generateMeditation() {
    if (!dream) return;
    const vision = dream.visionText.trim();
    if (!vision) return;
    const store = loadIdeateStore();
    const themes = activeResistanceThemesForProject(store, dream.id);
    const handoff: PlanCreateHandoffV2 = {
      v: 2,
      goalTitle: dream.title.trim() || "My project",
      visionText: vision,
      dreamText: dream.dreamText.trim() || undefined,
      obstacleText: dream.obstacleText.trim() || undefined,
      project: {
        dreamText: dream.dreamText.trim(),
        resistanceText: dream.obstacleText.trim(),
        visionText: vision,
      },
      activeResistanceThemes: themes.map((t) => ({
        category: t.category,
        sampleText: t.sampleText,
        level: t.level,
        occurrences: t.occurrences,
      })),
    };
    writePlanCreateHandoff(handoff);
    patch({ meditationsGenerated: dream.meditationsGenerated + 1 });
    router.push("/meditate/create/from-chat?fromDream=1");
  }

  if (!cloudReady || missing || !dream) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <p className="text-muted">
          {!cloudReady
            ? "Loading…"
            : missing
              ? "This project isn’t here anymore—or the link is old."
              : "Loading…"}
        </p>
        {cloudReady && missing ? (
          <Link
            href="/dream/my"
            className="mt-6 inline-block text-sm font-semibold text-accent-link underline-offset-2 hover:underline"
          >
            Back to My Dreams
          </Link>
        ) : null}
      </div>
    );
  }

  void storeTick;
  const stepCount = subtasksForProject(loadIdeateStore(), dream.id).length;
  const canGenerate = Boolean(dream.visionText.trim());

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-6xl px-4 pt-3 pb-10 sm:px-6 sm:py-14">
        <div className="pb-0">
          <Link
            href="/dream/my"
            className="text-xs font-semibold uppercase tracking-wide text-accent-link hover:underline"
          >
            ← My Dreams
          </Link>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-3xl font-medium tracking-tight text-[#1E2530] dark:text-foreground sm:text-4xl">
                {dream.title.trim() || "Untitled"}
              </h1>
              <p className="mt-2 text-sm text-muted">
                A quiet place to think—with a little help when you want it.
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <button
                type="button"
                disabled={!canGenerate}
                onClick={() => generateMeditation()}
                title={
                  canGenerate
                    ? undefined
                    : "Add a few lines to your vision first"
                }
                className="pro-header-cta cursor-pointer rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Generate meditation
              </button>
              <PlanProjectStageChip state={dream.state} onChange={setState} />
              <p className="text-xs text-muted">
                {formatLastTouched(dream.updatedAt, dream.createdAt)}
              </p>
            </div>
          </div>

          <nav
            className="mt-6 flex gap-6 border-b border-border/70"
            role="tablist"
            aria-label="Project views"
          >
            {(
              [
                { id: "reflect" as const, label: "Reflect" },
                { id: "steps" as const, label: "Steps", count: stepCount },
              ] as const
            ).map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(item.id)}
                  className={`-mb-px cursor-pointer border-b-2 pb-2.5 text-sm transition-colors ${
                    active
                      ? "border-selected font-semibold text-foreground"
                      : "border-transparent text-muted hover:border-border hover:text-foreground"
                  }`}
                >
                  {item.label}
                  {"count" in item && item.count > 0 ? (
                    <span className="ml-1 font-normal text-muted">
                      · {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
          <div className="min-w-0">
            {tab === "reflect" ? (
              <>
                <PlanLifeAreaReflectSections
                  dreamText={dream.dreamText}
                  obstacleText={dream.obstacleText}
                  visionText={dream.visionText}
                  dreamEntries={dream.dreamEntries ?? []}
                  obstacleEntries={dream.obstacleEntries ?? []}
                  visionEntries={dream.visionEntries ?? []}
                  showRecurringResistanceNote={
                    dream.id === "demo-ideate-mornings"
                  }
                  onPatch={(p) => patch(p)}
                />

                <PlanSurfacedContextPanel dream={dream} />

                <PlanLooseNotesScratchpad
                  value={dream.looseNotes ?? ""}
                  onChange={(looseNotes) => patch({ looseNotes })}
                />
              </>
            ) : (
              <PlanSubtasksPanel
                project={dream}
                onRefresh={load}
                storeTick={storeTick}
                embedded
              />
            )}
          </div>

          <div className="lg:sticky lg:top-20 lg:self-start">
            <PlanInsightsPanel key={dream.id} dream={dream} />
          </div>
        </div>
      </div>
    </div>
  );
}
