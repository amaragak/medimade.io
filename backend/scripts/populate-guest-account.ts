/**
 * Populate the shared guest account with normal account data
 * (Ideate, Journal, vision media, meditation library).
 *
 *   AWS_PROFILE=mm npx tsx scripts/populate-guest-account.ts
 *   AWS_PROFILE=mm npx tsx scripts/populate-guest-account.ts --dry-run
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  BatchWriteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  GUEST_ACCOUNT_DISPLAY_NAME,
  GUEST_ACCOUNT_EMAIL,
} from "../lambdas/auth-guest";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const s3 = new S3Client({});

const dryRun = process.argv.includes("--dry-run");

const USERS = "MedimadeBackend-MedimadeUsersTable56DCE6C2-1AXT1LLLN1H4S";
const IDEATE = "MedimadeBackend-IdeateTable6FC78D26-M84L0GZB3VFS";
const ANALYTICS =
  "MedimadeBackend-MeditationAnalyticsTableDBD22E65-INTB3IF3ZBC";
const MEDIA_BUCKET =
  process.env.MEDIA_BUCKET_NAME?.trim() ||
  "medimadebackend-mediabucketbcbb02ba-qbflcb6ucrj7";
const MEDIA_BASE =
  process.env.MEDIA_BASE_URL?.trim() ||
  "https://d30tgo2eshgnaf.cloudfront.net";

const VISION_DIR = join(
  __dirname,
  "../../frontend/webapp/public/demo/vision-board",
);

function daysAgoIso(days: number, hour = 9): string {
  const d = new Date();
  d.setHours(hour, 15, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function mediaUrl(key: string): string {
  return `${MEDIA_BASE.replace(/\/$/, "")}/${key.replace(/^\//, "")}`;
}

async function uploadVisionPng(
  userId: string,
  localName: string,
  s3Key: string,
): Promise<{ key: string; url: string; byteLength: number }> {
  const localPath = join(VISION_DIR, localName);
  if (!existsSync(localPath)) {
    throw new Error(`Missing vision asset: ${localPath}`);
  }
  const body = readFileSync(localPath);
  if (!dryRun) {
    let exists = false;
    try {
      await s3.send(
        new HeadObjectCommand({ Bucket: MEDIA_BUCKET, Key: s3Key }),
      );
      exists = true;
    } catch {
      exists = false;
    }
    if (!exists) {
      await s3.send(
        new PutObjectCommand({
          Bucket: MEDIA_BUCKET,
          Key: s3Key,
          Body: body,
          ContentType: "image/png",
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    }
  }
  return { key: s3Key, url: mediaUrl(s3Key), byteLength: body.length };
}

async function buildVisionBoard(userId: string) {
  const now = daysAgoIso(1, 12);
  const selfId = "guest-vision-self";
  const selfKey = `ideate/vision/${userId}/self/${selfId}.png`;
  const self = await uploadVisionPng(userId, "demo-vision-self.png", selfKey);

  const tiles = [
    {
      id: "guest-vb-1",
      file: "demo-vision-mountain.png",
      color: "#C4A882",
      label: "Stillness above the peaks",
      prompt: "Meditating on a mountain at sunrise",
    },
    {
      id: "guest-vb-2",
      file: "demo-vision-gym.png",
      color: "#8FA89A",
      label: "Strong body, clear mind",
      prompt: "Training hard in a bright gym",
    },
    {
      id: "guest-vb-3",
      file: "demo-vision-wealth.png",
      color: "#A8B5C4",
      label: "Money flowing easily",
      prompt: "Celebrating abundance at the desk",
    },
    {
      id: "guest-vb-4",
      file: "demo-vision-city.png",
      color: "#D4A090",
      label: "City lights, quiet confidence",
      prompt: "On a rooftop overlooking the city at dusk",
    },
    {
      id: "guest-vb-5",
      file: "demo-vision-music.png",
      color: "#C9B896",
      label: "Playing for a small room",
      prompt: "Playing guitar on a warm intimate stage",
    },
    {
      id: "guest-vb-6",
      file: "demo-vision-work.png",
      color: "#B8A99A",
      label: "Morning work by the window",
      prompt: "Calm focused work in morning light",
    },
  ] as const;

  const items = [];
  for (const t of tiles) {
    const key = `ideate/vision/${userId}/tile/${t.id}.png`;
    const up = await uploadVisionPng(userId, t.file, key);
    items.push({
      id: t.id,
      color: t.color,
      label: t.label,
      kind: "image" as const,
      imageUrl: up.url,
      mediaKey: up.key,
      prompt: t.prompt,
      createdAt: now,
    });
  }

  return {
    v: 2 as const,
    items,
    selfReference: {
      url: self.url,
      key: self.key,
      mimeType: "image/png",
      fileName: "self-reference.png",
      width: 1024,
      height: 1024,
      byteLength: self.byteLength,
      updatedAt: now,
    },
    extraReferences: [] as unknown[],
  };
}

function buildIdeateBundle(visionBoard: Awaited<ReturnType<typeof buildVisionBoard>>) {
  const now = new Date().toISOString();
  const jobId = "guest-dream-job";
  const newsletterId = "guest-dream-newsletter";
  const fitnessId = "guest-dream-fitness";

  const dreams = [
    {
      id: jobId,
      title: "Job search",
      state: "exploring",
      createdAt: daysAgoIso(12, 8),
      updatedAt: daysAgoIso(1, 8),
      firstThought:
        "I want a role that pays the bills without eating my evenings.",
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
          id: "guest-rt-d1",
          createdAt: daysAgoIso(2, 18),
          text: "Still aiming for a PM role with remote days — I wrote the salary floor in my notes so I stop moving it.",
          coachReply: "",
          kind: "intention",
          sentiment: "okay",
        },
        {
          id: "guest-rt-d2",
          createdAt: daysAgoIso(9, 10),
          text: "I want a role that pays the bills without eating my evenings.",
          coachReply: "",
          kind: "intention",
        },
      ],
      obstacleEntries: [
        {
          id: "guest-rt-r1",
          createdAt: daysAgoIso(4, 8),
          text: "Spent an hour on LinkedIn again and sent zero applications.",
          coachReply: "",
          kind: "resistance",
          sentiment: "bad",
        },
        {
          id: "guest-rt-r2",
          createdAt: daysAgoIso(7, 21),
          text: "Fear of another rejection after last spring keeps me “preparing” instead of applying.",
          coachReply: "",
          kind: "hard_blocker",
          sentiment: "bad",
        },
      ],
      visionEntries: [
        {
          id: "guest-rt-v1",
          createdAt: daysAgoIso(3, 7),
          text: "Offer email open. Search tab closed. Dinner booked.",
          coachReply: "",
          kind: "win",
          sentiment: "great",
        },
      ],
      looseNotes: "Target: 5 tailored applications a week until something lands.",
      checkIns: [],
      insights: [],
      meditationsGenerated: 0,
      completedAt: null,
      cardColor: null,
    },
    {
      id: newsletterId,
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
          id: "guest-rt-pd1",
          createdAt: daysAgoIso(3, 21),
          text: "Name is set: Weeknight Plate. Still haven’t published issue one.",
          coachReply: "",
        },
      ],
      obstacleEntries: [
        {
          id: "guest-rt-pr1",
          createdAt: daysAgoIso(5, 19),
          text: "Rewrote the about page again instead of drafting a recipe.",
          coachReply: "",
        },
      ],
      visionEntries: [
        {
          id: "guest-rt-pv1",
          createdAt: daysAgoIso(6, 16),
          text: "Issue #8 live, three new subs, screenshot to Alex.",
          coachReply: "",
        },
      ],
      looseNotes: "Stack: Substack + phone photos. No fancy site yet.",
      checkIns: [],
      insights: [],
      meditationsGenerated: 0,
      completedAt: null,
      cardColor: null,
    },
    {
      id: fitnessId,
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
          id: "guest-rt-bd1",
          createdAt: daysAgoIso(5, 7),
          text: "City 10k in October — under 60 minutes is the line I’m holding.",
          coachReply: "",
        },
      ],
      obstacleEntries: [
        {
          id: "guest-rt-br1",
          createdAt: daysAgoIso(8, 12),
          text: "Missed Monday gym and skipped the rest of the week again.",
          coachReply: "",
        },
      ],
      visionEntries: [
        {
          id: "guest-rt-bv1",
          createdAt: daysAgoIso(6, 17),
          text: "Finish line, under an hour, banana in hand, text to my brother.",
          coachReply: "",
        },
      ],
      looseNotes: "Backup: 30-min evening gym if mornings slip.",
      checkIns: [],
      insights: [],
      meditationsGenerated: 0,
      completedAt: null,
      cardColor: null,
    },
  ];

  const subApps = {
    id: "guest-st-apps",
    projectId: jobId,
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
  const subCv = {
    id: "guest-st-cv",
    projectId: jobId,
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
  const subNetwork = {
    id: "guest-st-network",
    projectId: jobId,
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
  const subIssue = {
    id: "guest-st-issue",
    projectId: newsletterId,
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
  const subList = {
    id: "guest-st-list",
    projectId: newsletterId,
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
  const subGym = {
    id: "guest-st-gym",
    projectId: fitnessId,
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
  const subRun = {
    id: "guest-st-run",
    projectId: fitnessId,
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

  const todos = [
    {
      id: "guest-todo-shortlist",
      subtaskId: subApps.id,
      title: "Shortlist 8 roles that match the salary floor",
      isChecked: true,
      checkedAt: daysAgoIso(2, 22),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 3,
      wasUnchecked: false,
      createdAt: daysAgoIso(6, 9),
      updatedAt: daysAgoIso(2, 22),
    },
    {
      id: "guest-todo-submit",
      subtaskId: subApps.id,
      title: "Submit applications Tue / Thu mornings",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
      createdAt: daysAgoIso(6, 9),
      updatedAt: daysAgoIso(1, 8),
    },
    {
      id: "guest-todo-cover",
      subtaskId: subApps.id,
      title: "Write one reusable cover-note template",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 2,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(5, 10),
      updatedAt: daysAgoIso(5, 10),
    },
    {
      id: "guest-todo-cv-export",
      subtaskId: subCv.id,
      title: "Export PDF and put it in the applications folder",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(6, 9),
      updatedAt: daysAgoIso(6, 9),
    },
    {
      id: "guest-todo-cv-peer",
      subtaskId: subCv.id,
      title: "Ask one friend to skim for typos only",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(6, 9),
      updatedAt: daysAgoIso(6, 9),
    },
    {
      id: "guest-todo-network-list",
      subtaskId: subNetwork.id,
      title: "List two people and what to ask each for",
      isChecked: true,
      checkedAt: daysAgoIso(4, 16),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 1,
      wasUnchecked: false,
      createdAt: daysAgoIso(5, 11),
      updatedAt: daysAgoIso(4, 16),
    },
    {
      id: "guest-todo-network-send",
      subtaskId: subNetwork.id,
      title: "Send both messages this week",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(5, 11),
      updatedAt: daysAgoIso(5, 11),
    },
    {
      id: "guest-todo-recipe",
      subtaskId: subIssue.id,
      title: "Write one recipe draft and schedule Tuesday send",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 2,
      wasUnchecked: false,
      createdAt: daysAgoIso(4, 20),
      updatedAt: daysAgoIso(2, 19),
    },
    {
      id: "guest-todo-photos",
      subtaskId: subIssue.id,
      title: "Shoot three phone photos of the plated dish",
      isChecked: true,
      checkedAt: daysAgoIso(2, 20),
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
      createdAt: daysAgoIso(4, 20),
      updatedAt: daysAgoIso(2, 20),
    },
    {
      id: "guest-todo-substack",
      subtaskId: subList.id,
      title: "Create the Substack publication",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(7, 18),
      updatedAt: daysAgoIso(7, 18),
    },
    {
      id: "guest-todo-invite",
      subtaskId: subList.id,
      title: "Text ten friends the signup link",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(7, 18),
      updatedAt: daysAgoIso(7, 18),
    },
    {
      id: "guest-todo-gym-cal",
      subtaskId: subGym.id,
      title: "Block Mon / Wed / Fri mornings on the calendar",
      isChecked: true,
      checkedAt: daysAgoIso(3, 7),
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 2,
      wasUnchecked: false,
      createdAt: daysAgoIso(10, 7),
      updatedAt: daysAgoIso(3, 7),
    },
    {
      id: "guest-todo-gym-backup",
      subtaskId: subGym.id,
      title: "Add a 30-min evening backup slot",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 1,
      wasUnchecked: false,
      createdAt: daysAgoIso(10, 7),
      updatedAt: daysAgoIso(10, 7),
    },
    {
      id: "guest-todo-run-route",
      subtaskId: subRun.id,
      title: "Pick Sunday route and set a 5k start",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 0,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(9, 8),
      updatedAt: daysAgoIso(9, 8),
    },
    {
      id: "guest-todo-run-shoes",
      subtaskId: subRun.id,
      title: "Check shoes are race-ready",
      isChecked: false,
      checkedAt: null,
      stalledNudgeShownAt: null,
      order: 1,
      viewCount: 0,
      wasUnchecked: false,
      createdAt: daysAgoIso(9, 8),
      updatedAt: daysAgoIso(9, 8),
    },
  ];

  return {
    version: 1 as const,
    updatedAt: now,
    ideate: {
      v: 2,
      dreams,
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
    },
    visionBoard,
    reflectionQuestions: {
      v: 1,
      questions: [
        {
          id: "guest-rq-regret",
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
          id: "guest-rq-become",
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
          id: "guest-rq-less-of",
          text: "What do you want less of?",
          description: "Habits, obligations, noise you’d gladly drop.",
          answer:
            "Evenings lost to scrolling, and saying yes to drinks when I’d rather sleep or train.",
          source: "preset",
          presetId: "less-of",
          createdAt: daysAgoIso(4, 10),
          updatedAt: daysAgoIso(2, 11),
        },
        {
          id: "guest-rq-five-years",
          text: "What would make the next five years feel well spent?",
          description: "One or two outcomes you’d be proud to point at.",
          answer:
            "A job I’m not ashamed of, a body that can run a 10k, and something I’ve published under my own name.",
          source: "preset",
          presetId: "five-years",
          createdAt: daysAgoIso(3, 14),
          updatedAt: daysAgoIso(1, 16),
        },
      ],
    },
    values: {
      v: 1,
      values: [
        {
          id: "guest-val-follow-through",
          text: "Follow-through",
          createdAt: daysAgoIso(10, 9),
          updatedAt: daysAgoIso(10, 9),
        },
        {
          id: "guest-val-health",
          text: "Health",
          createdAt: daysAgoIso(9, 11),
          updatedAt: daysAgoIso(9, 11),
        },
        {
          id: "guest-val-honesty",
          text: "Honesty",
          createdAt: daysAgoIso(8, 14),
          updatedAt: daysAgoIso(8, 14),
        },
        {
          id: "guest-val-family",
          text: "Family time",
          createdAt: daysAgoIso(7, 8),
          updatedAt: daysAgoIso(7, 8),
        },
        {
          id: "guest-val-money",
          text: "Financial clarity",
          createdAt: daysAgoIso(6, 10),
          updatedAt: daysAgoIso(6, 10),
        },
      ],
    },
    regrets: {
      v: 1,
      regrets: [
        {
          id: "guest-regret-publish",
          statement:
            "Never publishing anything under my own name — always “almost ready.”",
          category: "Creative",
          createdAt: daysAgoIso(8, 19),
          updatedAt: daysAgoIso(3, 19),
        },
        {
          id: "guest-regret-gym",
          statement:
            "Skipping the gym for months after telling myself I’d start next Monday.",
          category: "Health",
          createdAt: daysAgoIso(7, 8),
          updatedAt: daysAgoIso(2, 8),
        },
      ],
    },
    quotes: {
      v: 1,
      quotes: [
        {
          id: "guest-quote-done",
          text: "Done is better than perfect.",
          attribution: "Common saying",
          createdAt: daysAgoIso(9, 11),
          updatedAt: daysAgoIso(9, 11),
        },
        {
          id: "guest-quote-shots",
          text: "You miss 100% of the shots you don’t take.",
          attribution: "Wayne Gretzky",
          createdAt: daysAgoIso(6, 14),
          updatedAt: daysAgoIso(6, 14),
        },
        {
          id: "guest-quote-discipline",
          text: "Discipline is choosing between what you want now and what you want most.",
          attribution: "Anonymous",
          createdAt: daysAgoIso(4, 9),
          updatedAt: daysAgoIso(4, 9),
        },
      ],
    },
    manifesto: {
      v: 1,
      text: "I finish small honest steps — applications sent, issues published, sessions trained — instead of waiting for a perfect plan.",
      updatedAt: now,
    },
  };
}

function buildJournalEntries() {
  return [
    {
      id: "guest-journal-1",
      createdAt: daysAgoIso(1, 8),
      updatedAt: daysAgoIso(1, 8),
      title: "A quieter morning",
      mood: "calm",
      contentHtml:
        "<p>Woke without reaching for my phone. Made tea and sat by the window for ten minutes.</p><p>Noticed how loud my usual rush feels once I stop it — and how little of it was actually urgent.</p>",
    },
    {
      id: "guest-journal-2",
      createdAt: daysAgoIso(3, 21),
      updatedAt: daysAgoIso(3, 21),
      title: "What I keep putting off",
      mood: "mixed",
      contentHtml:
        "<p>The project I care about keeps sliding to “tomorrow.” When I look closer, it isn’t laziness — it’s fear of doing it imperfectly.</p><p>Tomorrow I’ll open the doc for fifteen minutes only. No finishing required.</p>",
    },
    {
      id: "guest-journal-3",
      createdAt: daysAgoIso(5, 7),
      updatedAt: daysAgoIso(5, 7),
      kind: "gratitude",
      title: "Three things",
      mood: "good",
      gratitude: [
        "A walk without headphones",
        "A message from someone who remembered",
        "Hot water and a clean mug",
      ],
      contentHtml:
        "<p>A walk without headphones</p><p>A message from someone who remembered</p><p>Hot water and a clean mug</p>",
    },
  ];
}

async function resolveJournalTable(): Promise<string> {
  const env = process.env.JOURNAL_TABLE_NAME?.trim();
  if (env) return env;
  const { DynamoDBClient: Raw, ListTablesCommand } = await import(
    "@aws-sdk/client-dynamodb"
  );
  const client = new Raw({});
  const out = await client.send(new ListTablesCommand({}));
  const name = (out.TableNames ?? []).find((t) => t.includes("JournalTable"));
  if (!name) throw new Error("Could not find JournalTable");
  return name;
}

async function ensureGuestUser(): Promise<string> {
  const got = await ddb.send(
    new GetCommand({
      TableName: USERS,
      Key: { email: GUEST_ACCOUNT_EMAIL },
    }),
  );
  if (typeof got.Item?.userId === "string" && got.Item.userId.trim()) {
    console.log("guest user", got.Item.userId);
    return got.Item.userId.trim();
  }
  const userId = randomUUID();
  const now = new Date().toISOString();
  if (dryRun) {
    console.log("[dry-run] would create user", userId);
    return userId;
  }
  await ddb.send(
    new PutCommand({
      TableName: USERS,
      Item: {
        email: GUEST_ACCOUNT_EMAIL,
        userId,
        displayName: GUEST_ACCOUNT_DISPLAY_NAME,
        createdAt: now,
        updatedAt: now,
        isGuestAccount: true,
      },
    }),
  );
  console.log("created guest user", userId);
  return userId;
}

async function putIdeate(userId: string) {
  console.log("uploading vision media…");
  const visionBoard = await buildVisionBoard(userId);
  const store = buildIdeateBundle(visionBoard);
  if (dryRun) {
    console.log("[dry-run] would put ideate", {
      dreams: store.ideate.dreams.length,
      subtasks: store.ideate.subtasks.length,
      todos: store.ideate.todos.length,
      values: store.values.values.length,
      visionTiles: visionBoard.items.length,
      self: Boolean(visionBoard.selfReference?.key),
    });
    return;
  }
  await ddb.send(
    new PutCommand({
      TableName: IDEATE,
      Item: {
        pk: userId,
        sk: "STORE",
        updatedAt: store.updatedAt,
        store,
      },
    }),
  );
  console.log("wrote ideate store", {
    dreams: store.ideate.dreams.length,
    visionTiles: visionBoard.items.length,
    values: store.values.values.length,
  });
}

async function putJournal(userId: string, table: string) {
  const entries = buildJournalEntries();
  if (dryRun) {
    console.log("[dry-run] would put journal", entries.length);
    return;
  }
  const puts = entries.map((e, listPosition) => ({
    PutRequest: {
      Item: {
        pk: userId,
        sk: `ENTRY#${e.id}`,
        ...e,
        listPosition,
      },
    },
  }));
  puts.push({
    PutRequest: {
      Item: {
        pk: userId,
        sk: "META",
        activeEntryId: entries[0]!.id,
      },
    },
  });
  await ddb.send(
    new BatchWriteCommand({
      RequestItems: { [table]: puts },
    }),
  );
  console.log("wrote journal entries", entries.length);
}

/** Copy pre-auth global library rows onto the guest user's partition. */
async function putLibrary(userId: string) {
  const guestPk = `USER#${userId}`;
  const rows: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: ANALYTICS,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "USER#_" },
        ExclusiveStartKey: startKey,
      }),
    );
    for (const item of out.Items ?? []) {
      if (typeof item.title === "string" && item.title.trim()) {
        rows.push(item);
      }
    }
    startKey = out.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  console.log("global library titled rows", rows.length);
  if (dryRun) {
    console.log("[dry-run] would copy", rows.length, "meditations to", guestPk);
    return;
  }

  const puts = rows.map((row) => ({
    PutRequest: {
      Item: {
        ...row,
        pk: guestPk,
      },
    },
  }));

  for (let i = 0; i < puts.length; i += 25) {
    const chunk = puts.slice(i, i + 25);
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: { [ANALYTICS]: chunk },
      }),
    );
  }
  console.log("wrote library meditations", puts.length, "→", guestPk);
}

async function main() {
  const userId = await ensureGuestUser();
  await putIdeate(userId);
  const journalTable = await resolveJournalTable();
  console.log("journal table", journalTable);
  await putJournal(userId, journalTable);
  await putLibrary(userId);
  console.log("done", {
    email: GUEST_ACCOUNT_EMAIL,
    userId,
    dryRun,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
