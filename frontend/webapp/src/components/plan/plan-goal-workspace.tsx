"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { PlanClaudeCallout } from "@/components/plan/plan-claude-callout";
import { streamPlanCoachReply } from "@/lib/plan-claude";
import {
  writePlanCreateHandoff,
  type PlanCreateHandoffV1,
} from "@/lib/plan-create-handoff";
import {
  DREAM_STATE_LABEL,
  DREAM_STATE_ORDER,
  loadPlanDreamsStore,
  savePlanDreamsStore,
  upsertPlanDream,
  type DreamState,
  type PlanDream,
} from "@/lib/plan-dreams";

const REFLECT_COACH_PREFIX =
  "You are a warm, non-judgmental thinking partner in a private journal (not a productivity app). The user wrote freely about a dream or hope. Reply in 2–6 short sentences: mirror emotional truth, notice one image or pattern, optionally one gentle question. No bullet lists unless they feel natural. No pep-talk clichés.\n\nTheir words:\n\n";

const OBSTACLE_COACH_PREFIX =
  "You are a gentle thinking partner. The user named what feels in the way—fear, logistics, old stories, fatigue. Respond in 2–6 sentences with validation, nuance, and one reframing or question—still journal-toned, not clinical.\n\nWhat they shared:\n\n";

const VISION_COACH_PREFIX =
  "You are helping them deepen a future moment. They drafted a specific embodied scene. Expand it in present tense: sensory detail (sight, sound, touch, breath), emotional tone, and a sense of time and place. Two short paragraphs max; intimate, not hypey.\n\nTheir draft:\n\n";

function persistDream(next: PlanDream) {
  const store = loadPlanDreamsStore();
  savePlanDreamsStore(upsertPlanDream(store, next));
}

type Props = { dreamId: string };

