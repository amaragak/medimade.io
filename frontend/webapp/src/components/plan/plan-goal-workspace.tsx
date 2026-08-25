"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlanDrvSection } from "@/components/plan/plan-drv-section";
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

const PROJECT_REFLECT_PREFIX =
  "You are a warm, non-judgmental thinking partner in a private journal (not a productivity app). The user wrote freely about a dream or hope. Reply in 2–6 short sentences: mirror emotional truth, notice one image or pattern, optionally one gentle question. No bullet lists unless they feel natural. No pep-talk clichés.\n\nTheir words:\n\n";

const PROJECT_OBSTACLE_PREFIX =
  "You are a gentle thinking partner. The user named what feels in the way—fear, logistics, old stories, fatigue. Respond in 2–6 sentences with validation, nuance, and one reframing or question—still journal-toned, not clinical.\n\nWhat they shared:\n\n";

const PROJECT_VISION_PREFIX =
  "You are helping them deepen a future moment. They drafted a specific embodied scene. Expand it in present tense: sensory detail (sight, sound, touch, breath), emotional tone, and a sense of time and place. Two short paragraphs max; intimate, not hypey.\n\nTheir draft:\n\n";

const PROJECT_DRV_COPY = {
  dreamTitle: "The dream",
  dreamHint: "Say it messy. No one is grading this.",
  dreamPlaceholder:
    "What are you quietly hoping for? What would it mean to you?",
  dreamButton: "Reflect",
  obstacleTitle: "What's in the way?",
  obstacleHint: "Resistance, fear, logistics—the real stuff.",
  obstaclePlaceholder: "Name it without fixing it yet.",
  obstacleButton: "Explore",
  visionTitle: "The vision",
  visionHint: "A single moment when this has already happened.",
  visionPlaceholder:
    "Describe a specific moment in the future where this has happened. What do you see, hear, feel?",
  visionButton: "Build my vision",
};

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
    load();
  }, [load]);

  useEffect(() => {
    const onStorage = () => load();
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [load]);

  const patch = useCallback((partial: Partial<PlanDream>) => {
    setDream((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...partial };
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
      q ? `/ideate/goal/${encodeURIComponent(dreamId)}?${q}` : `/ideate/goal/${encodeURIComponent(dreamId)}`,
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
    router.push("/meditate/create/from-chat?fromIdeate=1");
  }

  if (missing || !dream) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <p className="text-muted">
          {missing
            ? "This project isn’t here anymore—or the link is old."
            : "Loading…"}
        </p>
        <Link
          href="/ideate/my"
          className="mt-6 inline-block text-sm font-semibold text-accent-link underline-offset-2 hover:underline"
        >
          Back to Ideate
        </Link>
      </div>
    );
  }

  void storeTick;
  const stepCount = subtasksForProject(loadIdeateStore(), dream.id).length;

  return (
    <div className="min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-3xl px-4 pt-3 pb-10 sm:px-6 sm:py-14">
        <div className="border-b border-border/70 pb-6">
          <Link
            href="/ideate/my"
            className="text-xs font-semibold uppercase tracking-wide text-accent-link hover:underline"
          >
            ← Ideate
          </Link>
          <div className="mt-2 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
                {dream.title.trim() || "Untitled"}
              </h1>
              <p className="mt-2 text-sm text-muted">
                A quiet place to think—with a little help when you want it.
              </p>
            </div>
            <PlanProjectStageChip state={dream.state} onChange={setState} />
          </div>

          <nav
            className="mt-6 flex gap-6 border-b border-border/60"
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
                    <span className="ml-1 font-normal text-muted">· {item.count}</span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {tab === "reflect" ? (
          <PlanDrvSection
            copy={PROJECT_DRV_COPY}
            values={{
              dreamText: dream.dreamText,
              obstacleText: dream.obstacleText,
              visionText: dream.visionText,
              dreamReflectReply: dream.dreamReflectReply,
              obstacleExploreReply: dream.obstacleExploreReply,
              visionBuildReply: dream.visionBuildReply,
            }}
            onPatch={(p) => patch(p)}
            reflectPrefix={PROJECT_REFLECT_PREFIX}
            obstaclePrefix={PROJECT_OBSTACLE_PREFIX}
            visionPrefix={PROJECT_VISION_PREFIX}
            afterVision={
              <>
                {dream.visionBuildReply ? (
                  <button
                    type="button"
                    onClick={() => setTab("steps")}
                    className="mt-4 cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20"
                  >
                    Break this into steps
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!dream.visionText.trim()}
                  onClick={() => generateMeditation()}
                  className="mt-8 w-full cursor-pointer rounded-full accent-fill-gradient px-5 py-3.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Generate visualisation meditation
                </button>
                {!dream.visionText.trim() ? (
                  <p className="mt-2 text-center text-xs text-muted">
                    Add a few lines to your vision first.
                  </p>
                ) : null}
              </>
            }
          />
        ) : (
          <PlanSubtasksPanel
            project={dream}
            onRefresh={load}
            storeTick={storeTick}
            embedded
          />
        )}
      </div>
    </div>
  );
}
