/**
 * Life-area Insights — full-context signals + structured Claude synthesis.
 */

import { streamPlanCoachReply } from "@/lib/plan-claude";
import type {
  LifeAreaInsightSection,
  LifeAreaInsightSectionId,
  PlanDream,
  ThoughtKind,
  ThoughtSentiment,
} from "@/lib/plan-dreams";
import { thoughtKindLabel } from "@/lib/plan-dreams";
import {
  loadIdeateStore,
  RESISTANCE_CATEGORY_LABEL,
  subtasksForProject,
  todosForSubtask,
  type IdeateStoreV2,
  type ResistanceCategory,
} from "@/lib/plan-ideate-store";
import { activeResistanceThemesForProject } from "@/lib/plan-resistance-threads";

export type InsightSignal = {
  id: string;
  label: string;
  detail: string;
};

export type LifeAreaInsightSnapshot = {
  fingerprint: string;
  signals: InsightSignal[];
  /** Enough writing / structure to ask Claude for a synthesis. */
  canSynthesize: boolean;
  emptyHint: string;
};

export type ParsedLifeAreaInsight = {
  text: string;
  sections: LifeAreaInsightSection[];
};

const SECTION_META: {
  id: LifeAreaInsightSectionId;
  label: string;
  headings: string[];
}[] = [
  {
    id: "summary",
    label: "Summary",
    headings: ["summary", "the summary", "overview"],
  },
  {
    id: "working",
    label: "What's working",
    headings: ["what's working", "what is working", "working", "wins"],
  },
  {
    id: "not_working",
    label: "What's not",
    headings: [
      "what's not",
      "what's not working",
      "what is not working",
      "not working",
      "in the way",
      "blockers",
    ],
  },
  {
    id: "patterns",
    label: "Patterns",
    headings: ["patterns", "the pattern", "recurring patterns"],
  },
  {
    id: "next",
    label: "Try next",
    headings: [
      "try next",
      "next move",
      "one next move",
      "next",
      "suggested next step",
    ],
  },
];

function clip(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= n) return t;
  return `${t.slice(0, n - 1).trimEnd()}…`;
}

function entriesFingerprint(
  entries:
    | { id: string; text: string; sentiment?: ThoughtSentiment; kind?: string }[]
    | undefined,
): string {
  return (entries ?? [])
    .map((e) => `${e.id}:${e.text}:${e.sentiment ?? ""}:${e.kind ?? ""}`)
    .join("|");
}

