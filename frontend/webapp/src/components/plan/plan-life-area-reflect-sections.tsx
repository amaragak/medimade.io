"use client";

/**
 * Life-area Reflect sections — one editable main answer per DRV section,
 * plus an independent append-only running-thoughts log.
 */

import { useState, type ReactNode } from "react";
import {
  IconEye,
  IconSparkles,
  IconWind,
  type TablerIcon,
} from "@tabler/icons-react";
import type { DrvTimelineEntry } from "@/lib/plan-dreams";
import { newDreamId } from "@/lib/plan-dreams";

type SectionKind = "dream" | "resistance" | "vision";

const SECTION_META: Record<
  SectionKind,
  {
    title: string;
    hint: string;
    placeholder: string;
    Icon: TablerIcon;
    iconColor: string;
    iconBg: string;
  }
> = {
  dream: {
    title: "The dream",
    hint: "Say it messy. No one is grading this.",
    placeholder: "What are you quietly hoping for? What would it mean to you?",
    Icon: IconSparkles,
    iconColor: "#B8703A",
    iconBg: "rgb(184 112 58 / 0.15)",
  },
  resistance: {
    title: "What's in the way?",
    hint: "Resistance, fear, logistics—the real stuff.",
    placeholder: "Name it without fixing it yet.",
    Icon: IconWind,
    iconColor: "#A65252",
    iconBg: "rgb(166 82 82 / 0.15)",
  },
  vision: {
    title: "The vision",
    hint: "A single moment when this has already happened.",
    placeholder:
      "Describe a specific moment in the future where this has happened. What do you see, hear, feel?",
    Icon: IconEye,
    iconColor: "#5A7A5E",
    iconBg: "rgb(90 122 94 / 0.15)",
  },
};

/**
 * PROTOTYPE MOCK — sample running thoughts when a section has none yet.
 * Remove once real thoughts are enough to evaluate the list UI.
 */
const MOCK_THOUGHTS: Record<SectionKind, DrvTimelineEntry[]> = {
  dream: [
    {
      id: "mock_rt_d1",
      createdAt: "2026-07-03T18:20:00.000Z",
      text: "Still the same pull toward quieter mornings — less about the hour, more about not checking my phone first.",
      coachReply: "",
    },
    {
      id: "mock_rt_d2",
      createdAt: "2026-06-12T10:00:00.000Z",
      text: "I want mornings that feel like mine again.",
      coachReply: "",
    },
  ],
  resistance: [
    {
      id: "mock_rt_r1",
      createdAt: "2026-08-10T08:40:00.000Z",
      text: "Same fear of falling behind — it showed up again when I tried to leave my phone in another room.",
      coachReply: "",
    },
    {
      id: "mock_rt_r2",
      createdAt: "2026-07-21T21:10:00.000Z",
      text: "Fear that if I protect the morning, I'll fall behind at work and someone will notice.",
      coachReply: "",
    },
    {
      id: "mock_rt_r3",
      createdAt: "2026-06-18T09:00:00.000Z",
      text: "I keep saying I'll start tomorrow — then scroll until the calm window is gone.",
      coachReply: "",
    },
  ],
  vision: [
    {
      id: "mock_rt_v1",
      createdAt: "2026-08-05T07:30:00.000Z",
      text: "Soft light on the floorboards. Phone still charging in the hallway. My shoulders are down.",
      coachReply: "",
    },
    {
      id: "mock_rt_v2",
      createdAt: "2026-07-01T11:00:00.000Z",
      text: "Kitchen table, tea, three lines in a notebook before anyone needs me.",
      coachReply: "",
    },
  ],
};

