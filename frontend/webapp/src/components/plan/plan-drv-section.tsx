"use client";

import { useState } from "react";
import { PlanClaudeCallout } from "@/components/plan/plan-claude-callout";
import { streamPlanCoachReply } from "@/lib/plan-claude";

export type DrvCopy = {
  dreamTitle: string;
  dreamHint: string;
  dreamPlaceholder: string;
  dreamButton: string;
  obstacleTitle: string;
  obstacleHint: string;
  obstaclePlaceholder: string;
  obstacleButton: string;
  visionTitle: string;
  visionHint: string;
  visionPlaceholder: string;
  visionButton: string;
};

export type DrvValues = {
  dreamText: string;
  obstacleText: string;
  visionText: string;
  dreamReflectReply: string;
  obstacleExploreReply: string;
  visionBuildReply: string;
};

type Props = {
  copy: DrvCopy;
  values: DrvValues;
  onPatch: (partial: Partial<DrvValues>) => void;
  reflectPrefix: string;
  obstaclePrefix: string;
  visionPrefix: string;
  afterVision?: React.ReactNode;
};

export function PlanDrvSection({
  copy,
  values,
  onPatch,
  reflectPrefix,
  obstaclePrefix,
  visionPrefix,
  afterVision,
}: Props) {
  const [reflectLoading, setReflectLoading] = useState(false);
  const [obstacleLoading, setObstacleLoading] = useState(false);
  const [visionLoading, setVisionLoading] = useState(false);
  const [reflectErr, setReflectErr] = useState<string | null>(null);
  const [obstacleErr, setObstacleErr] = useState<string | null>(null);
  const [visionErr, setVisionErr] = useState<string | null>(null);

  async function runReflect() {
    if (!values.dreamText.trim()) {
      setReflectErr("Write a few lines in the dream space first.");
      return;
    }
    setReflectErr(null);
    setReflectLoading(true);
    onPatch({ dreamReflectReply: "" });
    let acc = "";
    try {
      acc = await streamPlanCoachReply(
        [{ role: "user", content: `${reflectPrefix}${values.dreamText.trim()}` }],
        (d) => {
          acc += d;
          onPatch({ dreamReflectReply: acc });
        },
      );
      onPatch({ dreamReflectReply: acc });
    } catch (e) {
      setReflectErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setReflectLoading(false);
    }
  }

  async function runObstacle() {
    if (!values.obstacleText.trim()) {
      setObstacleErr("Share what feels stuck or heavy first.");
      return;
    }
    setObstacleErr(null);
    setObstacleLoading(true);
    onPatch({ obstacleExploreReply: "" });
    let acc = "";
    try {
      acc = await streamPlanCoachReply(
        [
          {
            role: "user",
            content: `${obstaclePrefix}${values.obstacleText.trim()}`,
          },
        ],
        (d) => {
          acc += d;
          onPatch({ obstacleExploreReply: acc });
        },
      );
      onPatch({ obstacleExploreReply: acc });
    } catch (e) {
      setObstacleErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setObstacleLoading(false);
    }
  }

  async function runVision() {
    if (!values.visionText.trim()) {
      setVisionErr("Add a few lines about that future moment first.");
      return;
    }
    setVisionErr(null);
    setVisionLoading(true);
    onPatch({ visionBuildReply: "" });
    let acc = "";
    try {
      acc = await streamPlanCoachReply(
        [{ role: "user", content: `${visionPrefix}${values.visionText.trim()}` }],
        (d) => {
          acc += d;
          onPatch({ visionBuildReply: acc });
        },
      );
      onPatch({ visionBuildReply: acc });
    } catch (e) {
      setVisionErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setVisionLoading(false);
    }
  }

  const secondaryBtn =
    "cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50";

  return (
    <>
      <section className="mt-8 border-t border-border/80 pt-8">
        <h2 className="font-display text-xl font-medium text-foreground">
          {copy.dreamTitle}
        </h2>
        <p className="mt-1 text-sm text-muted">{copy.dreamHint}</p>
        <textarea
          value={values.dreamText}
          onChange={(e) => onPatch({ dreamText: e.target.value })}
          rows={6}
          className="mt-4 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed text-foreground outline-none ring-accent/25 focus:ring-2"
          placeholder={copy.dreamPlaceholder}
        />
        <button
          type="button"
          disabled={reflectLoading}
          onClick={() => void runReflect()}
          className={`mt-3 ${secondaryBtn}`}
        >
          {reflectLoading ? "Reflecting…" : copy.dreamButton}
        </button>
        {reflectErr ? (
          <p className="mt-2 text-sm text-danger">
            {reflectErr}
          </p>
        ) : null}
        {values.dreamReflectReply || reflectLoading ? (
          <PlanClaudeCallout>
            {reflectLoading && !values.dreamReflectReply ? (
              <span className="text-muted">…</span>
            ) : (
              values.dreamReflectReply
            )}
          </PlanClaudeCallout>
        ) : null}
      </section>

      <section className="mt-10 border-t border-border/80 pt-8">
        <h2 className="font-display text-xl font-medium text-foreground">
          {copy.obstacleTitle}
        </h2>
        <p className="mt-1 text-sm text-muted">{copy.obstacleHint}</p>
        <textarea
          value={values.obstacleText}
          onChange={(e) => onPatch({ obstacleText: e.target.value })}
          rows={5}
          className="mt-4 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
          placeholder={copy.obstaclePlaceholder}
        />
        <button
          type="button"
          disabled={obstacleLoading}
          onClick={() => void runObstacle()}
          className={`mt-3 ${secondaryBtn}`}
        >
          {obstacleLoading ? "Exploring…" : copy.obstacleButton}
        </button>
        {obstacleErr ? (
          <p className="mt-2 text-sm text-danger">
            {obstacleErr}
          </p>
        ) : null}
        {values.obstacleExploreReply || obstacleLoading ? (
          <PlanClaudeCallout>
            {obstacleLoading && !values.obstacleExploreReply ? (
              <span className="text-muted">…</span>
            ) : (
              values.obstacleExploreReply
            )}
          </PlanClaudeCallout>
        ) : null}
      </section>

      <section className="mt-10 border-t border-border/80 pt-8">
        <h2 className="font-display text-xl font-medium text-foreground">
          {copy.visionTitle}
        </h2>
        <p className="mt-1 text-sm text-muted">{copy.visionHint}</p>
        <textarea
          value={values.visionText}
          onChange={(e) => onPatch({ visionText: e.target.value })}
          rows={5}
          className="mt-4 w-full resize-y rounded-2xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2"
          placeholder={copy.visionPlaceholder}
        />
        <button
          type="button"
          disabled={visionLoading}
          onClick={() => void runVision()}
          className={`mt-3 ${secondaryBtn}`}
        >
          {visionLoading ? "Building…" : copy.visionButton}
        </button>
        {visionErr ? (
          <p className="mt-2 text-sm text-danger">
            {visionErr}
          </p>
        ) : null}
        {values.visionBuildReply || visionLoading ? (
          <PlanClaudeCallout>
            {visionLoading && !values.visionBuildReply ? (
              <span className="text-muted">…</span>
            ) : (
              values.visionBuildReply
            )}
          </PlanClaudeCallout>
        ) : null}
        {afterVision}
      </section>
    </>
  );
}