export function PlanGoalWorkspace({ dreamId }: Props) {
  const router = useRouter();
  const [dream, setDream] = useState<PlanDream | null>(null);
  const [missing, setMissing] = useState(false);
  const [reflectLoading, setReflectLoading] = useState(false);
  const [obstacleLoading, setObstacleLoading] = useState(false);
  const [visionLoading, setVisionLoading] = useState(false);
  const [reflectErr, setReflectErr] = useState<string | null>(null);
  const [obstacleErr, setObstacleErr] = useState<string | null>(null);
  const [visionErr, setVisionErr] = useState<string | null>(null);

  const load = useCallback(() => {
    const d = loadPlanDreamsStore().dreams.find((x) => x.id === dreamId);
    if (!d) {
      setMissing(true);
      setDream(null);
      return;
    }
    setMissing(false);
    setDream(d);
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

  async function runReflect() {
    if (!dream?.dreamText.trim()) {
      setReflectErr("Write a few lines in the dream space first.");
      return;
    }
    setReflectErr(null);
    setReflectLoading(true);
    patch({ dreamReflectReply: "" });
    let acc = "";
    try {
      acc = await streamPlanCoachReply(
        [
          {
            role: "user",
            content: `${REFLECT_COACH_PREFIX}${dream.dreamText.trim()}`,
          },
        ],
        (d) => {
          acc += d;
          patch({ dreamReflectReply: acc });
        },
      );
      patch({ dreamReflectReply: acc });
    } catch (e) {
      setReflectErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setReflectLoading(false);
    }
  }

  async function runObstacle() {
    if (!dream?.obstacleText.trim()) {
      setObstacleErr("Share what feels stuck or heavy first.");
      return;
    }
    setObstacleErr(null);
    setObstacleLoading(true);
    patch({ obstacleExploreReply: "" });
    let acc = "";
    try {
      acc = await streamPlanCoachReply(
        [
          {
            role: "user",
            content: `${OBSTACLE_COACH_PREFIX}${dream.obstacleText.trim()}`,
          },
        ],
        (d) => {
          acc += d;
          patch({ obstacleExploreReply: acc });
        },
      );
      patch({ obstacleExploreReply: acc });
    } catch (e) {
      setObstacleErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setObstacleLoading(false);
    }
  }

  async function runVision() {
    if (!dream?.visionText.trim()) {
      setVisionErr("Add a few lines about that future moment first.");
      return;
    }
    setVisionErr(null);
    setVisionLoading(true);
    patch({ visionBuildReply: "" });
    let acc = "";
    try {
      acc = await streamPlanCoachReply(
        [
          {
            role: "user",
            content: `${VISION_COACH_PREFIX}${dream.visionText.trim()}`,
          },
        ],
        (d) => {
          acc += d;
          patch({ visionBuildReply: acc });
        },
      );
      patch({ visionBuildReply: acc });
    } catch (e) {
      setVisionErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setVisionLoading(false);
    }
  }

  function generateMeditation() {
    if (!dream) return;
    const vision = dream.visionText.trim();
    if (!vision) return;
    const handoff: PlanCreateHandoffV1 = {
      v: 1,
      goalTitle: dream.title.trim() || "My dream",
      visionText: vision,
      dreamText: dream.dreamText.trim() || undefined,
      obstacleText: dream.obstacleText.trim() || undefined,
    };
    writePlanCreateHandoff(handoff);
    const nextCount = dream.meditationsGenerated + 1;
    patch({ meditationsGenerated: nextCount });
    router.push("/meditate/create?fromPlan=1");
  }

  if (missing || !dream) {
    return (
      <div className="mesh-hero mx-auto max-w-2xl px-4 py-20 sm:px-6">
        <p className="text-muted">
          {missing
            ? "This dream isn’t in your journal anymore—or the link is old."
            : "Loading…"}
        </p>
        <Link
          href="/plan"
          className="mt-6 inline-block text-sm font-semibold text-accent underline-offset-2 hover:underline"
        >
          Back to Plan
        </Link>
      </div>
    );
  }

  return (
    <div className="mesh-hero min-h-[calc(100vh-3.5rem)]">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-4 border-b border-border/70 pb-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link
              href="/plan"
              className="text-xs font-semibold uppercase tracking-wide text-accent hover:underline"
            >
              ← Plan
            </Link>
            <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-foreground sm:text-4xl">
              {dream.title.trim() || "Untitled"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              A quiet place to think—with a little help when you want it.
            </p>
          </div>
        </div>

        <div
          className="mt-6 flex gap-1 overflow-x-auto rounded-full border border-border bg-card/60 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
          aria-label="Dream state"
        >
          {DREAM_STATE_ORDER.map((id) => {
            const on = dream.state === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setState(id)}
                className={`shrink-0 rounded-full px-3 py-2 text-center text-xs font-medium whitespace-nowrap transition-colors sm:text-sm ${
                  on
                    ? "bg-accent text-white shadow-sm dark:text-deep"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {DREAM_STATE_LABEL[id]}
              </button>
            );
          })}
        </div>

        <section className="mt-14 border-t border-border/80 pt-12">
          <h2 className="font-display text-xl font-medium text-foreground">
            The dream
          </h2>
          <p className="mt-1 text-sm text-muted">
            Say it messy. No one is grading this.
          </p>
          <textarea
            value={dream.dreamText}
            onChange={(e) => patch({ dreamText: e.target.value })}
            rows={10}
            className="mt-4 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground outline-none ring-accent/25 focus:ring-2"
            placeholder="What are you quietly hoping for? What would it mean to you?"
          />
          <button
            type="button"
            disabled={reflectLoading}
            onClick={() => void runReflect()}
            className="mt-3 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
          >
            {reflectLoading ? "Reflecting…" : "Reflect with Claude"}
          </button>
          {reflectErr ? (
            <p className="mt-2 text-sm text-red-600/90 dark:text-red-400/90">
              {reflectErr}
            </p>
          ) : null}
          {dream.dreamReflectReply || reflectLoading ? (
            <PlanClaudeCallout>
              {reflectLoading && !dream.dreamReflectReply ? (
                <span className="text-muted">…</span>
              ) : (
                dream.dreamReflectReply
              )}
            </PlanClaudeCallout>
          ) : null}
        </section>

        <section className="mt-16 border-t border-border/80 pt-12">
          <h2 className="font-display text-xl font-medium text-foreground">
            What&apos;s in the way?
          </h2>
          <p className="mt-1 text-sm text-muted">
            Resistance, fear, logistics—the real stuff.
          </p>
          <textarea
            value={dream.obstacleText}
            onChange={(e) => patch({ obstacleText: e.target.value })}
            rows={8}
            className="mt-4 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
            placeholder="Name it without fixing it yet."
          />
          <button
            type="button"
            disabled={obstacleLoading}
            onClick={() => void runObstacle()}
            className="mt-3 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
          >
            {obstacleLoading ? "Exploring…" : "Explore with Claude"}
          </button>
          {obstacleErr ? (
            <p className="mt-2 text-sm text-red-600/90 dark:text-red-400/90">
              {obstacleErr}
            </p>
          ) : null}
          {dream.obstacleExploreReply || obstacleLoading ? (
            <PlanClaudeCallout>
              {obstacleLoading && !dream.obstacleExploreReply ? (
                <span className="text-muted">…</span>
              ) : (
                dream.obstacleExploreReply
              )}
            </PlanClaudeCallout>
          ) : null}
        </section>

        <section className="mt-16 border-t border-border/80 pt-12">
          <h2 className="font-display text-xl font-medium text-foreground">
            The vision
          </h2>
          <p className="mt-1 text-sm text-muted">
            A single moment when this has already happened.
          </p>
          <textarea
            value={dream.visionText}
            onChange={(e) => patch({ visionText: e.target.value })}
            rows={8}
            className="mt-4 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
            placeholder='Describe a specific moment in the future where this has happened. What do you see, hear, feel?'
          />
          <button
            type="button"
            disabled={visionLoading}
            onClick={() => void runVision()}
            className="mt-3 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
          >
            {visionLoading ? "Building…" : "Build my vision"}
          </button>
          {visionErr ? (
            <p className="mt-2 text-sm text-red-600/90 dark:text-red-400/90">
              {visionErr}
            </p>
          ) : null}
          {dream.visionBuildReply || visionLoading ? (
            <PlanClaudeCallout>
              {visionLoading && !dream.visionBuildReply ? (
                <span className="text-muted">…</span>
              ) : (
                dream.visionBuildReply
              )}
            </PlanClaudeCallout>
          ) : null}

          <button
            type="button"
            disabled={!dream.visionText.trim()}
            onClick={() => generateMeditation()}
            className="mt-8 w-full rounded-full bg-accent px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:text-deep"
          >
            Generate visualisation meditation
          </button>
          {!dream.visionText.trim() ? (
            <p className="mt-2 text-center text-xs text-muted">
              Add a few lines to your vision first.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
