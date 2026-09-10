/**
 * Guest-only Ideate samples — local device only, never treated as account data.
 */

import { isMedimadeSessionActive } from "@/lib/auth-session";
import {
  loadIdeateReflectionQuestionsStore,
  saveIdeateReflectionQuestionsStore,
  saveIdeateReflectionQuestionsStoreLocal,
  type IdeateReflectionQuestion,
} from "@/lib/ideate-reflection-questions";
import {
  loadIdeateValuesStore,
  saveIdeateValuesStore,
  saveIdeateValuesStoreLocal,
  type IdeateValue,
  type IdeateValuesStoreV1,
} from "@/lib/ideate-values";
import {
  loadIdeateRegretsStore,
  saveIdeateRegretsStoreLocal,
  type IdeateRegret,
} from "@/lib/ideate-regrets";
import {
  loadIdeateQuotesStore,
  saveIdeateQuotesStoreLocal,
  type IdeateQuote,
} from "@/lib/ideate-quotes";
import {
  loadIdeateVisionBoardStore,
  saveIdeateVisionBoardStore,
  saveIdeateVisionBoardStoreLocal,
  type IdeateVisionBoardStoreV1,
  type VisionBoardItem,
  type VisionSelfReference,
} from "@/lib/ideate-vision-board";
import type { PlanDream } from "@/lib/plan-dreams";
import type {
  IdeateStoreV2,
  IdeateSubtask,
  IdeateTodo,
} from "@/lib/plan-ideate-store";

/** Bump when demo copy changes so guests get a one-time reseed of missing demos. */
export const IDEATE_DEMO_SEED_FLAG_KEY = "mm_ideate_demo_seed_v7";
/** Stored under IDEATE_DEMO_SEED_FLAG_KEY — bump with companion content changes. */
const DEMO_SEED_VERSION = "7";

/** Cache-bust when demo image binaries change under the same filenames. */
const DEMO_VISION_BASE = "/demo/vision-board";
const DEMO_VISION_CACHE = "v6";
const demoVisionUrl = (file: string) =>
  `${DEMO_VISION_BASE}/${file}?${DEMO_VISION_CACHE}`;

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
    window.localStorage.setItem(IDEATE_DEMO_SEED_FLAG_KEY, DEMO_SEED_VERSION);
  } catch {
    /* */
  }
}

function isCompanionSeedStale(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return (
      window.localStorage.getItem(IDEATE_DEMO_SEED_FLAG_KEY) !== DEMO_SEED_VERSION
    );
  } catch {
    return true;
  }
}

function dreamBase(
  partial: Omit<
    PlanDream,
    "meditationsGenerated" | "completedAt" | "checkIns" | "cardColor" | "insights"
  > &
    Partial<
      Pick<
        PlanDream,
        "meditationsGenerated" | "completedAt" | "checkIns" | "cardColor" | "insights"
      >
    >,
): PlanDream {
  return {
    meditationsGenerated: 0,
    completedAt: null,
    checkIns: [],
    insights: [],
    cardColor: null,
    ...partial,
    demo: true,
  };
}