function formatEntryDate(iso: string): string {
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

function firstLine(text: string): string {
  const line = text.trim().split(/\n/)[0]?.trim() ?? "";
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}

function RunningThoughtsList({
  entries,
  onAdd,
}: {
  entries: DrvTimelineEntry[];
  onAdd: (text: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const sorted = [...entries].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  function submit() {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
    setAdding(false);
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        Running thoughts
      </p>
      {sorted.length > 0 ? (
        <ul className="mt-2 divide-y divide-border/60 border-y border-border/60">
          {sorted.map((e) => {
            const open = openId === e.id;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : e.id)}
                  className="flex w-full cursor-pointer items-baseline gap-3 py-2.5 text-left transition-opacity hover:opacity-80"
                >
                  <span className="w-24 shrink-0 text-xs text-muted">
                    {formatEntryDate(e.createdAt)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-foreground">
                    {open ? (
                      <span className="block whitespace-pre-wrap leading-relaxed">
                        {e.text}
                      </span>
                    ) : (
                      <span className="line-clamp-1">{firstLine(e.text)}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted" aria-hidden>
                    {open ? "−" : "+"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm italic text-[#A39C8C]">No thoughts yet.</p>
      )}

      {adding ? (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            autoFocus
            placeholder="A short note…"
            className="w-full resize-none rounded-xl border border-[#E5DFD0] bg-card px-3 py-2 text-sm leading-relaxed outline-none ring-accent/25 focus:ring-2 dark:border-border"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraft("");
              }}
              className="cursor-pointer rounded-full px-3 py-1 text-xs font-medium text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => submit()}
              className="cursor-pointer rounded-full bg-[#D9A24F] px-3 py-1 text-xs font-semibold text-[#1E2530] disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 cursor-pointer text-sm font-medium text-[#B8703A] transition-opacity hover:opacity-80"
        >
          + Add a thought
        </button>
      )}
    </div>
  );
}

function LifeAreaSection({
  kind,
  mainAnswer,
  thoughts,
  onMainChange,
  onAddThought,
  afterThoughts,
  showTopRule = true,
}: {
  kind: SectionKind;
  mainAnswer: string;
  thoughts: DrvTimelineEntry[];
  onMainChange: (text: string) => void;
  onAddThought: (text: string) => void;
  afterThoughts?: ReactNode;
  showTopRule?: boolean;
}) {
  const meta = SECTION_META[kind];
  const { Icon } = meta;
  const displayThoughts =
    thoughts.length > 0 ? thoughts : MOCK_THOUGHTS[kind];

  return (
    <section
      className={
        showTopRule
          ? "mt-10 border-t border-border/80 pt-8"
          : "mt-8 pt-2"
      }
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: meta.iconBg, color: meta.iconColor }}
        >
          <Icon size={15} stroke={1.75} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-xl font-medium text-[#1E2530] dark:text-foreground">
            {meta.title}
          </h2>
          <p className="mt-1 text-sm text-muted">{meta.hint}</p>
        </div>
      </div>

      <textarea
        value={mainAnswer}
        onChange={(e) => onMainChange(e.target.value)}
        rows={Math.max(3, Math.min(10, mainAnswer.split("\n").length + 1))}
        placeholder={meta.placeholder}
        className="mt-4 w-full resize-y rounded-[12px] border border-[#E5DFD0] bg-card px-5 py-[18px] text-sm leading-relaxed text-[#1E2530] outline-none ring-accent/25 focus:ring-2 dark:border-border dark:text-foreground"
      />

      <RunningThoughtsList
        entries={displayThoughts}
        onAdd={onAddThought}
      />

      {afterThoughts}
    </section>
  );
}

type Props = {
  dreamText: string;
  obstacleText: string;
  visionText: string;
  dreamEntries: DrvTimelineEntry[];
  obstacleEntries: DrvTimelineEntry[];
  visionEntries: DrvTimelineEntry[];
  onPatch: (partial: {
    dreamText?: string;
    obstacleText?: string;
    visionText?: string;
    dreamEntries?: DrvTimelineEntry[];
    obstacleEntries?: DrvTimelineEntry[];
    visionEntries?: DrvTimelineEntry[];
  }) => void;
};

function appendThought(
  entries: DrvTimelineEntry[],
  text: string,
): DrvTimelineEntry[] {
  return [
    ...entries,
    {
      id: newDreamId().replace(/^dream_/, "thought_"),
      text: text.trim(),
      createdAt: new Date().toISOString(),
      coachReply: "",
    },
  ];
}

export function PlanLifeAreaReflectSections({
  dreamText,
  obstacleText,
  visionText,
  dreamEntries,
  obstacleEntries,
  visionEntries,
  onPatch,
}: Props) {
  return (
    <>
      <LifeAreaSection
        kind="dream"
        showTopRule={false}
        mainAnswer={dreamText}
        thoughts={dreamEntries}
        onMainChange={(dreamText) => onPatch({ dreamText })}
        onAddThought={(text) =>
          onPatch({ dreamEntries: appendThought(dreamEntries, text) })
        }
      />

      <LifeAreaSection
        kind="resistance"
        mainAnswer={obstacleText}
        thoughts={obstacleEntries}
        onMainChange={(obstacleText) => onPatch({ obstacleText })}
        onAddThought={(text) =>
          onPatch({ obstacleEntries: appendThought(obstacleEntries, text) })
        }
        afterThoughts={
          /**
           * PROTOTYPE MOCK — recurring resistance callout.
           * Real pattern-detection across thoughts is not wired yet.
           */
          <div className="mt-5 rounded-[10px] bg-[#FBF6EA] px-4 py-3 text-sm leading-relaxed text-[#1E2530] dark:bg-accent-soft/25 dark:text-foreground">
            This has come up before —{" "}
            <span className="font-medium text-[#B8703A]">
              fear of falling behind
            </span>
            , noted 3 times.
          </div>
        }
      />

      <LifeAreaSection
        kind="vision"
        mainAnswer={visionText}
        thoughts={visionEntries}
        onMainChange={(visionText) => onPatch({ visionText })}
        onAddThought={(text) =>
          onPatch({ visionEntries: appendThought(visionEntries, text) })
        }
      />
    </>
  );
}
