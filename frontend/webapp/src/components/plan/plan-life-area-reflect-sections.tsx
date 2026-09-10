"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DictationMicButton,
  appendSpokenText,
} from "@/components/dictation-mic-button";
import {
  newDreamId,
  THOUGHT_KIND_OPTIONS,
  THOUGHT_SENTIMENT_OPTIONS,
  thoughtKindLabel,
  thoughtSentimentLabel,
  type DrvTimelineEntry,
  type ThoughtKind,
  type ThoughtSentiment,
} from "@/lib/plan-dreams";

type SectionKind = "dream" | "resistance" | "vision";

const VISION_SECTIONS: Record<
  SectionKind,
  {
    eyebrow: string;
    placeholder: string;
    /** Marketing home alternating band colours. */
    bandClass: string;
  }
> = {
  dream: {
    eyebrow: "The dream",
    placeholder: "What does this look like when it’s working?",
    bandClass: "bg-marketing-band-d dark:bg-marketing-band-ideate",
  },
  resistance: {
    eyebrow: "What's in the way",
    placeholder: "The friction, fear, or habit that keeps showing up.",
    bandClass: "bg-marketing-band-c",
  },
  vision: {
    eyebrow: "The moment it's happened",
    placeholder:
      "A concrete scene — where you are, what you’re doing, how it feels.",
    bandClass: "bg-marketing-band-a",
  },
};

/** Full-width band; parent must already be viewport-wide (not inside max-w). */
const INNER = "mx-auto max-w-6xl px-4 sm:px-6";

function formatEntryDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

type UnifiedEntry = DrvTimelineEntry & {
  source: "dream" | "obstacle" | "vision";
};

function appendThought(
  entries: DrvTimelineEntry[],
  text: string,
  opts?: {
    sentiment?: ThoughtSentiment | null;
    kind?: ThoughtKind | null;
  },
): DrvTimelineEntry[] {
  return [
    ...entries,
    {
      id: newDreamId().replace(/^dream_/, "thought_"),
      text: text.trim(),
      createdAt: new Date().toISOString(),
      coachReply: "",
      ...(opts?.sentiment ? { sentiment: opts.sentiment } : {}),
      ...(opts?.kind ? { kind: opts.kind } : {}),
    },
  ];
}

/** Soft filled pills like Library type badges (`bg-accent-soft` + `text-accent-link`). */
const THOUGHT_KIND_CHIP: Record<
  ThoughtKind,
  { idle: string; selected: string }
> = {
  win: {
    idle: "bg-emerald-600/15 text-emerald-800/90 dark:bg-emerald-400/20 dark:text-emerald-200",
    selected:
      "bg-emerald-600/28 text-emerald-950 dark:bg-emerald-400/35 dark:text-emerald-50",
  },
  hard_blocker: {
    idle: "bg-rose-600/15 text-rose-800/90 dark:bg-rose-400/20 dark:text-rose-200",
    selected:
      "bg-rose-600/28 text-rose-950 dark:bg-rose-400/35 dark:text-rose-50",
  },
  resistance: {
    idle: "bg-amber-600/15 text-amber-900/85 dark:bg-amber-400/20 dark:text-amber-200",
    selected:
      "bg-amber-600/28 text-amber-950 dark:bg-amber-400/35 dark:text-amber-50",
  },
  insight: {
    idle: "bg-sky-600/15 text-sky-900/85 dark:bg-sky-400/20 dark:text-sky-200",
    selected: "bg-sky-600/28 text-sky-950 dark:bg-sky-400/35 dark:text-sky-50",
  },
  question: {
    idle: "bg-accent-soft/50 text-accent-link",
    selected: "bg-accent-soft/80 text-accent-link",
  },
  intention: {
    idle: "bg-teal-600/15 text-teal-900/85 dark:bg-teal-400/20 dark:text-teal-200",
    selected:
      "bg-teal-600/28 text-teal-950 dark:bg-teal-400/35 dark:text-teal-50",
  },
  progress: {
    idle: "bg-lime-700/15 text-lime-900/85 dark:bg-lime-400/20 dark:text-lime-200",
    selected:
      "bg-lime-700/28 text-lime-950 dark:bg-lime-400/35 dark:text-lime-50",
  },
};

const THOUGHT_SENTIMENT_CHIP: Record<
  ThoughtSentiment,
  { idle: string; selected: string }
