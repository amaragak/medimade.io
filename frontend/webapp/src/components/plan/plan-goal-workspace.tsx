"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  PlanLifeAreaThoughtsLog,
  PlanLifeAreaVisionSections,
} from "@/components/plan/plan-life-area-reflect-sections";
import { PlanLifeAreaWhiteboard } from "@/components/plan/plan-life-area-whiteboard";
import { PlanLifeAreaMeditationsPanel } from "@/components/plan/plan-life-area-meditations-panel";
import {
  PlanLifeAreaHeaderSummary,
  PlanReflectSidebarJournal,
  PlanReflectSidebarMeditations,
} from "@/components/plan/plan-goal-reflect-stubs";
import { PlanInsightsPanel } from "@/components/plan/plan-insights-panel";
import { PlanSubtasksPanel } from "@/components/plan/plan-subtasks-panel";
import { activeResistanceThemesForProject } from "@/lib/plan-resistance-threads";
import {
  writePlanCreateHandoff,
  type PlanCreateHandoffV2,
} from "@/lib/plan-create-handoff";
import { type PlanDream } from "@/lib/plan-dreams";
import {
  loadIdeateStore,
  saveIdeateStore,
  subtasksForProject,
  upsertDream,
} from "@/lib/plan-ideate-store";
import { useIdeateCloud } from "@/components/plan/ideate-cloud-provider";
import { isMedimadeSessionActive } from "@/lib/auth-session";

type ProjectTab =
  | "vision"
  | "thoughts"
  | "insights"
  | "whiteboard"
  | "steps"
  | "meditations";

function tabFromSearchParams(sp: URLSearchParams): ProjectTab {
  const t = sp.get("tab");
  if (t === "steps") return "steps";
  if (t === "thoughts") return "thoughts";
  if (t === "insights") return "insights";
  if (t === "whiteboard") return "whiteboard";
  if (t === "meditations") return "meditations";
  // Legacy Reflect URL → Vision
  if (t === "reflect") return "vision";
  return "vision";
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
  const urlTab = tabFromSearchParams(searchParams);
  const [tab, setTabLocal] = useState<ProjectTab>(urlTab);
  const [dream, setDream] = useState<PlanDream | null>(null);
  const [missing, setMissing] = useState(false);
  const [storeTick, setStoreTick] = useState(0);
  const { ready: cloudReady, revision } = useIdeateCloud();

  useEffect(() => {
    setTabLocal(urlTab);
  }, [urlTab]);

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
    // Guests can load from local demos immediately; signed-in waits for cloud ready
    // so we don't flash empty before pull.
    if (isMedimadeSessionActive() && !cloudReady) return;
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
    setTabLocal(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "vision") params.delete("tab");
    else params.set("tab", next);
    const q = params.toString();
    // Stay on /ideate/goal — /dream/goal redirects and remounts the whole page.
    router.replace(
      q
        ? `/ideate/goal/${encodeURIComponent(dreamId)}?${q}`
        : `/ideate/goal/${encodeURIComponent(dreamId)}`,
      { scroll: false },
    );
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
      lifeAreaId: dream.id,
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

  if ((isMedimadeSessionActive() && !cloudReady) || missing || !dream) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <p className="text-muted">
          {isMedimadeSessionActive() && !cloudReady
            ? "Loading…"
            : missing
              ? "This project isn’t here anymore—or the link is old."
              : "Loading…"}
        </p>
        {missing ? (
          <Link
            href="/ideate/my"
            className="mt-6 inline-block text-sm font-semibold text-accent-link underline-offset-2 hover:underline"
          >
            Back to Ideate
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
      <div className="mx-auto max-w-6xl px-4 pt-2 sm:px-6 sm:pt-3">
        <div className="@container flex items-end justify-between gap-4 border-b border-border/70">
          <nav
            className="flex min-w-0 flex-wrap gap-x-6 gap-y-1"
            role="tablist"
            aria-label="Project views"
          >
            {(
              [
                { id: "vision" as const, label: "Vision" },
                { id: "steps" as const, label: "Tasks", count: stepCount },
                { id: "thoughts" as const, label: "Thoughts" },
                { id: "insights" as const, label: "Insights" },
                { id: "meditations" as const, label: "Meditations" },
                { id: "whiteboard" as const, label: "Whiteboard" },
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
          <button
            type="button"
            disabled={!canGenerate}
            onClick={() => generateMeditation()}
            title={
              canGenerate
                ? undefined
                : "Add a few lines to your vision first"
            }
            className="pro-header-cta mb-1.5 shrink-0 cursor-pointer rounded-xl px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Generate meditation
          </button>
        </div>
        {tab !== "vision" ? (
          <div className="mt-3">
            <PlanLifeAreaHeaderSummary dream={dream} />
          </div>
        ) : null}
      </div>

      {tab === "vision" ? (
        /* Truly full-bleed: outside max-w container */
        <div className="mt-4 w-full pb-10">
          <PlanLifeAreaVisionSections
            dreamText={dream.dreamText}
            obstacleText={dream.obstacleText}
            visionText={dream.visionText}
            onPatch={(p) => patch(p)}
          />
          <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
            <PlanLifeAreaHeaderSummary dream={dream} />
          </div>
        </div>
      ) : tab === "steps" ? (
        <div className="mt-4 w-full pb-10">
          <PlanSubtasksPanel
            project={dream}
            onRefresh={load}
            storeTick={storeTick}
            embedded
          />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 pb-10 sm:px-6 sm:pb-14">
          {tab === "thoughts" ? (
            <PlanLifeAreaThoughtsLog
              dreamEntries={dream.dreamEntries ?? []}
              obstacleEntries={dream.obstacleEntries ?? []}
              visionEntries={dream.visionEntries ?? []}
              onPatch={(p) => patch(p)}
            />
          ) : tab === "insights" ? (
            <div className="mt-4 space-y-6">
              <div className="max-w-2xl">
                <PlanInsightsPanel
                  key={dream.id}
                  dream={dream}
                  storeTick={storeTick}
                  variant="page"
                  onPatch={(p) => patch(p)}
                />
              </div>
              <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
                <PlanReflectSidebarJournal dream={dream} />
                <PlanReflectSidebarMeditations dream={dream} />
              </div>
            </div>
          ) : tab === "meditations" ? (
            <PlanLifeAreaMeditationsPanel lifeAreaId={dream.id} />
          ) : (
            <PlanLifeAreaWhiteboard dreamId={dream.id} />
          )}
        </div>
      )}
    </div>
  );
}