function normHeading(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[#*_]+/g, "")
    .replace(/[:.]+$/g, "")
    .trim();
}

function sectionIdForHeading(heading: string): LifeAreaInsightSectionId | null {
  const n = normHeading(heading);
  for (const meta of SECTION_META) {
    if (meta.headings.some((h) => n === h || n.startsWith(h))) return meta.id;
  }
  return null;
}

/** Parse Claude markdown sections into structured insight parts. */
export function parseLifeAreaInsightMarkdown(raw: string): ParsedLifeAreaInsight {
  const text = raw.trim();
  if (!text) return { text: "", sections: [] };

  const lines = text.split(/\r?\n/);
  const buckets = new Map<LifeAreaInsightSectionId, string[]>();
  let current: LifeAreaInsightSectionId | null = null;
  const preamble: string[] = [];

  for (const line of lines) {
    const heading =
      /^\s{0,3}#{1,3}\s+(.+)$/.exec(line)?.[1] ??
      /^\s*(?:Summary|What's working|What is working|What's not(?: working)?|What is not working|Patterns|Try next|Next move|One next move)\s*:?\s*$/i.exec(
        line,
      )?.[0];
    if (heading) {
      const id = sectionIdForHeading(heading);
      if (id) {
        current = id;
        if (!buckets.has(id)) buckets.set(id, []);
        continue;
      }
    }
    if (current) {
      buckets.get(current)!.push(line);
    } else {
      preamble.push(line);
    }
  }

  const sections: LifeAreaInsightSection[] = [];
  for (const meta of SECTION_META) {
    const body = (buckets.get(meta.id) ?? []).join("\n").trim();
    if (!body) continue;
    sections.push({ id: meta.id, label: meta.label, body: clip(body, 2000) });
  }

  if (sections.length === 0) {
    return {
      text: clip(text, 8000),
      sections: [
        { id: "summary", label: "Summary", body: clip(text, 2000) },
      ],
    };
  }

  const summary =
    sections.find((s) => s.id === "summary")?.body ||
    preamble.join("\n").trim() ||
    sections[0]!.body;

  return {
    text: clip(summary, 8000),
    sections,
  };
}

export function buildLifeAreaInsightSnapshot(
  dream: PlanDream,
  store: IdeateStoreV2 = loadIdeateStore(),
): LifeAreaInsightSnapshot {
  const subtasks = subtasksForProject(store, dream.id);
  const todos = subtasks.flatMap((s) => todosForSubtask(store, s.id));
  const resistance = store.resistanceEntries.filter(
    (r) => r.projectId === dream.id,
  );
  const themes = activeResistanceThemesForProject(store, dream.id);

  const thoughts = [
    ...(dream.dreamEntries ?? []),
    ...(dream.obstacleEntries ?? []),
    ...(dream.visionEntries ?? []),
  ].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const sentimentCounts = new Map<ThoughtSentiment, number>();
  const kindCounts = new Map<ThoughtKind, number>();
  for (const t of thoughts) {
    if (t.sentiment) {
      sentimentCounts.set(t.sentiment, (sentimentCounts.get(t.sentiment) ?? 0) + 1);
    }
    if (t.kind) {
      kindCounts.set(t.kind, (kindCounts.get(t.kind) ?? 0) + 1);
    }
  }

  const openTodos = todos.filter((t) => !t.isChecked);
  const doneTodos = todos.filter((t) => t.isChecked);
  const openSubtasks = subtasks.filter((s) => s.status !== "done");
  const doneSubtasks = subtasks.filter((s) => s.status === "done");
  const stalled = openTodos.filter((t) => t.viewCount >= 3 || t.wasUnchecked);

  const byCat = new Map<ResistanceCategory, number>();
  for (const r of resistance) {
    if (!r.category) continue;
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + 1);
  }

  const signals: InsightSignal[] = [];

  signals.push({
    id: "state",
    label: "Stage",
    detail: dream.state.replace(/_/g, " "),
  });

  if (todos.length > 0) {
    signals.push({
      id: "tasks",
      label: "Steps",
      detail: `${doneTodos.length} of ${todos.length} done · ${openSubtasks.length} open task${openSubtasks.length === 1 ? "" : "s"}`,
    });
  } else if (subtasks.length > 0) {
    signals.push({
      id: "tasks",
      label: "Tasks",
      detail: `${doneSubtasks.length} of ${subtasks.length} complete`,
    });
  }

  if (stalled.length > 0) {
    signals.push({
      id: "stalled",
      label: "Sitting still",
      detail: stalled
        .slice(0, 2)
        .map((t) => clip(t.title, 48))
        .join(" · "),
    });
  }

  if (kindCounts.size > 0) {
    const parts = [...kindCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([id, n]) => `${thoughtKindLabel(id) ?? id} ${n}`);
    signals.push({
      id: "kinds",
      label: "Thought types",
      detail: parts.join(" · "),
    });
  }

  if (sentimentCounts.size > 0) {
    const parts = (["bad", "okay", "good", "great"] as ThoughtSentiment[])
      .filter((id) => (sentimentCounts.get(id) ?? 0) > 0)
      .map((id) => {
        const n = sentimentCounts.get(id)!;
        const label =
          id === "bad"
            ? "Bad"
            : id === "okay"
              ? "Okay"
              : id === "good"
                ? "Good"
                : "Great";
        return `${label} ${n}`;
      });
    signals.push({
      id: "sentiment",
      label: "Thought tone",
      detail: parts.join(" · "),
    });
  }

  if (themes.length > 0) {
    signals.push({
      id: "resistance",
      label: "In the way",
      detail: themes
        .slice(0, 3)
        .map((t) =>
          t.occurrences > 1 ? `${t.label} (×${t.occurrences})` : t.label,
        )
        .join(" · "),
    });
  } else if (byCat.size > 0) {
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      signals.push({
        id: "resistance",
        label: "In the way",
        detail: RESISTANCE_CATEGORY_LABEL[top[0]],
      });
    }
  }

  const winThoughts = thoughts.filter((t) => t.kind === "win").slice(0, 2);
  if (winThoughts.length) {
    signals.push({
      id: "wins",
      label: "Recent wins",
      detail: winThoughts.map((t) => clip(t.text, 60)).join(" · "),
    });
  }

  if ((dream.checkIns?.length ?? 0) > 0) {
    const c = dream.checkIns![0]!;
    signals.push({
      id: "checkin",
      label: "Last check-in",
      detail: clip(c.note, 120),
    });
  }

  if ((dream.meditationsGenerated ?? 0) > 0) {
    signals.push({
      id: "meds",
      label: "Meditations",
      detail: `${dream.meditationsGenerated} generated from this area`,
    });
  }

  const drvChars =
    dream.dreamText.trim().length +
    dream.obstacleText.trim().length +
    dream.visionText.trim().length;
  const canSynthesize =
    drvChars > 40 ||
    thoughts.length > 0 ||
    resistance.length > 0 ||
    openTodos.length > 0 ||
    subtasks.some((s) => s.dreamText.trim().length > 20);

  const fingerprint = [
    dream.title,
    dream.state,
    dream.dreamText,
    dream.obstacleText,
    dream.visionText,
    dream.looseNotes ?? "",
    String(dream.meditationsGenerated ?? 0),
    entriesFingerprint(dream.dreamEntries),
    entriesFingerprint(dream.obstacleEntries),
    entriesFingerprint(dream.visionEntries),
    (dream.checkIns ?? []).map((c) => `${c.id}:${c.note}`).join("|"),
    subtasks
      .map(
        (s) =>
          `${s.id}:${s.status}:${s.title}:${s.dreamText}:${s.resistanceText}:${s.visionText}`,
      )
      .join("|"),
    todos
      .map(
        (t) =>
          `${t.id}:${t.isChecked}:${t.title}:${t.viewCount}:${t.wasUnchecked}`,
      )
      .join("|"),
    resistance.map((r) => `${r.id}:${r.category}:${r.text}`).join("|"),
  ].join("\n---\n");

  return {
    fingerprint,
    signals,
    canSynthesize,
    emptyHint:
      "Write in Vision, add thoughts, or create a few tasks — then refresh for a full insight.",
  };
}