> = {
  bad: {
    idle: "bg-rose-600/15 text-rose-800/90 dark:bg-rose-400/20 dark:text-rose-200",
    selected:
      "bg-rose-600/28 text-rose-950 dark:bg-rose-400/35 dark:text-rose-50",
  },
  okay: {
    idle: "bg-accent-soft/50 text-accent-link",
    selected: "bg-accent-soft/80 text-accent-link",
  },
  good: {
    idle: "bg-emerald-600/15 text-emerald-800/90 dark:bg-emerald-400/20 dark:text-emerald-200",
    selected:
      "bg-emerald-600/28 text-emerald-950 dark:bg-emerald-400/35 dark:text-emerald-50",
  },
  great: {
    idle: "bg-amber-600/15 text-amber-900/85 dark:bg-amber-400/20 dark:text-amber-200",
    selected:
      "bg-amber-600/28 text-amber-950 dark:bg-amber-400/35 dark:text-amber-50",
  },
};

const LIBRARY_CHIP =
  "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";

function ThoughtMetaChips({
  kind,
  sentiment,
}: {
  kind?: ThoughtKind | null;
  sentiment?: ThoughtSentiment | null;
}) {
  const typeLabel = thoughtKindLabel(kind);
  const feeling = thoughtSentimentLabel(sentiment);
  if (!typeLabel && !feeling) return null;
  return (
    <>
      {kind && typeLabel ? (
        <span className={`${LIBRARY_CHIP} ${THOUGHT_KIND_CHIP[kind].selected}`}>
          {typeLabel}
        </span>
      ) : null}
      {sentiment && feeling ? (
        <span
          className={`${LIBRARY_CHIP} ${THOUGHT_SENTIMENT_CHIP[sentiment].selected}`}
        >
          {feeling}
        </span>
      ) : null}
    </>
  );
}

function VisionBandSection({
  kind,
  mainAnswer,
  onMainChange,
}: {
  kind: SectionKind;
  mainAnswer: string;
  onMainChange: (text: string) => void;
}) {
  const meta = VISION_SECTIONS[kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(mainAnswer);
  const hasContent = Boolean(mainAnswer.trim());

  function startEdit() {
    setDraft(mainAnswer);
    setEditing(true);
  }

  function cancel() {
    setDraft(mainAnswer);
    setEditing(false);
  }

  function save() {
    onMainChange(draft);
    setEditing(false);
  }

  return (
    <section className={`w-full ${meta.bandClass}`}>
      <div className={`${INNER} py-10`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-marketing-muted sm:text-xs">
            {meta.eyebrow}
          </h2>
          {!editing ? (
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 cursor-pointer text-[12px] font-medium text-marketing-muted transition-opacity hover:opacity-80"
            >
              Edit
            </button>
          ) : null}
        </div>

        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.max(3, Math.min(12, draft.split("\n").length + 1))}
              autoFocus
              placeholder={meta.placeholder}
              className="mt-4 w-full resize-none rounded-none border-0 bg-transparent px-0 py-0 font-display text-[22px] italic leading-[1.55] text-marketing-ink outline-none focus:outline-none focus:ring-0 sm:text-[24px]"
            />
            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                onClick={save}
                className="cursor-pointer text-[12px] font-medium text-marketing-muted transition-opacity hover:opacity-80"
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancel}
                className="cursor-pointer text-[12px] font-medium text-marketing-muted transition-opacity hover:opacity-80"
              >
                Cancel
              </button>
            </div>
          </>
        ) : hasContent ? (
          <p className="mt-4 font-display text-[22px] italic leading-[1.55] text-marketing-ink whitespace-pre-wrap sm:text-[24px]">
            {mainAnswer}
          </p>
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="mt-4 w-full cursor-pointer text-left font-display text-[22px] italic leading-[1.55] text-marketing-ink opacity-35 sm:text-[24px]"
          >
            {meta.placeholder}
          </button>
        )}
      </div>
    </section>
  );
}

type VisionProps = {
  dreamText: string;
  obstacleText: string;
  visionText: string;
  onPatch: (partial: {
    dreamText?: string;
    obstacleText?: string;
    visionText?: string;
  }) => void;
};

