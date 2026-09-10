/**
 * Replace guest Ideate fields with Alex-flavoured demo data:
 * - values: copy from alexmaragakis@hotmail.co.uk
 * - quotes: three Alan Watts quotes
 * - ideate: Music / Fitness / Meditation / Social media + subtasks/todos
 *
 * Leaves visionBoard (and other non-ideate fields) untouched.
 *
 *   AWS_PROFILE=mm npx tsx scripts/seed-guest-ideate-alex.ts
 *   AWS_PROFILE=mm npx tsx scripts/seed-guest-ideate-alex.ts --dry-run
 */

import { randomUUID } from "crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { GUEST_ACCOUNT_EMAIL } from "../lambdas/auth-guest";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const dryRun = process.argv.includes("--dry-run");
const SOURCE_EMAIL = "alexmaragakis@hotmail.co.uk";

const USERS =
  process.env.USERS_TABLE_NAME?.trim() ||
  "MedimadeBackend-MedimadeUsersTable56DCE6C2-1AXT1LLLN1H4S";
const IDEATE =
  process.env.IDEATE_TABLE_NAME?.trim() ||
  "MedimadeBackend-IdeateTable6FC78D26-M84L0GZB3VFS";

const SK_STORE = "STORE";

function daysAgoIso(days: number, hour = 9): string {
  const d = new Date();
  d.setHours(hour, 15, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

async function userIdForEmail(email: string): Promise<string> {
  const out = await ddb.send(
    new GetCommand({
      TableName: USERS,
      Key: { email: email.trim().toLowerCase() },
    }),
  );
  const uid = out.Item?.userId;
  if (typeof uid !== "string" || !uid.trim()) {
    throw new Error(`No userId for ${email}`);
  }
  return uid.trim();
}

async function getStore(userId: string): Promise<Record<string, unknown> | null> {
  const out = await ddb.send(
    new GetCommand({
      TableName: IDEATE,
      Key: { pk: userId, sk: SK_STORE },
    }),
  );
  const store = out.Item?.store;
  if (!store || typeof store !== "object") return null;
  return store as Record<string, unknown>;
}

function emptyDreamFields() {
  return {
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
    dreamEntries: [] as unknown[],
    obstacleEntries: [] as unknown[],
    visionEntries: [] as unknown[],
    looseNotes: "",
    checkIns: [] as unknown[],
    insights: [] as unknown[],
    meditationsGenerated: 0,
    completedAt: null as string | null,
    cardColor: null as string | null,
  };
}

function buildIdeate() {
  const musicId = "guest-dream-music";
  const fitnessId = "guest-dream-fitness";
  const meditationId = "guest-dream-meditation";
  const socialId = "guest-dream-social";

  const dreams = [
    {
      id: musicId,
      title: "Music",
      state: "in_motion",
      createdAt: daysAgoIso(20, 10),
      updatedAt: daysAgoIso(1, 19),
      firstThought:
        "Playing music a lot more often and in public. Writing and recording a few more songs.",
      dreamText:
        "Write and record new songs, share them, and play live with a decent turnout — not someday, this season.",
      obstacleText:
        "Fear of what people think stops me from posting. Studio costs feel heavy. Time disappears into everything else.",
      visionText:
        "An EP is finished and out. I'm on stage for my own show — room full enough that it feels real.",
      ...emptyDreamFields(),
      dreamEntries: [
        {
          id: id("thought"),
          createdAt: daysAgoIso(2, 19),
          text: "I love music but sometimes I wonder if I should focus on other things.",
          coachReply: "",
          sentiment: "okay",
          kind: "question",
        },
      ],
      meditationsGenerated: 1,
    },
    {
      id: fitnessId,
      title: "Fitness",
      state: "exploring",
      createdAt: daysAgoIso(18, 7),
      updatedAt: daysAgoIso(2, 7),
      firstThought: "Get ripped and actually feel strong in my body.",
      dreamText:
        "Train consistently — lift 3–4 times a week, eat enough protein, and see visible change in the mirror and how clothes fit.",
      obstacleText:
        "If I miss Monday I write off the week. Late work kills the morning slot. Takeaways undo a good training day.",
      visionText:
        "Summer. Shirt fits different. I catch myself in a shop window and think — yeah, that's the work showing.",
      ...emptyDreamFields(),
      dreamEntries: [
        {
          id: id("thought"),
          createdAt: daysAgoIso(3, 8),
          text: "Want the ‘get ripped’ version of me without living in the gym.",
          coachReply: "",
          kind: "intention",
          sentiment: "good",
        },
      ],
    },
    {
      id: meditationId,
      title: "Meditation",
      state: "in_motion",
      createdAt: daysAgoIso(25, 6),
      updatedAt: daysAgoIso(1, 6),
      firstThought: "Make sitting a non-negotiable part of the day.",
      dreamText:
        "A daily sit that sticks — mornings before screens — and keep building Consciously so other people can find the same stillness.",
      obstacleText:
        "Phone first thing. Skipping ‘just today’ turns into a week. Building the product crowds out the practice.",
      visionText:
        "Forty days in a row of sitting. I notice the urge to grab the phone and choose the cushion instead.",
      ...emptyDreamFields(),
      dreamEntries: [
        {
          id: id("thought"),
          createdAt: daysAgoIso(1, 6),
          text: "Practice and product should feed each other, not compete.",
          coachReply: "",
          kind: "insight",
          sentiment: "good",
        },
      ],
      meditationsGenerated: 3,
    },
    {
      id: socialId,
      title: "Social media",
      state: "germinating",
      createdAt: daysAgoIso(10, 14),
      updatedAt: daysAgoIso(2, 14),
      firstThought: "Post music and Consciously without spiralling into comparison.",
      dreamText:
        "Show up weekly with honest clips — song drafts, practice notes, product glimpses — without chasing vanity metrics.",
      obstacleText:
        "I draft and delete. Scrolling other people’s highlight reels kills the urge to post. No clear cadence.",
      visionText:
        "A simple weekly rhythm: one music clip, one real note. People who care actually reply.",
      ...emptyDreamFields(),
      dreamEntries: [
        {
          id: id("thought"),
          createdAt: daysAgoIso(2, 15),
          text: "Posting is part of the creative loop, not a separate performance.",
          coachReply: "",
          kind: "intention",
        },
      ],
    },
  ];

  const subSong = {
    id: "guest-st-record-song",
    projectId: musicId,
    title: "Record a new song",
    dreamText:
      "Finish the words, get the mics out, guitar pass, vocals, layers — then a rough mix I can actually listen to.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(8, 15),
    updatedAt: daysAgoIso(1, 19),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subShow = {
    id: "guest-st-live-show",
    projectId: musicId,
    title: "Play a small live show",
    dreamText:
      "Book a room, lock a short setlist, invite people who will actually come.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(6, 16),
    updatedAt: daysAgoIso(6, 16),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subRipped = {
    id: "guest-st-get-ripped",
    projectId: fitnessId,
    title: "Get ripped",
    dreamText:
      "Lift with progressive overload, hit protein most days, and stick to the plan for eight weeks.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(9, 7),
    updatedAt: daysAgoIso(2, 7),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subRun = {
    id: "guest-st-cardio",
    projectId: fitnessId,
    title: "Keep cardio in the mix",
    dreamText: "Two easy runs or zone-2 sessions a week so lifting doesn’t make me stiff.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(5, 8),
    updatedAt: daysAgoIso(5, 8),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subDailySit = {
    id: "guest-st-daily-sit",
    projectId: meditationId,
    title: "Daily morning sit",
    dreamText: "Ten to twenty minutes before email — same cushion, same window.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(12, 6),
    updatedAt: daysAgoIso(1, 6),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subPracticeDepth = {
    id: "guest-st-body-scan",
    projectId: meditationId,
    title: "Deepen the practice",
    dreamText: "One longer sit or body scan each weekend — no headphones multitasking.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(4, 9),
    updatedAt: daysAgoIso(4, 9),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subPostMusic = {
    id: "guest-st-post-music",
    projectId: socialId,
    title: "Post a music clip each week",
    dreamText: "One short clip or verse — imperfect is fine — scheduled before Sunday night.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "in_progress" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(7, 14),
    updatedAt: daysAgoIso(2, 14),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };
  const subPostProduct = {
    id: "guest-st-post-consciously",
    projectId: socialId,
    title: "Share Consciously in public",
    dreamText: "One honest product or practice note a week — no perfectionist thread.",
    resistanceText: "",
    visionText: "",
    usedFullFlow: false,
    status: "not_started" as const,
    completedAt: null,
    completedManually: false,
    createdAt: daysAgoIso(3, 15),
    updatedAt: daysAgoIso(3, 15),
    dreamReflectReply: "",
    obstacleExploreReply: "",
    visionBuildReply: "",
  };

  const subtasks = [
    subSong,
    subShow,
    subRipped,
    subRun,
    subDailySit,
    subPracticeDepth,
    subPostMusic,
    subPostProduct,
  ];

  function todosFor(
    subtaskId: string,
    titles: string[],
    opts?: { checkedFirst?: number },
  ) {
    const checkedFirst = opts?.checkedFirst ?? 0;
    return titles.map((title, order) => {
      const isChecked = order < checkedFirst;
      return {
        id: `guest-todo-${subtaskId}-${order}`,
        subtaskId,
        title,
        isChecked,
        checkedAt: isChecked ? daysAgoIso(1, 18) : null,
        stalledNudgeShownAt: null,
        order,
        viewCount: isChecked ? 4 : 1,
        wasUnchecked: false,
      };
    });
  }

  const todos = [
    ...todosFor(subSong.id, [
      "Sit down and finish the lyrics",
      "Get the microphones out",
      "Record a guitar pass",
      "Record vocal tracks",
      "Add instrumental layers",
      "Mix and balance the tracks",
    ], { checkedFirst: 1 }),
    ...todosFor(subShow.id, [
      "Shortlist two small venues",
      "Pick a date and message the room",
      "Lock a 6-song setlist",
      "Invite ten people who will show up",
    ]),
    ...todosFor(subRipped.id, [
      "Book four gym sessions this week",
      "Hit protein target four days running",
      "Log lifts in a notes app",
      "Add 2.5kg when the set feels easy",
      "Take a progress photo on Sunday",
    ], { checkedFirst: 1 }),
    ...todosFor(subRun.id, [
      "Block two zone-2 slots on the calendar",
      "Do a 25-minute easy run",
    ]),
    ...todosFor(subDailySit.id, [
      "Set cushion out the night before",
      "Sit before opening email",
      "Mark the day in the streak",
    ], { checkedFirst: 2 }),
    ...todosFor(subPracticeDepth.id, [
      "Pick a 30–40 min body scan for Saturday",
      "Phone in another room for the sit",
    ]),
    ...todosFor(subPostMusic.id, [
      "Film a 20-second phone clip of a verse",
      "Write a one-line caption (no overthinking)",
      "Post before Sunday night",
    ], { checkedFirst: 1 }),
    ...todosFor(subPostProduct.id, [
      "Draft one honest note about building Consciously",
      "Post it once without editing five times",
    ]),
  ];

  return {
    v: 2 as const,
    dreams,
    subtasks,
    todos,
    resistanceEntries: [] as unknown[],
  };
}

function alanWattsQuotes() {
  const now = daysAgoIso(3, 12);
  return {
    v: 1 as const,
    quotes: [
      {
        id: "guest-quote-watts-aperture",
        text: "You are an aperture through which the universe is looking at and exploring itself.",
        attribution: "Alan Watts",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "guest-quote-watts-muddy",
        text: "Muddy water is best cleared by leaving it alone.",
        attribution: "Alan Watts",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "guest-quote-watts-dance",
        text: "The only way to make sense out of change is to plunge into it, move with it, and join the dance.",
        attribution: "Alan Watts",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
}

async function main() {
  console.log(
    dryRun ? "[dry-run]" : "[live]",
    `seed guest ideate from ${SOURCE_EMAIL}`,
  );

  const sourceId = await userIdForEmail(SOURCE_EMAIL);
  const guestId = await userIdForEmail(GUEST_ACCOUNT_EMAIL);
  const sourceStore = await getStore(sourceId);
  const guestStore = await getStore(guestId);
  if (!guestStore) throw new Error("Guest has no Ideate STORE");

  const sourceValues = sourceStore?.values;
  if (!sourceValues || typeof sourceValues !== "object") {
    throw new Error("Source account has no values");
  }

  // Fresh guest-scoped ids so we don't collide if Alex edits later.
  const valuesRaw = sourceValues as {
    v?: number;
    values?: Array<Record<string, unknown>>;
  };
  const values = {
    v: 1 as const,
    values: (valuesRaw.values ?? []).map((v) => ({
      ...v,
      id: id("val"),
    })),
  };

  const ideate = buildIdeate();
  const quotes = alanWattsQuotes();
  const now = new Date().toISOString();

  const nextStore: Record<string, unknown> = {
    ...guestStore,
    version: 1,
    updatedAt: now,
    ideate,
    values,
    quotes,
  };

  console.log("values:", values.values.map((v) => v.text).join(", "));
  console.log(
    "quotes:",
    quotes.quotes.map((q) => q.text.slice(0, 40) + "…").join(" | "),
  );
  console.log(
    "dreams:",
    ideate.dreams.map((d) => d.title).join(", "),
    `| ${ideate.subtasks.length} subtasks, ${ideate.todos.length} todos`,
  );
  console.log(
    "visionBoard preserved:",
    guestStore.visionBoard != null ? "yes" : "no",
  );

  if (dryRun) {
    console.log("Would write guest STORE (ideate + values + quotes only).");
    return;
  }

  await ddb.send(
    new PutCommand({
      TableName: IDEATE,
      Item: {
        pk: guestId,
        sk: SK_STORE,
        store: nextStore,
        updatedAt: now,
      },
    }),
  );
  console.log("Wrote guest STORE.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