/** @deprecated Use buildLifeAreaInsightSnapshot().fingerprint */
export function insightsContentFingerprint(dream: PlanDream): string {
  return buildLifeAreaInsightSnapshot(dream).fingerprint;
}

function buildSynthesisPrompt(
  dream: PlanDream,
  store: IdeateStoreV2,
): string {
  const snap = buildLifeAreaInsightSnapshot(dream, store);
  const subtasks = subtasksForProject(store, dream.id);
  const todos = subtasks.flatMap((s) => todosForSubtask(store, s.id));
  const resistance = store.resistanceEntries
    .filter((r) => r.projectId === dream.id)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 16);
  const thoughts = [
    ...(dream.dreamEntries ?? []),
    ...(dream.obstacleEntries ?? []),
    ...(dream.visionEntries ?? []),
  ]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
    .slice(0, 24);

  const lines: string[] = [
    `Life area: "${dream.title}" (lifecycle state: ${dream.state}).`,
    `Meditations generated from this area: ${dream.meditationsGenerated ?? 0}.`,
    "",
    "=== Vision band ===",
    "Dream:",
    clip(dream.dreamText || "(empty)", 700),
    "",
    "What's in the way (vision-level):",
    clip(dream.obstacleText || "(empty)", 500),
    "",
    "Vision (concrete future moment):",
    clip(dream.visionText || "(empty)", 500),
  ];

  if (dream.looseNotes?.trim()) {
    lines.push("", "Loose notes:", clip(dream.looseNotes, 400));
  }

  if ((dream.checkIns?.length ?? 0) > 0) {
    lines.push("", "Recent check-ins:");
    for (const c of (dream.checkIns ?? []).slice(0, 5)) {
      lines.push(`- ${clip(c.note, 160)}`);
    }
  }

  if (thoughts.length) {
    lines.push("", "Thoughts log (newest first):");
    for (const t of thoughts) {
      const tone = t.sentiment ? ` mood=${t.sentiment}` : "";
      const kind = t.kind ? ` type=${t.kind}` : "";
      lines.push(`- ${clip(t.text, 200)}${kind}${tone}`);
    }
  }

  if (subtasks.length) {
    lines.push("", "Tasks & steps:");
    for (const s of subtasks.slice(0, 12)) {
      lines.push(`- [${s.status}] ${s.title}`);
      if (s.dreamText.trim()) {
        lines.push(`  context: ${clip(s.dreamText, 160)}`);
      }
      if (s.resistanceText.trim()) {
        lines.push(`  friction: ${clip(s.resistanceText, 120)}`);
      }
      const stTodos = todos.filter((t) => t.subtaskId === s.id);
      for (const t of stTodos.slice(0, 8)) {
        const stall =
          !t.isChecked && (t.viewCount >= 3 || t.wasUnchecked)
            ? " (stalled)"
            : "";
        lines.push(
          `  - ${t.isChecked ? "✓" : "○"} ${t.title}${stall}`,
        );
      }
    }
  }

  if (resistance.length) {
    lines.push("", "Named blockers (resistance entries):");
    for (const r of resistance) {
      const cat = r.category
        ? RESISTANCE_CATEGORY_LABEL[r.category]
        : "untyped";
      lines.push(`- (${cat} / ${r.level}) ${clip(r.text, 140)}`);
    }
  }

  if (snap.signals.length) {
    lines.push("", "At-a-glance signals (computed):");
    for (const s of snap.signals) {
      lines.push(`- ${s.label}: ${s.detail}`);
    }
  }

  lines.push(
    "",
    "Write a structured Insight using EXACTLY these markdown headings (include a heading even if brief; skip a section only if there is truly nothing to say):",
    "",
    "## Summary",
    "2–3 sentences: the through-line of this life area right now.",
    "",
    "## What's working",
    "Concrete wins, progress, useful habits, completed steps — grounded in the data.",
    "",
    "## What's not",
    "Friction, stalls, resistance themes, incomplete steps — name them plainly.",
    "",
    "## Patterns",
    "Recurring loops (e.g. prep instead of action, all-or-nothing, mood swings).",
    "",
    "## Try next",
    "One small, specific next move (not a list of five).",
    "",
    "Rules: warm and direct; no therapy jargon; no preamble before the first heading; do not invent facts not supported by the material above.",
  );

  return lines.join("\n");
}

export async function streamLifeAreaInsight(
  dream: PlanDream,
  onDelta: (chunk: string) => void,
  store: IdeateStoreV2 = loadIdeateStore(),
): Promise<ParsedLifeAreaInsight> {
  const snap = buildLifeAreaInsightSnapshot(dream, store);
  if (!snap.canSynthesize) {
    onDelta(snap.emptyHint);
    return {
      text: snap.emptyHint,
      sections: [
        { id: "summary", label: "Summary", body: snap.emptyHint },
      ],
    };
  }
  const raw = await streamPlanCoachReply(
    [{ role: "user", content: buildSynthesisPrompt(dream, store) }],
    onDelta,
  );
  return parseLifeAreaInsightMarkdown(raw.trim() || snap.emptyHint);
}