export function PlanLifeAreaVisionSections({
  dreamText,
  obstacleText,
  visionText,
  onPatch,
}: VisionProps) {
  return (
    <div className="w-full">
      <VisionBandSection
        kind="dream"
        mainAnswer={dreamText}
        onMainChange={(dreamText) => onPatch({ dreamText })}
      />
      <VisionBandSection
        kind="resistance"
        mainAnswer={obstacleText}
        onMainChange={(obstacleText) => onPatch({ obstacleText })}
      />
      <VisionBandSection
        kind="vision"
        mainAnswer={visionText}
        onMainChange={(visionText) => onPatch({ visionText })}
      />
    </div>
  );
}

type ThoughtsProps = {
  dreamEntries: DrvTimelineEntry[];
  obstacleEntries: DrvTimelineEntry[];
  visionEntries: DrvTimelineEntry[];
  onPatch: (partial: {
    dreamEntries?: DrvTimelineEntry[];
    obstacleEntries?: DrvTimelineEntry[];
    visionEntries?: DrvTimelineEntry[];
  }) => void;
};

export function PlanLifeAreaThoughtsLog({
  dreamEntries,
  obstacleEntries,
  visionEntries,
  onPatch,
}: ThoughtsProps) {
  const [draft, setDraft] = useState("");
  const [sentiment, setSentiment] = useState<ThoughtSentiment | null>(null);
  const [kind, setKind] = useState<ThoughtKind | null>(null);
  const [filterKind, setFilterKind] = useState<ThoughtKind | "all">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const entries = useMemo(() => {
    const merged: UnifiedEntry[] = [
      ...dreamEntries.map((e) => ({ ...e, source: "dream" as const })),
      ...obstacleEntries.map((e) => ({ ...e, source: "obstacle" as const })),
      ...visionEntries.map((e) => ({ ...e, source: "vision" as const })),
    ];
    return merged.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [dreamEntries, obstacleEntries, visionEntries]);

  const visibleEntries = useMemo(() => {
    if (filterKind === "all") return entries;
    return entries.filter((e) => e.kind === filterKind);
  }, [entries, filterKind]);

  const kindsPresent = useMemo(() => {
    const set = new Set<ThoughtKind>();
    for (const e of entries) {
      if (e.kind) set.add(e.kind);
    }
    return set;
  }, [entries]);

  useEffect(() => {
    if (!composing) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [composing]);

  function cancelCompose() {
    setComposing(false);
    setDraft("");
    setSentiment(null);
    setKind(null);
  }

  function submit() {
    const t = draft.trim();
    if (!t) return;
    onPatch({
      dreamEntries: appendThought(dreamEntries, t, { sentiment, kind }),
    });
    cancelCompose();
  }

  function startCompose() {
    setFilterKind("all");
    setComposing(true);
  }

  const showListChrome = composing || visibleEntries.length > 0;

  return (
    <section className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Thoughts
        </h2>
        {!composing ? (
          <button
            type="button"
            onClick={() => startCompose()}
            className="cursor-pointer text-sm font-medium text-[#B8703A] transition-opacity hover:opacity-80"
          >
            + Add a thought
          </button>
        ) : (
          <button
            type="button"
            onClick={() => cancelCompose()}
            className="cursor-pointer text-sm text-muted transition-colors hover:text-foreground"
          >
            Cancel
          </button>
        )}
      </div>

      {entries.length > 0 ? (
        <div
          className="mt-4 flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by type"
        >
          <button
            type="button"
            onClick={() => setFilterKind("all")}
            aria-pressed={filterKind === "all"}
            className={`cursor-pointer rounded-full px-2.5 py-1 text-[12px] transition-colors ${
              filterKind === "all"
                ? "bg-accent-soft/50 font-medium text-foreground ring-1 ring-accent/35"
                : "bg-transparent text-muted ring-1 ring-border/80 hover:text-foreground"
            }`}
          >
            All
          </button>
          {THOUGHT_KIND_OPTIONS.map((opt) => {
            const selected = filterKind === opt.id;
            const hasAny = kindsPresent.has(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilterKind(opt.id)}
                aria-pressed={selected}
                disabled={!hasAny && !selected}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-[12px] transition-colors disabled:cursor-default disabled:opacity-35 ${
                  selected
                    ? "bg-accent-soft/50 font-medium text-foreground ring-1 ring-accent/35"
                    : "bg-transparent text-muted ring-1 ring-border/80 hover:text-foreground disabled:hover:text-muted"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {showListChrome ? (
        <ul className="mt-4">
          {composing ? (
            <li className="border-b border-border/80 first:border-t">
              <div className="flex items-start gap-4 py-3">
                <span className="w-20 shrink-0 pt-1.5 text-[12px] text-muted">
                  Today
                </span>
                <div className="min-w-0 flex-1">
                  <div className="relative">
                    <input
                      ref={inputRef}
                      id="life-area-thoughts-input"
                      type="text"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          submit();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelCompose();
                        }
                      }}
                      placeholder="Add a thought…"
                      className="w-full border-0 bg-transparent py-0.5 pr-10 text-[14px] leading-[1.5] text-[#1E2530] outline-none placeholder:text-[#A39C8C] focus:outline-none focus:ring-0 dark:text-foreground"
                    />
                    <div className="absolute right-0 top-1/2 -translate-y-1/2">
                      <DictationMicButton
                        variant="inset"
                        onTranscript={(spoken) => {
                          setDraft((prev) => appendSpokenText(prev, spoken));
                          inputRef.current?.focus();
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Thought type">
                    {THOUGHT_KIND_OPTIONS.map((opt) => {
                      const selected = kind === opt.id;
                      const tone = THOUGHT_KIND_CHIP[opt.id];
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() =>
                            setKind((cur) => (cur === opt.id ? null : opt.id))
                          }
                          aria-pressed={selected}
                          className={`cursor-pointer ${LIBRARY_CHIP} transition-colors ${
                            selected ? tone.selected : tone.idle
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <p className="shrink-0 text-[12px] text-muted">
                      How do you feel about this?
                    </p>
                    <div
                      className="flex flex-wrap gap-1.5"
                      role="group"
                      aria-label="Sentiment"
                    >
                      {THOUGHT_SENTIMENT_OPTIONS.map((opt) => {
                        const selected = sentiment === opt.id;
                        const tone = THOUGHT_SENTIMENT_CHIP[opt.id];
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() =>
                              setSentiment((cur) =>
                                cur === opt.id ? null : opt.id,
                              )
                            }
                            aria-pressed={selected}
                            className={`cursor-pointer ${LIBRARY_CHIP} transition-colors ${
                              selected ? tone.selected : tone.idle
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[12px] text-muted">
                      {kind && sentiment
                        ? "Enter to save"
                        : "Add a type and how you feel, then Enter"}
                    </span>
                    <button
                      type="button"
                      disabled={!draft.trim()}
                      onClick={() => submit()}
                      className="cursor-pointer text-[13px] font-medium text-[#B8703A] transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Save →
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ) : null}

          {visibleEntries.map((e) => {
            const open = expandedId === e.id;
            const firstLine = e.text.split("\n")[0] ?? e.text;
            return (
              <li
                key={`${e.source}-${e.id}`}
                className="border-b border-border/80 first:border-t"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(open ? null : e.id)}
                  className="flex w-full cursor-pointer items-start gap-4 py-3 text-left"
                >
                  <span className="w-20 shrink-0 text-[12px] text-muted">
                    {formatEntryDate(e.createdAt)}
                  </span>
                  <span className="min-w-0 flex-1">
                    {open ? (
                      <span className="text-[14px] leading-[1.5] text-[#1E2530] dark:text-foreground">
                        {e.text}
                        <span className="ml-2 inline-flex flex-wrap items-center gap-1.5 align-middle">
                          <ThoughtMetaChips
                            kind={e.kind}
                            sentiment={e.sentiment}
                          />
                        </span>
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 truncate text-[14px] leading-[1.5] text-[#1E2530] dark:text-foreground">
                          {firstLine}
                        </span>
                        <span className="inline-flex shrink-0 flex-wrap items-center gap-1.5">
                          <ThoughtMetaChips
                            kind={e.kind}
                            sentiment={e.sentiment}
                          />
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : entries.length > 0 ? (
        <p className="mt-4 text-sm italic text-muted">
          No thoughts tagged{" "}
          {thoughtKindLabel(filterKind === "all" ? null : filterKind) ??
            "this type"}
          .
        </p>
      ) : null}
    </section>
  );
}

/** @deprecated Prefer Vision + Thoughts exports. */
export function PlanLifeAreaReflectSections(
  props: VisionProps &
    ThoughtsProps & {
      showRecurringResistanceNote?: boolean;
    },
) {
  return (
    <>
      <PlanLifeAreaThoughtsLog {...props} />
      <PlanLifeAreaVisionSections {...props} />
    </>
  );
}