export function buildDemoIdeateStore(): IdeateStoreV2 {
  // Keep stable demo IDs; titles/copy are the guest-facing life areas.
  const jobSearch = dreamBase({
    id: "demo-ideate-mornings",
    title: "Job search",
    state: "exploring",
    createdAt: daysAgoIso(12, 8),
    updatedAt: daysAgoIso(1, 8),
    firstThought: "I want a role that pays the bills without eating my evenings.",
    dreamText:
      "Land a product manager job at a mid-size company — remote-friendly, clear scope, salary in the range I've already written down. Not “something better someday” — a real offer this quarter.",
    obstacleText:
      "I polish the CV endlessly and then freeze before applying. LinkedIn scrolling feels like progress. I'm scared of another rejection after last spring.",
    visionText:
      "Thursday 4pm. Offer email from the hiring manager. I close the laptop, text my sister, and book dinner — the search tab is gone from my browser.",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [
      {
        id: "demo-rt-d1",
        createdAt: daysAgoIso(2, 18),
        text: "Still aiming for a PM role with remote days — I wrote the salary floor in my notes so I stop moving it.",
        coachReply: "",
        kind: "intention",
        sentiment: "okay",
      },
      {
        id: "demo-rt-d2",
        createdAt: daysAgoIso(9, 10),
        text: "I want a role that pays the bills without eating my evenings.",
        coachReply: "",
        kind: "intention",
      },
    ],
    obstacleEntries: [
      {
        id: "demo-rt-r1",
        createdAt: daysAgoIso(4, 8),
        text: "Spent an hour on LinkedIn again and sent zero applications.",
        coachReply: "",
        kind: "resistance",
        sentiment: "bad",
      },
      {
        id: "demo-rt-r2",
        createdAt: daysAgoIso(7, 21),
        text: "Fear of another rejection after last spring keeps me “preparing” instead of applying.",
        coachReply: "",
        kind: "hard_blocker",
        sentiment: "bad",
      },
    ],
    visionEntries: [
      {
        id: "demo-rt-v1",
        createdAt: daysAgoIso(3, 7),
        text: "Offer email open. Search tab closed. Dinner booked.",
        coachReply: "",
        kind: "win",
        sentiment: "great",
      },
    ],
    looseNotes: "Target: 5 tailored applications a week until something lands.",
  });

  const newsletter = dreamBase({
    id: "demo-ideate-project",
    title: "Cooking newsletter",
    state: "germinating",
    createdAt: daysAgoIso(8, 20),
    updatedAt: daysAgoIso(3, 21),
    firstThought: "Publish a weekly cooking newsletter people actually open.",
    dreamText:
      "Ship “Weeknight Plate” — a free Substack with one simple dinner recipe each Tuesday. First goal: 100 subscribers and 8 issues published, not a perfect brand.",
    obstacleText:
      "I keep rewriting the about page and never hit Publish. Fear it will look amateur next to food blogs I follow. Weekends disappear into recipe research with nothing scheduled.",
    visionText:
      "Tuesday morning. Issue #8 is live. Phone buzzes with three new subscribers. I screenshot the stats and send them to Alex — proof it’s real.",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [
      {
        id: "demo-rt-pd1",
        createdAt: daysAgoIso(3, 21),
        text: "Name is set: Weeknight Plate. Still haven’t published issue one.",
        coachReply: "",
      },
    ],
    obstacleEntries: [
      {
        id: "demo-rt-pr1",
        createdAt: daysAgoIso(5, 19),
        text: "Rewrote the about page again instead of drafting a recipe.",
        coachReply: "",
      },
    ],
    visionEntries: [
      {
        id: "demo-rt-pv1",
        createdAt: daysAgoIso(6, 16),
        text: "Issue #8 live, three new subs, screenshot to Alex.",
        coachReply: "",
      },
    ],
    looseNotes: "Stack: Substack + phone photos. No fancy site yet.",
  });

  const fitness = dreamBase({
    id: "demo-ideate-body",
    title: "Fitness",
    state: "visualising",
    createdAt: daysAgoIso(14, 7),
    updatedAt: daysAgoIso(5, 7),
    firstThought: "Get strong enough to run a 10k without walking.",
    dreamText:
      "Train consistently: gym three mornings a week, plus one long run on Sunday. Goal race is the city 10k in October — finish under 60 minutes.",
    obstacleText:
      "If I miss Monday I write off the whole week. Late meetings kill the morning slot and I don’t have a backup evening plan. Winter dark makes the run feel optional.",
    visionText:
      "October race day. I cross the finish under an hour, grab a banana, and text my brother the time — legs tired, not broken.",
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [
      {
        id: "demo-rt-bd1",
        createdAt: daysAgoIso(5, 7),
        text: "City 10k in October — under 60 minutes is the line I’m holding.",
        coachReply: "",
      },
    ],
    obstacleEntries: [
      {
        id: "demo-rt-br1",
        createdAt: daysAgoIso(8, 12),
        text: "Missed Monday gym and skipped the rest of the week again.",
        coachReply: "",
      },
    ],
    visionEntries: [
      {
        id: "demo-rt-bv1",
        createdAt: daysAgoIso(6, 17),
        text: "Finish line, under an hour, banana in hand, text to my brother.",
        coachReply: "",
      },
    ],
    looseNotes: "Backup: 30-min evening gym if mornings slip.",
  });

  const subApps: IdeateSubtask = {
    id: "demo-sub-phone-hall",
    projectId: jobSearch.id,
    title: "Send 5 applications this week",
    dreamText:
      "Shortlist roles that match the salary floor, tailor each cover note, and actually hit send — Tue and Thu mornings before email chaos.",
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

  const subCv: IdeateSubtask = {
    id: "demo-sub-tea-window",
    projectId: jobSearch.id,
    title: "Lock a one-page CV and stop rewriting it",
    dreamText:
      "One clean page, exported PDF in the applications folder — no more “just one more tweak” loops.",
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

  const subNetwork: IdeateSubtask = {
    id: "demo-sub-job-network",
    projectId: jobSearch.id,
    title: "Ask two people for a warm intro",
    dreamText:
      "Message two people who already know my work and ask for an intro — not a favour dump, just a clear ask.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(5, 11),
    updatedAt: daysAgoIso(5, 11),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subIssue: IdeateSubtask = {
    id: "demo-sub-open-doc",
    projectId: newsletter.id,
    title: "Publish Weeknight Plate issue #1",
    dreamText:
      "One recipe, phone photos, Tuesday send scheduled — ship before the about page is perfect.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(4, 20),
    updatedAt: daysAgoIso(2, 19),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subList: IdeateSubtask = {
    id: "demo-sub-newsletter-list",
    projectId: newsletter.id,
    title: "Set up Substack and invite ten friends",
    dreamText:
      "Create the publication, write a two-paragraph welcome, and personally invite ten people who already cook on weeknights.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(7, 18),
    updatedAt: daysAgoIso(7, 18),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subGym: IdeateSubtask = {
    id: "demo-sub-fitness-gym",
    projectId: fitness.id,
    title: "Book three morning gym sessions",
    dreamText:
      "Put Mon / Wed / Fri mornings on the calendar with a 30-minute backup evening slot if a meeting lands.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(10, 7),
    updatedAt: daysAgoIso(3, 7),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subRun: IdeateSubtask = {
    id: "demo-sub-fitness-run",
    projectId: fitness.id,
    title: "Build up to a Sunday long run",
    dreamText:
      "Start with 5k easy this Sunday, add a kilometre each week until race pace feels familiar.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started",
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(9, 8),
    updatedAt: daysAgoIso(9, 8),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const todos: IdeateTodo[] = [
    {
      id: "demo-todo-charger",
      subtaskId: subApps.id,
      title: "Shortlist 8 roles that match the salary floor",
      isChecked: true,
      checkedAt: daysAgoIso(2, 22),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 3,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-alarm",
      subtaskId: subApps.id,
      title: "Submit applications Tue / Thu mornings",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-apps-cover",
      subtaskId: subApps.id,
      title: "Write one reusable cover-note template",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 2,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-kettle",
      subtaskId: subCv.id,
      title: "Export PDF and put it in the applications folder",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-cv-peer",
      subtaskId: subCv.id,
      title: "Ask one friend to skim for typos only",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-network-list",
      subtaskId: subNetwork.id,
      title: "List two people and what to ask each for",
      isChecked: true,
      checkedAt: daysAgoIso(4, 16),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 1,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-network-send",
      subtaskId: subNetwork.id,
      title: "Send both messages this week",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-timer",
      subtaskId: subIssue.id,
      title: "Write one recipe draft and schedule Tuesday send",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 2,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-issue-photos",
      subtaskId: subIssue.id,
      title: "Shoot three phone photos of the plated dish",
      isChecked: true,
      checkedAt: daysAgoIso(2, 20),
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-list-create",
      subtaskId: subList.id,
      title: "Create the Substack publication",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-list-invite",
      subtaskId: subList.id,
      title: "Text ten friends the signup link",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-gym-book",
      subtaskId: subGym.id,
      title: "Block Mon / Wed / Fri mornings on the calendar",
      isChecked: true,
      checkedAt: daysAgoIso(3, 7),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 2,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-gym-backup",
      subtaskId: subGym.id,
      title: "Add a 30-min evening backup slot",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-run-plan",
      subtaskId: subRun.id,
      title: "Pick Sunday route and set a 5k start",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
    },
    {
      id: "demo-todo-run-shoes",
      subtaskId: subRun.id,
      title: "Check shoes are race-ready",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
    },
  ];

  return {
    v: 2,
    dreams: [jobSearch, newsletter, fitness],
    subtasks: [
      subApps,
      subCv,
      subNetwork,
      subIssue,
      subList,
      subGym,
      subRun,
    ],
    todos,
    resistanceEntries: [],
  };
}

function buildDemoSelfReference(): VisionSelfReference {
  return {
    url: demoVisionUrl("demo-vision-self.png"),
    mimeType: "image/png",
    fileName: "demo-vision-self.png",
    width: 1024,
    height: 1024,
    byteLength: 0,
    updatedAt: daysAgoIso(1, 12),
  };
}

function buildDemoVisionItems(): VisionBoardItem[] {
  const now = daysAgoIso(1, 12);
  return [
    {
      id: "demo-vb-1",
      color: "#C4A882",
      label: "Stillness above the peaks",
      kind: "image",
      imageUrl: demoVisionUrl("demo-vision-mountain.png"),
      prompt: "Meditating on a mountain at sunrise",
      createdAt: now,
    },
    {
      id: "demo-vb-2",
      color: "#8FA89A",
      label: "Strong body, clear mind",
      kind: "image",
      imageUrl: demoVisionUrl("demo-vision-gym.png"),
      prompt: "Training hard in a bright gym",
      createdAt: now,
    },
    {
      id: "demo-vb-3",
      color: "#A8B5C4",
      label: "Money flowing easily",
      kind: "image",
      imageUrl: demoVisionUrl("demo-vision-wealth.png"),
      prompt: "Celebrating abundance at the desk",
      createdAt: now,
    },
    {
      id: "demo-vb-4",
      color: "#D4A090",
      label: "City lights, quiet confidence",
      kind: "image",
      imageUrl: demoVisionUrl("demo-vision-city.png"),
      prompt: "On a rooftop overlooking the city at dusk",
      createdAt: now,
    },
    {
      id: "demo-vb-5",
      color: "#C9B896",
      label: "Playing for a small room",
      kind: "image",
      imageUrl: demoVisionUrl("demo-vision-music.png"),
      prompt: "Playing guitar on a warm intimate stage",
      createdAt: now,
    },
    {
      id: "demo-vb-6",
      color: "#B8A99A",
      label: "Morning work by the window",
      kind: "image",
      imageUrl: demoVisionUrl("demo-vision-work.png"),
      prompt: "Calm focused work in morning light",
      createdAt: now,
    },
  ];
}

function buildDemoVisionBoard(): IdeateVisionBoardStoreV1 {
  return {
    v: 2,
    items: buildDemoVisionItems(),
    selfReference: buildDemoSelfReference(),
    extraReferences: [],
  };
}

function isDemoSelfReference(ref: VisionSelfReference | null | undefined): boolean {
  if (!ref) return false;
  return (
    ref.fileName === "demo-vision-self.png" ||
    (typeof ref.url === "string" && ref.url.includes("demo-vision-self"))
  );
}

function needsDemoVisionRefresh(board: IdeateVisionBoardStoreV1): boolean {
  if (board.items.length === 0) return true;
  // Personal (non-demo) leftovers must never stick on guest devices.
  if (!board.items.every(isDemoVisionItem)) return true;
  if (!isDemoSelfReference(board.selfReference)) return true;
  if (board.items.some((i) => !i.imageUrl)) return true;
  // Reseed when demo image cache-bust query changes (e.g. male → female set).
  const bust = `?${DEMO_VISION_CACHE}`;
  if (!String(board.selfReference?.url || "").includes(bust)) return true;
  return board.items.some((i) => !String(i.imageUrl || "").includes(bust));
}

function buildDemoReflectionQuestions(): IdeateReflectionQuestion[] {
  const now = daysAgoIso(2, 11);
  return [
    {
      id: "demo-rq-regret",
      text: "What would you regret not trying?",
      description: "A quiet nudge toward the thing you keep postponing.",
      answer:
        "Publishing the cooking newsletter — even if the first issues are rough and only my sister reads them.",
      source: "preset",
      presetId: "regret",
      createdAt: daysAgoIso(6, 20),
      updatedAt: daysAgoIso(2, 20),
    },
    {
      id: "demo-rq-become",
      text: "What kind of person are you trying to become?",
      description: "Not a job title — how you want to show up.",
      answer:
        "Someone who finishes what they start, stays fit enough to keep up with their kids someday, and doesn’t hide behind “busy.”",
      source: "preset",
      presetId: "become",
      createdAt: daysAgoIso(5, 9),
      updatedAt: daysAgoIso(2, 9),
    },
    {
      id: "demo-rq-less-of",
      text: "What do you want less of?",
      description: "Habits, obligations, noise you’d gladly drop.",
      answer:
        "Evenings lost to scrolling, and saying yes to drinks when I’d rather sleep or train.",
      source: "preset",
      presetId: "less-of",
      createdAt: daysAgoIso(4, 10),
      updatedAt: now,
    },
    {
      id: "demo-rq-five-years",
      text: "What would make the next five years feel well spent?",
      description: "One or two outcomes you’d be proud to point at.",
      answer:
        "A job I’m not ashamed of, a body that can run a 10k, and something I’ve published under my own name.",
      source: "preset",
      presetId: "five-years",
      createdAt: daysAgoIso(3, 14),
      updatedAt: daysAgoIso(1, 16),
    },
  ];
}

function buildDemoValues(): IdeateValue[] {
  return [
    {
      id: "demo-val-presence",
      text: "Follow-through",
      createdAt: daysAgoIso(10, 9),
      updatedAt: daysAgoIso(10, 9),
    },
    {
      id: "demo-val-honesty",
      text: "Health",
      createdAt: daysAgoIso(9, 11),
      updatedAt: daysAgoIso(9, 11),
    },
    {
      id: "demo-val-kindness",
      text: "Honesty",
      createdAt: daysAgoIso(8, 14),
      updatedAt: daysAgoIso(8, 14),
    },
    {
      id: "demo-val-enough",
      text: "Family time",
      createdAt: daysAgoIso(7, 8),
      updatedAt: daysAgoIso(7, 8),
    },
    {
      id: "demo-val-quiet",
      text: "Financial clarity",
      createdAt: daysAgoIso(6, 10),
      updatedAt: daysAgoIso(6, 10),
    },
  ];
}

function buildDemoValuesStore(): IdeateValuesStoreV1 {
  return { v: 1, values: buildDemoValues() };
}

function buildDemoRegrets(): IdeateRegret[] {
  return [
    {
      id: "demo-regret-doc",
      statement:
        "Never publishing anything under my own name — always “almost ready.”",
      category: "Creative",
      createdAt: daysAgoIso(8, 19),
      updatedAt: daysAgoIso(3, 19),
    },
    {
      id: "demo-regret-mornings",
      statement:
        "Skipping the gym for months after telling myself I’d start next Monday.",
      category: "Health",
      createdAt: daysAgoIso(7, 8),
      updatedAt: daysAgoIso(2, 8),
    },
  ];
}

function buildDemoQuotes(): IdeateQuote[] {
  return [
    {
      id: "demo-quote-enough",
      text: "Done is better than perfect.",
      attribution: "Common saying",
      createdAt: daysAgoIso(9, 11),
      updatedAt: daysAgoIso(9, 11),
    },
    {
      id: "demo-quote-start",
      text: "You miss 100% of the shots you don’t take.",
      attribution: "Wayne Gretzky",
      createdAt: daysAgoIso(6, 14),
      updatedAt: daysAgoIso(6, 14),
    },
    {
      id: "demo-quote-gentle",
      text: "Discipline is choosing between what you want now and what you want most.",
      attribution: "Anonymous",
      createdAt: daysAgoIso(4, 9),
      updatedAt: daysAgoIso(4, 9),
    },
  ];
}

function isDemoVisionItem(i: VisionBoardItem): boolean {
  return i.id.startsWith("demo-vb-");
}

function isDemoReflectionQuestion(q: IdeateReflectionQuestion): boolean {
  return q.id.startsWith("demo-rq-");
}

function isDemoValue(v: IdeateValue): boolean {
  return v.id.startsWith("demo-val-");
}

function isDemoRegretEntry(r: IdeateRegret): boolean {
  return r.id.startsWith("demo-regret-");
}

function isDemoQuoteEntry(q: IdeateQuote): boolean {
  return q.id.startsWith("demo-quote-");
}

function needsDemoQuestionsRefresh(
  questions: IdeateReflectionQuestion[],
): boolean {
  if (questions.length === 0) return true;
  // Account leftovers on a guest device → replace with seeds.
  if (!questions.every(isDemoReflectionQuestion)) return true;
  if (questions.length < 4) return true;
  return questions.some((q) => !q.answer.trim());
}

function needsDemoValuesRefresh(store: IdeateValuesStoreV1): boolean {
  if (store.values.length === 0) return true;
  if (!store.values.every(isDemoValue)) return true;
  return store.values.length < 5;
}

function needsDemoRegretsRefresh(store: { regrets: IdeateRegret[] }): boolean {
  if (store.regrets.length === 0) return true;
  if (!store.regrets.every(isDemoRegretEntry)) return true;
  return store.regrets.length < 2;
}

function needsDemoQuotesRefresh(store: { quotes: IdeateQuote[] }): boolean {
  if (store.quotes.length === 0) return true;
  if (!store.quotes.every(isDemoQuoteEntry)) return true;
  return store.quotes.length < 3;
}

/**
 * When refreshing demo life-area copy, keep steps/todos the guest added
 * (anything not part of the stock demo seed ids).
 */
function mergeUserStepsOntoDemos(
  existing: IdeateStoreV2,
  demo: IdeateStoreV2,
): IdeateStoreV2 {
  const demoProjectIds = new Set<string>(DEMO_IDEATE_DREAM_IDS);
  const stockSubIds = new Set(demo.subtasks.map((s) => s.id));
  const userSubs = existing.subtasks.filter(
    (s) =>
      demoProjectIds.has(s.projectId) &&
      !s.id.startsWith("demo-sub-") &&
      !stockSubIds.has(s.id),
  );
  const userSubIds = new Set(userSubs.map((s) => s.id));
  const stockTodoIds = new Set(demo.todos.map((t) => t.id));
  const userTodos = existing.todos.filter(
    (t) =>
      userSubIds.has(t.subtaskId) &&
      !t.id.startsWith("demo-todo-") &&
      !stockTodoIds.has(t.id),
  );
  return {
    v: 2,
    dreams: demo.dreams,
    subtasks: [...demo.subtasks, ...userSubs],
    todos: [...demo.todos, ...userTodos],
    resistanceEntries: demo.resistanceEntries,
  };
}

function persistGuestIdeateStore(store: IdeateStoreV2): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      "mm_plan_dreams_v1",
      JSON.stringify({
        v: 2,
        dreams: store.dreams,
        subtasks: store.subtasks,
        todos: store.todos,
        resistanceEntries: store.resistanceEntries,
      }),
    );
  } catch {
    /* */
  }
}

/**
 * Guests: seed demos when empty; refresh demo copy on version bump without
 * wiping user-added steps. Never destroy a non-empty guest store just because
 * it isn't a pure demo set (that made new steps vanish on Add).
 * Signed-in: never seed; strip demos from the returned store (caller persists).
 */
export function ensureGuestDemoIdeateSeeded(
  existing: IdeateStoreV2,
): IdeateStoreV2 {
  if (typeof window !== "undefined" && isMedimadeSessionActive()) {
    stripDemoCompanionStores();
    return withoutDemoIdeateStore(existing);
  }

  if (typeof window === "undefined") {
    return buildDemoIdeateStore();
  }

  const stale = isCompanionSeedStale();
  const demoOnly = isDemoOnlyIdeateStore(existing);
  const hasAllDemos = DEMO_IDEATE_DREAM_IDS.every((id) =>
    existing.dreams.some((d) => d.id === id),
  );

  // Already seeded and current — keep everything (custom steps, personal areas).
  if (!stale && existing.dreams.length > 0) {
    seedCompanionStoresIfEmpty(companionNeedsSeed());
    markDemoSeedFlag();
    return existing;
  }

  // Empty guest device → stock demos.
  if (existing.dreams.length === 0) {
    const demo = buildDemoIdeateStore();
    persistGuestIdeateStore(demo);
    seedCompanionStoresIfEmpty(true);
    markDemoSeedFlag();
    return demo;
  }

  // Stale demo-only set → refresh copy, keep user-added steps.
  if (stale && demoOnly && hasAllDemos) {
    const merged = mergeUserStepsOntoDemos(existing, buildDemoIdeateStore());
    persistGuestIdeateStore(merged);
    seedCompanionStoresIfEmpty(true);
    markDemoSeedFlag();
    return merged;
  }

  // Stale / incomplete, but guest already has real content — don't wipe it.
  seedCompanionStoresIfEmpty(companionNeedsSeed());
  markDemoSeedFlag();
  return existing;
}

/** Reset device Ideate to guest demos (call on sign-out). Sync so UI sees demos immediately. */
export function resetIdeateLocalToGuestDemos(): void {
  if (typeof window === "undefined") return;
  // Never overwrite a signed-in working session with guest samples.
  if (isMedimadeSessionActive()) return;

  let existing: IdeateStoreV2 = {
    v: 2,
    dreams: [],
    subtasks: [],
    todos: [],
    resistanceEntries: [],
  };
  try {
    const raw = window.localStorage.getItem("mm_plan_dreams_v1");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IdeateStoreV2>;
      if (parsed && parsed.v === 2) {
        existing = {
          v: 2,
          dreams: Array.isArray(parsed.dreams) ? parsed.dreams : [],
          subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks : [],
          todos: Array.isArray(parsed.todos) ? parsed.todos : [],
          resistanceEntries: Array.isArray(parsed.resistanceEntries)
            ? parsed.resistanceEntries
            : [],
        };
      }
    }
  } catch {
    /* */
  }

  // Soft ensure — seeds when empty; does not wipe user-added steps on remount.
  const next = ensureGuestDemoIdeateSeeded(existing);
  persistGuestIdeateStore(next);
  seedCompanionStoresIfEmpty(isCompanionSeedStale() || companionNeedsSeed());
  markDemoSeedFlag();
}

function stripDemoCompanionStores(): void {
  if (typeof window === "undefined") return;
  try {
    const board = loadIdeateVisionBoardStore();
    const nextItems = board.items.filter((i) => !isDemoVisionItem(i));
    const nextSelf = isDemoSelfReference(board.selfReference)
      ? null
      : (board.selfReference ?? null);
    if (
      nextItems.length !== board.items.length ||
      nextSelf !== (board.selfReference ?? null)
    ) {
      saveIdeateVisionBoardStoreLocal({
        v: 2,
        items: nextItems,
        selfReference: nextSelf,
        extraReferences: board.extraReferences ?? [],
      });
    }
    const qs = loadIdeateReflectionQuestionsStore();
    const nextQs = qs.questions.filter((q) => !isDemoReflectionQuestion(q));
    if (nextQs.length !== qs.questions.length) {
      saveIdeateReflectionQuestionsStoreLocal({ v: 1, questions: nextQs });
    }
    const values = loadIdeateValuesStore();
    const nextValues = values.values.filter((v) => !isDemoValue(v));
    if (nextValues.length !== values.values.length) {
      saveIdeateValuesStoreLocal({ v: 1, values: nextValues });
    }
    const regrets = loadIdeateRegretsStore();
    const nextRegrets = regrets.regrets.filter((r) => !isDemoRegretEntry(r));
    if (nextRegrets.length !== regrets.regrets.length) {
      saveIdeateRegretsStoreLocal({ v: 1, regrets: nextRegrets });
    }
    const quotes = loadIdeateQuotesStore();
    const nextQuotes = quotes.quotes.filter((q) => !isDemoQuoteEntry(q));
    if (nextQuotes.length !== quotes.quotes.length) {
      saveIdeateQuotesStoreLocal({ v: 1, quotes: nextQuotes });
    }
  } catch {
    /* */
  }
}

function companionNeedsSeed(): boolean {
  try {
    return (
      isCompanionSeedStale() ||
      needsDemoVisionRefresh(loadIdeateVisionBoardStore()) ||
      needsDemoQuestionsRefresh(
        loadIdeateReflectionQuestionsStore().questions,
      ) ||
      needsDemoValuesRefresh(loadIdeateValuesStore()) ||
      needsDemoRegretsRefresh(loadIdeateRegretsStore()) ||
      needsDemoQuotesRefresh(loadIdeateQuotesStore())
    );
  } catch {
    return true;
  }
}

function seedCompanionStoresIfEmpty(force = false): void {
  if (typeof window === "undefined") return;
  if (isMedimadeSessionActive()) return;
  try {
    const board = loadIdeateVisionBoardStore();
    if (force || needsDemoVisionRefresh(board)) {
      // Local-only — avoid scheduling cloud PUT from guest seed path.
      saveIdeateVisionBoardStoreLocal(buildDemoVisionBoard());
    }
    const qs = loadIdeateReflectionQuestionsStore();
    if (force || needsDemoQuestionsRefresh(qs.questions)) {
      saveIdeateReflectionQuestionsStoreLocal({
        v: 1,
        questions: buildDemoReflectionQuestions(),
      });
    }
    const values = loadIdeateValuesStore();
    if (force || needsDemoValuesRefresh(values)) {
      saveIdeateValuesStoreLocal(buildDemoValuesStore());
    }
    const regrets = loadIdeateRegretsStore();
    if (force || needsDemoRegretsRefresh(regrets)) {
      saveIdeateRegretsStoreLocal({ v: 1, regrets: buildDemoRegrets() });
    }
    const quotes = loadIdeateQuotesStore();
    if (force || needsDemoQuotesRefresh(quotes)) {
      saveIdeateQuotesStoreLocal({ v: 1, quotes: buildDemoQuotes() });
    }
  } catch {
    /* */
  }
}

/**
 * Ensure guest companion stores (values / questions / vision) match the demo seed.
 * Never run while a session is active — cloud owns signed-in data.
 */
export function ensureGuestCompanionDemos(force = false): void {
  if (typeof window === "undefined") return;
  if (isMedimadeSessionActive()) return;
  seedCompanionStoresIfEmpty(force || companionNeedsSeed());
  markDemoSeedFlag();
}

