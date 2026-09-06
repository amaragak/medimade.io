/**
 * Guest-only Ideate samples — local device only, never treated as account data.
 */

import { getMedimadeSessionJwt } from "@/lib/auth-session";
import {
  loadIdeateReflectionQuestionsStore,
  saveIdeateReflectionQuestionsStore,
  type IdeateReflectionQuestion,
} from "@/lib/ideate-reflection-questions";
import {
  loadIdeateVisionBoardStore,
  saveIdeateVisionBoardStore,
  type VisionBoardItem,
} from "@/lib/ideate-vision-board";
import type { PlanDream } from "@/lib/plan-dreams";
import type {
  IdeateStoreV2,
  IdeateSubtask,
  IdeateTodo,
} from "@/lib/plan-ideate-store";

/** Bump when demo copy changes so guests get a one-time reseed of missing demos. */
export const IDEATE_DEMO_SEED_FLAG_KEY = "mm_ideate_demo_seed_v1";

export const DEMO_IDEATE_DREAM_IDS = [
  "demo-ideate-mornings",
  "demo-ideate-project",
  "demo-ideate-body",
] as const;

function daysAgoIso(days: number, hour: number): string {
  const d = new Date();
  d.setHours(hour, 15, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function isDemoIdeateDream(d: PlanDream): boolean {
  return d.demo === true || DEMO_IDEATE_DREAM_IDS.includes(d.id as (typeof DEMO_IDEATE_DREAM_IDS)[number]);
}

export function isDemoOnlyIdeateStore(store: IdeateStoreV2): boolean {
  return (
    store.dreams.length > 0 && store.dreams.every((d) => isDemoIdeateDream(d))
  );
}

/** Drop seeded guest samples (and their nested rows). */
export function withoutDemoIdeateStore(store: IdeateStoreV2): IdeateStoreV2 {
  const dreams = store.dreams.filter((d) => !isDemoIdeateDream(d));
  const keepProject = new Set(dreams.map((d) => d.id));
  const subtasks = store.subtasks.filter((s) => keepProject.has(s.projectId));
  const keepSub = new Set(subtasks.map((s) => s.id));
  const todos = store.todos.filter((t) => keepSub.has(t.subtaskId));
  const resistanceEntries = store.resistanceEntries.filter((r) =>
    keepProject.has(r.projectId),
  );
  return { v: 2, dreams, subtasks, todos, resistanceEntries };
}

function markDemoSeedFlag(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(IDEATE_DEMO_SEED_FLAG_KEY, "1");
  } catch {
    /* */
  }
}

function dreamBase(
  partial: Omit<PlanDream, "meditationsGenerated" | "completedAt"> &
    Partial<Pick<PlanDream, "meditationsGenerated" | "completedAt">>,
): PlanDream {
  return {
    meditationsGenerated: 0,
    completedAt: null,
    ...partial,
    demo: true,
  };
}

export function buildDemoIdeateStore(): IdeateStoreV2 {
  const mornings = dreamBase({
    id: "demo-ideate-mornings",
    title: "Mornings",
    state: "exploring",
    createdAt: daysAgoIso(12, 8),
    updatedAt: daysAgoIso(1, 8),
    firstThought: "I want mornings that feel like mine again.",
    dreamText:
      "Quieter mornings — less about the hour, more about not checking my phone first. Ten minutes that belong to me before the day starts asking.",
    obstacleText:
      "Fear that if I protect the morning, I'll fall behind at work and someone will notice. I keep saying I'll start tomorrow — then scroll until the calm window is gone.",
    visionText:
      "Soft light on the floorboards. Phone still charging in the hallway. Shoulders down. Tea, three lines in a notebook before anyone needs me.",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [
      {
        id: "demo-rt-d1",
        createdAt: daysAgoIso(2, 18),
        text: "Still the same pull toward quieter mornings — less about the hour, more about not checking my phone first.",
        coachReply: "",
      },
      {
        id: "demo-rt-d2",
        createdAt: daysAgoIso(9, 10),
        text: "I want mornings that feel like mine again.",
        coachReply: "",
      },
    ],
    obstacleEntries: [
      {
        id: "demo-rt-r1",
        createdAt: daysAgoIso(4, 8),
        text: "Same fear of falling behind — it showed up again when I tried to leave my phone in another room.",
        coachReply: "",
      },
      {
        id: "demo-rt-r2",
        createdAt: daysAgoIso(7, 21),
        text: "Fear that if I protect the morning, I'll fall behind at work and someone will notice.",
        coachReply: "",
      },
      {
        id: "demo-rt-r3",
        createdAt: daysAgoIso(11, 9),
        text: "I keep saying I'll start tomorrow — then scroll until the calm window is gone.",
        coachReply: "",
      },
    ],
    visionEntries: [
      {
        id: "demo-rt-v1",
        createdAt: daysAgoIso(3, 7),
        text: "Soft light on the floorboards. Phone still charging in the hallway. My shoulders are down.",
        coachReply: "",
      },
      {
        id: "demo-rt-v2",
        createdAt: daysAgoIso(10, 11),
        text: "Kitchen table, tea, three lines in a notebook before anyone needs me.",
        coachReply: "",
      },
    ],
    looseNotes:
      "Not a productivity system — just reclaiming the first slice of the day.",
  });

  const project = dreamBase({
    id: "demo-ideate-project",
    title: "The project that waits",
    state: "germinating",
    createdAt: daysAgoIso(8, 20),
    updatedAt: daysAgoIso(3, 21),
    firstThought: "The thing I care about keeps sliding to tomorrow.",
    dreamText:
      "Open the work I actually care about without needing it to be finished or impressive. Fifteen honest minutes would be enough.",
    obstacleText:
      "It isn't laziness — it's fear of doing it imperfectly. So I tidy, answer mail, and call that progress.",
    visionText:
      "Laptop open to the real doc. One paragraph that feels true. No audience yet — just me, back in the room with the thing.",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [
      {
        id: "demo-rt-pd1",
        createdAt: daysAgoIso(3, 21),
        text: "The project I care about keeps sliding to “tomorrow.” When I look closer, it isn't laziness — it's fear of doing it imperfectly.",
        coachReply: "",
      },
    ],
    obstacleEntries: [
      {
        id: "demo-rt-pr1",
        createdAt: daysAgoIso(5, 19),
        text: "I polish the edges of everything else so I don't have to face the blank page.",
        coachReply: "",
      },
    ],
    visionEntries: [
      {
        id: "demo-rt-pv1",
        createdAt: daysAgoIso(6, 16),
        text: "Timer for fifteen minutes. Doc open. No finishing required.",
        coachReply: "",
      },
    ],
    looseNotes: "",
  });

  const body = dreamBase({
    id: "demo-ideate-body",
    title: "Moving again",
    state: "visualising",
    createdAt: daysAgoIso(14, 7),
    updatedAt: daysAgoIso(5, 7),
    firstThought: "A walk without headphones.",
    dreamText:
      "Treat my body as something I live in, not a project to optimise. Simple movement that feels like kindness, not a streak.",
    obstacleText:
      "All-or-nothing thinking — if I can't do a full workout, I do nothing. Weather, tiredness, and 'what's the point' pile on.",
    visionText:
      "Shoes by the door. A short loop around the block. Air on my face, no podcast — just noticing the street.",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [
      {
        id: "demo-rt-bd1",
        createdAt: daysAgoIso(5, 7),
        text: "A walk without headphones — that alone would feel like coming home to myself.",
        coachReply: "",
      },
    ],
    obstacleEntries: [
      {
        id: "demo-rt-br1",
        createdAt: daysAgoIso(8, 12),
        text: "If it isn't a 'proper' session, I skip it. Then days stack up.",
        coachReply: "",
      },
    ],
    visionEntries: [
      {
        id: "demo-rt-bv1",
        createdAt: daysAgoIso(6, 17),
        text: "Back home, cheeks warm, phone still in my pocket unopened.",
        coachReply: "",
      },
    ],
    looseNotes: "Small counts. Especially when I don't feel like it.",
  });

  const subPhone: IdeateSubtask = {
    id: "demo-sub-phone-hall",
    projectId: mornings.id,
    title: "Phone stays in the hallway overnight",
    dreamText: "",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(6, 9),
    updatedAt: daysAgoIso(1, 8),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subTea: IdeateSubtask = {
    id: "demo-sub-tea-window",
    projectId: mornings.id,
    title: "Ten minutes by the window with tea",
    dreamText: "",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(6, 9),
    updatedAt: daysAgoIso(6, 9),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subOpen: IdeateSubtask = {
    id: "demo-sub-open-doc",
    projectId: project.id,
    title: "Open the real doc for fifteen minutes",
    dreamText: "",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(4, 20),
    updatedAt: daysAgoIso(4, 20),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const todos: IdeateTodo[] = [
    {
      id: "demo-todo-charger",
      subtaskId: subPhone.id,
      title: "Plug the charger in before bed",
      isChecked: true,
      checkedAt: daysAgoIso(2, 22),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 3,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-alarm",
      subtaskId: subPhone.id,
      title: "Use a separate alarm — not the phone screen",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-kettle",
      subtaskId: subTea.id,
      title: "Put the kettle on before opening any apps",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-timer",
      subtaskId: subOpen.id,
      title: "Set a 15-minute timer and start a paragraph",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 2,
      wasUnchecked: false,
    },
  ];

  return {
    v: 2,
    dreams: [mornings, project, body],
    subtasks: [subPhone, subTea, subOpen],
    todos,
    resistanceEntries: [],
  };
}

function buildDemoVisionItems(): VisionBoardItem[] {
  return [
    { id: "demo-vb-1", color: "#C4A882", label: "Soft morning light" },
    { id: "demo-vb-2", color: "#8FA89A", label: "Tea by the window" },
    { id: "demo-vb-3", color: "#A8B5C4", label: "Phone in the hall" },
    { id: "demo-vb-4", color: "#D4A090", label: "A walk without headphones" },
    { id: "demo-vb-5", color: "#C9B896", label: "Open doc, fifteen minutes" },
  ];
}

function buildDemoReflectionQuestions(): IdeateReflectionQuestion[] {
  const now = daysAgoIso(2, 11);
  return [
    {
      id: "demo-rq-enough",
      text: "What would ‘enough’ look like here?",
      description: "Soften the finish line so you can move toward it.",
      answer:
        "Enough is ten quiet minutes and not opening mail first. Not a perfect morning — a claimed one.",
      source: "preset",
      presetId: "enough",
      createdAt: daysAgoIso(4, 10),
      updatedAt: now,
    },
    {
      id: "demo-rq-avoiding",
      text: "What are you avoiding thinking about?",
      description: "The uncomfortable edge often points the way.",
      answer: "",
      source: "preset",
      presetId: "avoiding",
      createdAt: daysAgoIso(3, 14),
      updatedAt: daysAgoIso(3, 14),
    },
  ];
}

function isDemoVisionItem(i: VisionBoardItem): boolean {
  return i.id.startsWith("demo-vb-");
}

function isDemoReflectionQuestion(q: IdeateReflectionQuestion): boolean {
  return q.id.startsWith("demo-rq-");
}

/**
 * Guests: always show seeded samples — never leftover personal / signed-in cache.
 * Signed-in: never seed; strip demos from the returned store (caller persists).
 */
export function ensureGuestDemoIdeateSeeded(
  existing: IdeateStoreV2,
): IdeateStoreV2 {
  if (typeof window !== "undefined" && getMedimadeSessionJwt()) {
    stripDemoCompanionStores();
    return withoutDemoIdeateStore(existing);
  }

  if (typeof window === "undefined") {
    return buildDemoIdeateStore();
  }

  // Personal rows while logged out are stale device cache — cloud owns real data.
  // Always overwrite with demos for guests (and persist so the wipe sticks).
  if (
    DEMO_IDEATE_DREAM_IDS.every((id) =>
      existing.dreams.some((d) => d.id === id),
    ) &&
    isDemoOnlyIdeateStore(existing)
  ) {
    markDemoSeedFlag();
    seedCompanionStoresIfEmpty();
    return existing;
  }

  const demo = buildDemoIdeateStore();
  try {
    window.localStorage.setItem(
      "mm_plan_dreams_v1",
      JSON.stringify({
        v: 2,
        dreams: demo.dreams,
        subtasks: demo.subtasks,
        todos: demo.todos,
        resistanceEntries: demo.resistanceEntries,
      }),
    );
  } catch {
    /* */
  }
  seedCompanionStoresIfEmpty(true);
  markDemoSeedFlag();
  return demo;
}

/** Reset device Ideate to guest demos (call on sign-out). Sync so UI sees demos immediately. */
export function resetIdeateLocalToGuestDemos(): void {
  if (typeof window === "undefined") return;
  const demo = buildDemoIdeateStore();
  try {
    window.localStorage.setItem(
      "mm_plan_dreams_v1",
      JSON.stringify({
        v: 2,
        dreams: demo.dreams,
        subtasks: demo.subtasks,
        todos: demo.todos,
        resistanceEntries: demo.resistanceEntries,
      }),
    );
  } catch {
    /* */
  }
  seedCompanionStoresIfEmpty(true);
  markDemoSeedFlag();
}

function stripDemoCompanionStores(): void {
  if (typeof window === "undefined") return;
  try {
    const board = loadIdeateVisionBoardStore();
    const nextItems = board.items.filter((i) => !isDemoVisionItem(i));
    if (nextItems.length !== board.items.length) {
      saveIdeateVisionBoardStore({ v: 1, items: nextItems });
    }
    const qs = loadIdeateReflectionQuestionsStore();
    const nextQs = qs.questions.filter((q) => !isDemoReflectionQuestion(q));
    if (nextQs.length !== qs.questions.length) {
      saveIdeateReflectionQuestionsStore({ v: 1, questions: nextQs });
    }
  } catch {
    /* */
  }
}

function seedCompanionStoresIfEmpty(force = false): void {
  if (typeof window === "undefined") return;
  try {
    const board = loadIdeateVisionBoardStore();
    if (force || board.items.length === 0) {
      saveIdeateVisionBoardStore({ v: 1, items: buildDemoVisionItems() });
    }
    const qs = loadIdeateReflectionQuestionsStore();
    if (force || qs.questions.length === 0) {
      saveIdeateReflectionQuestionsStore({
        v: 1,
        questions: buildDemoReflectionQuestions(),
      });
    }
  } catch {
    /* */
  }
}

/** Insight blurbs keyed by demo dream id — for the Insights panel. */
export const DEMO_IDEATE_INSIGHTS: Record<string, string[]> = {
  "demo-ideate-mornings": [
    "The dream keeps circling quieter mornings, while resistance names the phone-first habit — and the vision lands on stillness before the day begins.",
    "Across dream, resistance, and vision there's the same pull: reclaim the start of the day without fixing everything else first.",
    "What repeats isn't the goal itself — it's protecting a small morning window from the noise that rushes in.",
  ],
  "demo-ideate-project": [
    "Care and avoidance sit side by side — the project matters enough to scare you into busywork.",
    "Fifteen imperfect minutes keep showing up as the real invitation, not a finished masterpiece.",
  ],
  "demo-ideate-body": [
    "Kindness beats optimisation here — a short walk without headphones is already the vision.",
    "All-or-nothing thinking is the resistance; “small counts” is the way through.",
  ],
};
