"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import * as Switch from "@radix-ui/react-switch";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  type MedimadeChatTurn,
  type MeditationDraftStateV1,
  type MeditationTargetMinutes,
  MEDITATION_DRAFT_STATE_VERSION,
  streamMedimadeChat,
  streamMeditationScript,
  createMeditationAudioJob,
  getMeditationAudioJobStatus,
  getMeditationDraft,
  getMedimadeApiBase,
  getMedimadeMediaBaseUrl,
  getMedimadeSessionJwt,
  fetchJournalStoreRemote,
  listBackgroundAudio,
  listFishSpeakers,
  saveMeditationDraft,
  backgroundAudioStreamingKey,
  type FishSpeaker,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
  speakerPreviewFxSampleKey,
  speakerPreviewLoudFxSampleKey,
  speakerPreviewLoudSampleKey,
} from "@/lib/speaker-sample-speed";
import {
  JOURNAL_CREATE_FIRST_MESSAGE,
  JOURNAL_MEDITATION_PAYLOAD_KEY,
  buildJournalHandoffApiContent,
  clearJournalMeditationHandoffJson,
  deriveEntryTitle,
  formatJournalEntryDate,
  journalEntryHasMeaningfulContent,
  journalEntryPlainForHandoff,
  loadJournalStore,
  parseJournalMeditationPayload,
  peekJournalMeditationHandoffJson,
  saveJournalStore,
  shouldPreferRemoteJournalStore,
  stripHtmlToText,
  type JournalEntry,
} from "@/lib/journal-storage";
import {
  PLAN_CREATE_FIRST_MESSAGE,
  PLAN_CREATE_OPENING_ASSISTANT,
  buildPlanCreateHandoffApiContent,
  clearPlanCreateHandoff,
  readPlanCreateHandoff,
} from "@/lib/plan-create-handoff";
import { loadPlanDreamsStore, type PlanDream } from "@/lib/plan-dreams";

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

const SPEAKER_SAMPLE_GAP_MS = 3000;

function parseMeditationTargetMinutes(raw: unknown): MeditationTargetMinutes {
  if (raw === 2 || raw === 5 || raw === 10) return raw;
  return 5;
}

type PendingLibraryGeneration = {
  jobId: string;
  createdAt: string;
  title: string;
  description: string | null;
  meditationStyle: string | null;
  speakerName: string | null;
  speakerModelId: string | null;
};

const PENDING_LIBRARY_GENERATIONS_LS_KEY = "mm_pending_library_generations_v1";

function loadPendingGenerations(): PendingLibraryGeneration[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(PENDING_LIBRARY_GENERATIONS_LS_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is PendingLibraryGeneration => {
      if (!x || typeof x !== "object") return false;
      const o = x as Record<string, unknown>;
      return (
        typeof o.jobId === "string" &&
        typeof o.createdAt === "string" &&
        typeof o.title === "string"
      );
    });
  } catch {
    return [];
  }
}

function savePendingGenerations(next: PendingLibraryGeneration[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PENDING_LIBRARY_GENERATIONS_LS_KEY,
      JSON.stringify(next.slice(0, 20)),
    );
  } catch {
    // ignore
  }
}

function maybeScrollChatToBottom(
  isAtBottomRef: React.MutableRefObject<boolean>,
  messagesEndRef: React.MutableRefObject<HTMLDivElement | null>,
) {
  if (!isAtBottomRef.current) return;
  // Ensure we scroll *after* React paints the updated streaming text.
  requestAnimationFrame(() => {
    if (!isAtBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    isAtBottomRef.current = true;
  });
}

function IconResetArrow({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Refresh icon (lucide refresh-cw) */}
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

function IconChevronLeft({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function IconGoalTarget({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" />
    </svg>
  );
}

const WORKSPACE_GENERATION_MODES = [
  { value: "style" as const, label: "Pick a meditation style" },
  { value: "freeflow" as const, label: "Free flow chat" },
  { value: "journalReflect" as const, label: "Reflect on a journal entry" },
  { value: "goal" as const, label: "Move towards a goal" },
];

/**
 * Lucide “flower-2” (lucide-static v0.460, ISC) — creation picker, pick a style.
 * @see https://lucide.dev/icons/flower-2
 */
function IconMeditationStyle({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5a3 3 0 1 1 3 3m-3-3a3 3 0 1 0-3 3m3-3v1M9 8a3 3 0 1 0 3 3M9 8h1m5 0a3 3 0 1 1-3 3m3-3h-1m-2 3v-1" />
      <circle cx="12" cy="8" r="2" />
      <path d="M12 10v12" />
      <path d="M12 22c4.2 0 7-1.667 7-5-4.2 0-7 1.667-7 5Z" />
      <path d="M12 22c-4.2 0-7-1.667-7-5 4.2 0 7 1.667 7 5Z" />
    </svg>
  );
}

/**
 * Lucide “messages-square” (lucide-static v0.460, ISC) — free-flow chat card.
 * @see https://lucide.dev/icons/messages-square
 */
function IconChatBubbles({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z" />
      <path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
    </svg>
  );
}

/**
 * Lucide “book-open-text” (lucide-static v0.460, ISC) — journal → meditation card.
 * @see https://lucide.dev/icons/book-open-text
 */
function IconJournalReflect({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 7v14" />
      <path d="M16 12h2" />
      <path d="M16 8h2" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />
      <path d="M6 12h2" />
      <path d="M6 8h2" />
    </svg>
  );
}

function IconPaperAirplane({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
  );
}

type SoloTrack = "speaker" | "nature" | "music" | "noise";

function PreviewPlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
    </svg>
  ) : (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

type JournalHandoffSegment = {
  entryId: string;
  title: string;
  bodyPlain: string;
  createdAt?: string;
};

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  /** Distinct styling for generated meditation script vs coach replies. */
  variant?: "chat" | "script";
  muted?: boolean;
  kind?: "divider";
  /** When set on a user message, render expandable journal entry cards below `text`. */
  journalSegments?: JournalHandoffSegment[];
};

const meditationStyles = [
  "Body scan",
  "Visualization",
  "Breath-led",
  "Manifestation",
  "Affirmation loop",
  "Story",
  "Reflection",
  "Sleep",
  "Loving-kindness",
  "Anxiety relief",
  "Movement meditation",
  "Open awareness",
];

const meditationStyleTooltip: Record<(typeof meditationStyles)[number], string> = {
  "Body scan":
    "Slowly move attention through the body to release tension and build calm awareness.",
  Visualization:
    "Guided imagery to shift mood, build confidence, or rehearse a desired state.",
  "Breath-led":
    "Breath-focused practice to steady attention and regulate the nervous system.",
  Manifestation:
    "Intention-setting with vivid future focus; supportive, motivating tone.",
  "Affirmation loop":
    "Repetitive positive statements to reinforce belief, safety, and self-trust.",
  Story:
    "A calm, guided narrative with sensory detail and emotional resolution.",
  Reflection:
    "A gentle reflective practice to process experience and clarify what matters.",
  Sleep:
    "Gentle, slower pacing designed to help you wind down and drift off.",
  "Loving-kindness":
    "Warm, compassionate phrases for yourself and others (metta practice).",
  "Anxiety relief":
    "Grounding cues + reassurance to reduce anxious arousal and regain steadiness.",
  "Movement meditation":
    "Slow, mindful movement or walking—attention anchored in the body in motion.",
  "Open awareness":
    "Resting in a wide, receptive field—sounds, sensations, and thoughts without fixing on one object.",
};

type Phase = "style" | "feeling" | "claude" | "journalPick" | "goalPick";

/** Before chat: user picks style-first vs free-flow vs journal-reflect creation. */
type CreationPath =
  | "pending"
  | "style"
  | "freeflow"
  | "journalReflect"
  | "goal";

function inferCreationPathFromDraft(
  s: MeditationDraftStateV1,
): "style" | "freeflow" {
  if (s.journalMode === true) return "freeflow";
  if (s.journalMode === false) return "style";
  if (s.phase === "style") return "style";
  const st = s.meditationStyle?.trim();
  if (st && st !== "General") return "style";
  return "freeflow";
}

const OPENING_STYLE =
  "What style of meditation should we build? Pick one below or describe your own.";
const OPENING_JOURNAL = "What’s on your mind?";

const JOURNAL_REFLECT_PICK_INTRO =
  "Which journal entry would you like to reflect on?";

const GOAL_PICK_INTRO = "Which goal would you like to move towards?";
const OPENING_GOAL =
  "Great. I’ll write a visualization and manifestation-style meditation around this goal.\n\nBefore I draft anything: what would success look like, and what would it feel like in your body?";

function reflectableJournalEntriesForPicker(entries: JournalEntry[]): JournalEntry[] {
  return entries
    .filter(journalEntryHasMeaningfulContent)
    .sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    )
    .slice(0, 25);
}

function chatMessageTranscriptLine(m: ChatMessage): string {
  if (m.role === "user" && m.journalSegments?.length) {
    return buildJournalHandoffApiContent(m.journalSegments);
  }
  return m.text;
}

type PlanTask = {
  id: string;
  title: string;
  done: boolean;
};

type PlanGoal = {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  tasks: PlanTask[];
};

type PlanStateV1 = {
  v: 1;
  goals: PlanGoal[];
};

function dreamToPlanGoal(d: PlanDream): PlanGoal {
  const parts: string[] = [];
  if (d.dreamText.trim()) parts.push(d.dreamText.trim());
  if (d.obstacleText.trim()) {
    parts.push(`What's in the way:\n${d.obstacleText.trim()}`);
  }
  if (d.visionText.trim()) {
    parts.push(`Vision:\n${d.visionText.trim()}`);
  }
  const description =
    parts.join("\n\n").trim().slice(0, 12000) || d.firstThought.trim();
  return {
    id: d.id,
    title: d.title.trim() || "Untitled",
    description,
    createdAt: d.createdAt,
    tasks: [],
  };
}

function loadPlanGoals(): PlanGoal[] {
  if (typeof window === "undefined") return [];
  const dreamRows = loadPlanDreamsStore().dreams.map(dreamToPlanGoal);
  const dreamIds = new Set(dreamRows.map((g) => g.id));
  let legacy: PlanGoal[] = [];
  try {
    const raw = window.localStorage.getItem("mm_plan_v1");
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const o = parsed as Partial<PlanStateV1>;
        if (o.v === 1 && Array.isArray(o.goals)) {
          legacy = (o.goals as PlanGoal[])
            .filter(
              (g) => g && typeof g.id === "string" && typeof g.title === "string",
            )
            .slice(0, 50);
        }
      }
    }
  } catch {
    legacy = [];
  }
  return [...dreamRows, ...legacy.filter((g) => !dreamIds.has(g.id))];
}

function JournalHandoffEntryCards({
  segments,
}: {
  segments: JournalHandoffSegment[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <ul className="mt-3 space-y-2 border-t border-border/70 pt-3">
      {segments.map((s) => {
        const open = openId === s.entryId;
        return (
          <li
            key={s.entryId}
            className="rounded-lg border border-border bg-background/90 px-3 py-2 text-left"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground">{s.title}</div>
                {s.createdAt ? (
                  <div className="mt-0.5 text-xs text-muted">
                    Created {formatJournalEntryDate(s.createdAt)}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpenId(open ? null : s.entryId)}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent-soft/40"
              >
                {open ? "Collapse" : "Expand"}
              </button>
            </div>
            {open ? (
              <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">
                {s.bodyPlain.trim() ? s.bodyPlain : "(Empty entry)"}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function isMedimadeTurnLike(x: unknown): x is MedimadeChatTurn {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return false;
  if (typeof o.content !== "string") return false;
  return true;
}

function isChatMessageLike(
  x: unknown,
): x is ChatMessage {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return false;
  if (typeof o.text !== "string") return false;
  if (
    o.variant != null &&
    o.variant !== "chat" &&
    o.variant !== "script"
  ) {
    return false;
  }
  if (o.journalSegments != null) {
    if (!Array.isArray(o.journalSegments)) return false;
    for (const s of o.journalSegments) {
      if (!s || typeof s !== "object") return false;
      const q = s as Record<string, unknown>;
      if (typeof q.entryId !== "string") return false;
      if (typeof q.title !== "string") return false;
      if (typeof q.bodyPlain !== "string") return false;
      if (q.createdAt != null && typeof q.createdAt !== "string") return false;
    }
  }
  return true;
}

function isDraftStateV1(raw: unknown): raw is MeditationDraftStateV1 {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  if (o.v !== MEDITATION_DRAFT_STATE_VERSION) return false;
  if (o.phase !== "style" && o.phase !== "feeling" && o.phase !== "claude") {
    return false;
  }
  if (!Array.isArray(o.messages) || !o.messages.every(isChatMessageLike)) {
    return false;
  }
  if (
    !Array.isArray(o.claudeThread) ||
    !o.claudeThread.every(isMedimadeTurnLike)
  ) {
    return false;
  }
  if (typeof o.input !== "string") return false;
  if (typeof o.speechSpeed !== "number" || !Number.isFinite(o.speechSpeed)) {
    return false;
  }
  if (typeof o.speakerModelId !== "string") return false;
  if (typeof o.backgroundNatureKey !== "string") return false;
  if (typeof o.backgroundMusicKey !== "string") return false;
  // Back-compat: older drafts stored drums; new drafts store noise.
  const drumsKeyOk = typeof o.backgroundDrumsKey === "string";
  const noiseKeyOk = typeof o.backgroundNoiseKey === "string";
  if (!drumsKeyOk && !noiseKeyOk) return false;
  if (
    typeof o.backgroundNatureGain !== "number" ||
    !Number.isFinite(o.backgroundNatureGain)
  ) {
    return false;
  }
  if (
    typeof o.backgroundMusicGain !== "number" ||
    !Number.isFinite(o.backgroundMusicGain)
  ) {
    return false;
  }
  const drumsGainOk =
    typeof o.backgroundDrumsGain === "number" &&
    Number.isFinite(o.backgroundDrumsGain);
  const noiseGainOk =
    typeof o.backgroundNoiseGain === "number" &&
    Number.isFinite(o.backgroundNoiseGain);
  if (!drumsGainOk && !noiseGainOk) return false;
  if (o.mobileCreateStep !== "chat" && o.mobileCreateStep !== "audio") {
    return false;
  }
  if (o.meditationStyle != null && typeof o.meditationStyle !== "string") {
    return false;
  }
  if (o.lastUsedScript != null && typeof o.lastUsedScript !== "string") {
    return false;
  }
  if (o.meditationTargetMinutes != null) {
    if (o.meditationTargetMinutes !== 2 && o.meditationTargetMinutes !== 5 && o.meditationTargetMinutes !== 10) {
      return false;
    }
  }
  return true;
}

type CreateWorkspaceProps = {
  initialDraftSk?: string | null;
  /** When true, read journal → create handoff from sessionStorage once (if no draft). */
  seedJournalContext?: boolean;
  /** When true, read Plan → create handoff from sessionStorage once (if no draft). */
  seedPlanContext?: boolean;
};

function getStyleFollowupQuestion(style: string): string {
  const s = style.trim().toLowerCase();
  if (s === "manifestation") {
    return "What do you want to manifest—and what would a “win” look like in real life?";
  }
  if (s === "visualization") {
    return "What do you want to visualize—where are you, and what’s the first vivid detail you can picture?";
  }
  if (s === "affirmation loop" || s === "affirmations" || s === "affirmation") {
    return "How do you want to feel when you’re done—and what words would land gently for you right now?";
  }
  if (s === "sleep") {
    return "What’s keeping you awake tonight—and how do you want to feel as you drift off?";
  }
  if (s === "loving-kindness" || s === "loving kindness" || s === "metta") {
    return "Who would you like to send kindness to today—yourself, someone else, or both?";
  }
  if (s === "anxiety relief" || s === "anxiety") {
    return "What’s the main worry or pressure right now—and what would feel like relief by the end of this session?";
  }
  if (s === "breath-led" || s === "breath led" || s === "breath") {
    return "Do you want a breathwork-style session, or a simple “follow your breath” meditation?";
  }
  if (s === "body scan" || s === "bodyscan") {
    return "Where are you holding the most tension right now—and what would you like to soften first?";
  }
  if (s === "movement meditation" || s === "walking meditation") {
    return "Do you imagine moving in place, walking slowly, or something else—and what do you want your body to feel by the end?";
  }
  if (s === "open awareness") {
    return "What tends to pull your attention away most—and how would you like to relate to that during this practice?";
  }
  if (s === "story") {
    return "What kind of journey or scene should this story hold—and what feeling do you want to land on by the end?";
  }
  if (s === "reflection") {
    return "What are you processing or wondering about—and what would feel like a helpful insight or shift when you’re done?";
  }
  const trimmed = style.trim();
  if (trimmed) {
    return `How are you feeling today—and what do you want this “${trimmed}” meditation to support?`;
  }
  return "How are you feeling today—and what do you want this meditation to support?";
}

export function CreateWorkspace({
  initialDraftSk = null,
  seedJournalContext = false,
  seedPlanContext = false,
}: CreateWorkspaceProps) {
  const router = useRouter();
  const isRedirectingToLibraryRef = useRef(false);
  const seedFromHandoff = seedJournalContext || seedPlanContext;
  const [mobileCreateStep, setMobileCreateStep] = useState<"chat" | "audio">(
    "chat",
  );
  /** 0 = chooser, 1 = script/chat, 2 = audio — same horizontal strip at every viewport width. */
  const [createStripStep, setCreateStripStep] = useState<0 | 1 | 2>(() =>
    seedFromHandoff ? 1 : 0,
  );

  // Reduce perceived navigation latency (and any browser "redirecting" UI) by prefetching Library.
  useEffect(() => {
    router.prefetch("/meditate/library");
  }, [router]);

  const [phase, setPhase] = useState<Phase>(() =>
    seedFromHandoff ? "claude" : "style",
  );
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioModalUrl, setAudioModalUrl] = useState<string | null>(null);
  const [audioModalKey, setAudioModalKey] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lastUsedScript, setLastUsedScript] = useState<string | null>(null);
  const speechSpeed = FIXED_SPEECH_PREVIEW_SPEED;
  const [meditationTargetMinutes, setMeditationTargetMinutes] =
    useState<MeditationTargetMinutes>(5);
  /** When on, speaker row plays CDN `*-fx.wav` (Pedalboard preset mixer); when off, dry Fish `*.mp3`. */
  const [speakerFxPreviewOn, setSpeakerFxPreviewOn] = useState(true);
  const [backgroundNature, setBackgroundNature] = useState<
    BackgroundAudioItem[]
  >([]);
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundNoise, setBackgroundNoise] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);
  const [backgroundNatureKey, setBackgroundNatureKey] = useState<string>("");
  const [backgroundMusicKey, setBackgroundMusicKey] = useState<string>("");
  const [backgroundNoiseKey, setBackgroundNoiseKey] = useState<string>("");
  const [backgroundNatureGain, setBackgroundNatureGain] = useState(25);
  const [backgroundMusicGain, setBackgroundMusicGain] = useState(50);
  const [backgroundNoiseGain, setBackgroundNoiseGain] = useState(10);
  const [playAllActive, setPlayAllActive] = useState(false);
  const [playing, setPlaying] = useState<Record<SoloTrack, boolean>>({
    speaker: false,
    nature: false,
    music: false,
    noise: false,
  });
  const previewNatureRef = useRef<HTMLAudioElement | null>(null);
  const previewMusicRef = useRef<HTMLAudioElement | null>(null);
  const previewNoiseRef = useRef<HTMLAudioElement | null>(null);
  const speakerSampleRef = useRef<HTMLAudioElement | null>(null);
  const speakerGapTimeoutRef = useRef<number | null>(null);
  const speakerRepeatWantedRef = useRef(false);
  const lastBgKeysRef = useRef<{ nature: string; music: string; noise: string }>({
    nature: "",
    music: "",
    noise: "",
  });
  // Speakers come from backend `GET /fish/speakers` (single source of truth).
  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "", variant: "chat" },
  ]);
  const [introTypingDone, setIntroTypingDone] = useState(false);
  /** Bumped on reset so intro typing re-runs even when `messages.length` stays 1. */
  const [introTypingSession, setIntroTypingSession] = useState(0);
  const introTypingTimerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [input, setInput] = useState("");
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const initialChatAutofocusDoneRef = useRef(false);
  const [speakerModelId, setSpeakerModelId] = useState<string>("");
  const [journalMode, setJournalMode] = useState(() => Boolean(seedFromHandoff));
  const [creationPath, setCreationPath] = useState<CreationPath>(() =>
    seedFromHandoff ? "freeflow" : "pending",
  );
  /** Which full-width section to show; pending path always maps to chooser (avoids strip/chat flash races). */
  const workspaceSectionStep: 0 | 1 | 2 =
    creationPath === "pending" ? 0 : createStripStep;

  useEffect(() => {
    if (creationPath === "pending") {
      setMobileCreateStep("chat");
      return;
    }
    setMobileCreateStep(createStripStep === 2 ? "audio" : "chat");
  }, [creationPath, createStripStep]);

  /** On the first screen: which path is selected before tapping “Script”. */
  const [pendingModeChoice, setPendingModeChoice] = useState<
    null | "style" | "freeflow" | "journalReflect" | "goal"
  >(null);
  const [workspaceModeMenuOpen, setWorkspaceModeMenuOpen] = useState(false);
  const workspaceModeMenuRef = useRef<HTMLDivElement>(null);
  const chooserCardsRef = useRef<HTMLDivElement | null>(null);
  /** Default to 2×2 until measured — avoids a one-frame “skinny 4-up” layout. */
  const [chooserLayout, setChooserLayout] = useState<"row4" | "grid2">("grid2");
  /** Journal list for Create chooser + in-chat reflect picker (local + optional cloud). */
  const [journalPickerEntries, setJournalPickerEntries] = useState<JournalEntry[]>(
    [],
  );
  const [journalPickerListReady, setJournalPickerListReady] = useState(false);
  const [journalReflectSelectedIds, setJournalReflectSelectedIds] = useState(
    () => new Set<string>(),
  );
  const [planGoals, setPlanGoals] = useState<PlanGoal[]>([]);
  const [planGoalsReady, setPlanGoalsReady] = useState(false);
  const [goalSelectedId, setGoalSelectedId] = useState<string | null>(null);

  const [draftSk, setDraftSk] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);

  const soundControlsDisabled =
    audioLoading && !isRedirectingToLibraryRef.current;
  const chatControlsDisabled =
    audioLoading && !isRedirectingToLibraryRef.current;
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);
  /**
   * When `?draftSk=` is present, stays false until the draft fetch finishes (shows “Loading draft…”).
   * Starts false always so the first paint matches `useSearchParams()` resolving: if `draftSk` appears
   * only after mount, we never briefly show the chooser then jump to chat.
   */
  const [draftHydrated, setDraftHydrated] = useState(false);

  useEffect(() => {
    if (initialChatAutofocusDoneRef.current) return;
    if (chatControlsDisabled) return;
    if (workspaceSectionStep !== 1) return;
    initialChatAutofocusDoneRef.current = true;
    focusChatInput();
  }, [chatControlsDisabled, workspaceSectionStep]);

  function buildDraftState(): MeditationDraftStateV1 {
    const phaseForDraft: MeditationDraftStateV1["phase"] =
      phase === "journalPick" || phase === "goalPick" ? "feeling" : phase;
    return {
      v: MEDITATION_DRAFT_STATE_VERSION,
      phase: phaseForDraft,
      meditationStyle,
      messages,
      claudeThread,
      input,
      speechSpeed,
      speakerModelId,
      backgroundNatureKey: backgroundAudioStreamingKey(backgroundNatureKey),
      backgroundMusicKey: backgroundAudioStreamingKey(backgroundMusicKey),
      // Stored as noise; old drafts used drums.
      backgroundNoiseKey: backgroundAudioStreamingKey(backgroundNoiseKey),
      backgroundNatureGain,
      backgroundMusicGain,
      backgroundNoiseGain,
      mobileCreateStep,
      lastUsedScript,
      meditationTargetMinutes,
      journalMode: journalMode === true,
    };
  }

  async function saveCurrentDraft() {
    if (draftSaving) return;
    setDraftSaving(true);
    setDraftSaveMessage(null);
    try {
      const out = await saveMeditationDraft({
        sk: draftSk,
        meditationStyle,
        draftState: buildDraftState(),
      });
      setDraftSk(out.sk);
      setDraftSaveMessage("Draft saved to Library → Drafts.");
    } catch (e) {
      setDraftSaveMessage(
        e instanceof Error ? e.message : "Could not save draft",
      );
    } finally {
      setDraftSaving(false);
    }
  }

  useEffect(() => {
    if (!draftSaveMessage) return;
    const t = window.setTimeout(() => setDraftSaveMessage(null), 5000);
    return () => window.clearTimeout(t);
  }, [draftSaveMessage]);

  useEffect(() => {
    const sk = initialDraftSk?.trim();
    if (!sk) {
      setDraftHydrated(true);
      return;
    }
    setDraftHydrated(false);
    let cancelled = false;
    setDraftLoadError(null);
    void (async () => {
      try {
        const row = await getMeditationDraft(sk);
        if (cancelled) return;
        if (!isDraftStateV1(row.draftState)) {
          setDraftLoadError(
            "This draft could not be loaded (unrecognized format).",
          );
          if (!cancelled) setDraftHydrated(true);
          return;
        }
        const s = row.draftState as MeditationDraftStateV1 & {
          backgroundDrumsKey?: string;
          backgroundDrumsGain?: number;
        };
        setPhase(s.phase);
        setMeditationStyle(s.meditationStyle);
        setMessages(s.messages);
        setClaudeThread(s.claudeThread);
        setInput(s.input);
        setSpeakerModelId(s.speakerModelId);
        setBackgroundNatureKey(
          backgroundAudioStreamingKey(s.backgroundNatureKey),
        );
        setBackgroundMusicKey(
          backgroundAudioStreamingKey(s.backgroundMusicKey),
        );
        // Back-compat: if noise wasn't saved yet, reuse drums selection.
        setBackgroundNoiseKey(
          backgroundAudioStreamingKey(
            s.backgroundNoiseKey ?? s.backgroundDrumsKey ?? "",
          ),
        );
        setBackgroundNatureGain(s.backgroundNatureGain);
        setBackgroundMusicGain(s.backgroundMusicGain);
        setBackgroundNoiseGain(
          s.backgroundNoiseGain ?? s.backgroundDrumsGain ?? 10,
        );
        setMobileCreateStep(s.mobileCreateStep);
        setLastUsedScript(s.lastUsedScript);
        setMeditationTargetMinutes(parseMeditationTargetMinutes(s.meditationTargetMinutes));
        const path = inferCreationPathFromDraft(s);
        setCreationPath(path);
        setJournalMode(path === "freeflow");
        setCreateStripStep(s.mobileCreateStep === "audio" ? 2 : 1);
        setDraftSk(row.sk);
        if (!cancelled) setDraftHydrated(true);
      } catch (e) {
        if (!cancelled) {
          setDraftLoadError(
            e instanceof Error ? e.message : "Could not load draft",
          );
          setDraftHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDraftSk]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const local = loadJournalStore().entries;
    setJournalPickerEntries(local);

    const base = getMedimadeApiBase();
    if (!base || !getMedimadeSessionJwt()) {
      setJournalPickerListReady(true);
      return;
    }
    void (async () => {
      try {
        const remote = await fetchJournalStoreRemote();
        if (cancelled || !remote) return;
        setJournalPickerEntries((prev) => {
          if (shouldPreferRemoteJournalStore(remote, prev)) {
            saveJournalStore(remote);
            return remote.entries;
          }
          return prev;
        });
      } catch {
        /* offline or no journal yet */
      } finally {
        if (!cancelled) setJournalPickerListReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasReflectableJournal = useMemo(
    () => journalPickerEntries.some(journalEntryHasMeaningfulContent),
    [journalPickerEntries],
  );
  const hasPlanGoals = useMemo(() => planGoals.length > 0, [planGoals.length]);

  useEffect(() => {
    if (pendingModeChoice !== "journalReflect") return;
    if (!journalPickerListReady) return;
    if (!hasReflectableJournal) setPendingModeChoice(null);
  }, [pendingModeChoice, journalPickerListReady, hasReflectableJournal]);

  useEffect(() => {
    if (pendingModeChoice !== "goal") return;
    if (!planGoalsReady) return;
    if (!hasPlanGoals) setPendingModeChoice(null);
  }, [pendingModeChoice, planGoalsReady, hasPlanGoals]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setPlanGoals(loadPlanGoals());
    setPlanGoalsReady(true);
    const onFocus = () => setPlanGoals(loadPlanGoals());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = chooserCardsRef.current;
    if (!el) return;
    // Only use 4-across when each card can stay ~as wide as the old 3-card row (~300px+).
    // Typical `max-w-6xl` viewports then use the 2×2 square grid instead of skinny quarters.
    const CARD_MIN_PX = 300;
    const GAP_PX = 24; // md:gap-6
    const compute = () => {
      const w = el.getBoundingClientRect().width;
      const need = CARD_MIN_PX * 4 + GAP_PX * 3;
      setChooserLayout(w >= need ? "row4" : "grid2");
    };
    compute();
    const ro = new ResizeObserver(() => compute());
    ro.observe(el);
    return () => ro.disconnect();
  }, [workspaceSectionStep]);

  /** Chooser cards + chat header select stay aligned with the active path. */
  useEffect(() => {
    if (creationPath === "pending") return;
    if (creationPath === "style") setPendingModeChoice("style");
    else if (creationPath === "freeflow") setPendingModeChoice("freeflow");
    else if (creationPath === "journalReflect") setPendingModeChoice("journalReflect");
    else if (creationPath === "goal") setPendingModeChoice("goal");
  }, [creationPath]);

  useEffect(() => {
    if (!workspaceModeMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const el = workspaceModeMenuRef.current;
      if (el && !el.contains(e.target as Node)) setWorkspaceModeMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setWorkspaceModeMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [workspaceModeMenuOpen]);

  useEffect(() => {
    if (!seedJournalContext) return;
    if (seedPlanContext) return;
    const sk = initialDraftSk?.trim();
    if (sk) {
      try {
        sessionStorage.removeItem(JOURNAL_MEDITATION_PAYLOAD_KEY);
        clearJournalMeditationHandoffJson();
      } catch {
        /* ignore */
      }
      router.replace("/meditate/create");
      return;
    }

    let rawJson: string | null = null;
    try {
      rawJson =
        peekJournalMeditationHandoffJson() ??
        sessionStorage.getItem(JOURNAL_MEDITATION_PAYLOAD_KEY);
    } catch {
      rawJson = null;
    }

    router.replace("/meditate/create");

    const payload = parseJournalMeditationPayload(rawJson);
    if (!payload?.segments.length) {
      clearJournalMeditationHandoffJson();
      try {
        sessionStorage.removeItem(JOURNAL_MEDITATION_PAYLOAD_KEY);
      } catch {
        /* ignore */
      }
      return;
    }

    const styleHint = "General";
    const journalCards: JournalHandoffSegment[] = payload.segments.map((s) => ({
      entryId: s.entryId,
      title: s.title,
      bodyPlain: s.bodyPlain,
      ...(s.createdAt ? { createdAt: s.createdAt } : {}),
    }));
    const apiUserContent = buildJournalHandoffApiContent(payload.segments);
    const history: MedimadeChatTurn[] = [
      { role: "assistant", content: OPENING_JOURNAL },
      { role: "user", content: apiUserContent },
    ];

    setCreationPath("freeflow");
    setJournalMode(true);
    setIntroTypingDone(true);
    setPhase("claude");
    setMeditationStyle(styleHint);
    setClaudeThread([]);
    setInput("");
    setMessages([
      {
        role: "user",
        text: JOURNAL_CREATE_FIRST_MESSAGE,
        journalSegments: journalCards,
      },
    ]);
    setChatLoading(true);

    void (async () => {
      try {
        let acc = "";
        let assistantBubbleStarted = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
            meditationTargetMinutes,
          },
          (d) => {
            acc += d;
            if (!assistantBubbleStarted) {
              assistantBubbleStarted = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            }
          },
        );
        setClaudeThread([...history, { role: "assistant", content: text }]);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Sorry — ${msg}` },
        ]);
      } finally {
        clearJournalMeditationHandoffJson();
        try {
          sessionStorage.removeItem(JOURNAL_MEDITATION_PAYLOAD_KEY);
        } catch {
          /* ignore */
        }
        setChatLoading(false);
        requestAnimationFrame(() => {
          chatInputRef.current?.focus();
        });
      }
    })();
  }, [seedJournalContext, seedPlanContext, initialDraftSk, router]);

  useEffect(() => {
    if (!seedPlanContext) return;
    if (seedJournalContext) return;
    const sk = initialDraftSk?.trim();
    if (sk) {
      try {
        clearPlanCreateHandoff();
      } catch {
        /* ignore */
      }
      router.replace("/meditate/create");
      return;
    }

    const handoff = readPlanCreateHandoff();
    router.replace("/meditate/create");

    const vision = handoff?.visionText?.trim() ?? "";
    if (!handoff || !vision) {
      clearPlanCreateHandoff();
      return;
    }

    const apiUserContent = buildPlanCreateHandoffApiContent(handoff);
    const styleHint = "Visualization";
    const history: MedimadeChatTurn[] = [
      { role: "assistant", content: PLAN_CREATE_OPENING_ASSISTANT },
      { role: "user", content: apiUserContent },
    ];

    setCreationPath("freeflow");
    setJournalMode(true);
    setIntroTypingDone(true);
    setPhase("claude");
    setMeditationStyle(styleHint);
    setClaudeThread([]);
    setInput("");
    setMessages([
      {
        role: "user",
        text: PLAN_CREATE_FIRST_MESSAGE,
        variant: "chat",
      },
    ]);
    setChatLoading(true);

    void (async () => {
      try {
        let acc = "";
        let assistantBubbleStarted = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
            meditationTargetMinutes,
          },
          (d) => {
            acc += d;
            if (!assistantBubbleStarted) {
              assistantBubbleStarted = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            }
          },
        );
        setClaudeThread([...history, { role: "assistant", content: text }]);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Sorry — ${msg}` },
        ]);
      } finally {
        clearPlanCreateHandoff();
        setChatLoading(false);
        requestAnimationFrame(() => {
          chatInputRef.current?.focus();
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot Plan→Create handoff; avoid re-running when session length changes.
  }, [seedPlanContext, seedJournalContext, initialDraftSk, router]);

  useEffect(() => {
    void listFishSpeakers()
      .then((sp) => {
        if (!sp || sp.length === 0) return;
        setFishSpeakers(sp);
        // If current selection isn't valid anymore, pick Emily, else first.
        const emily = sp.find((s) => s.name.toLowerCase() === "emily");
        setSpeakerModelId((current) => {
          if (sp.some((s) => s.modelId === current)) return current;
          return emily?.modelId ?? sp[0].modelId;
        });
      })
      .catch(() => {
        // Keep existing fallback constants if the endpoint isn't reachable.
      });
  }, []);

  async function generateScript() {
    if (scriptLoading) return;
    // Treat mode switches as a new chat: ignore any muted history + dividers + prior scripts.
    const transcript = messages
      .filter((m) => !m.muted && m.kind !== "divider" && m.variant !== "script")
      .map(
        (m) =>
          `${m.role === "user" ? "User" : "Guide"}: ${chatMessageTranscriptLine(m)}`,
      )
      .join("\n\n");
    setScriptLoading(true);
    try {
      let acc = "";
      let assistantBubbleStarted = false;
      await streamMeditationScript(
        {
          meditationStyle,
          transcript,
          journalMode: journalMode === true,
          meditationTargetMinutes,
          speechSpeed,
        },
        (d) => {
          acc += d;
          if (!assistantBubbleStarted) {
            assistantBubbleStarted = true;
            setMessages((m) => [
              ...m,
              { role: "assistant", text: acc, variant: "script" },
            ]);
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          } else {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (
                last?.role !== "assistant" ||
                last.variant !== "script"
              ) {
                return m;
              }
              next[next.length - 1] = {
                role: "assistant",
                text: acc,
                variant: "script",
              };
              return next;
            });
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          }
        },
      );
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not generate script.";
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Sorry — ${msg}`, variant: "chat" },
      ]);
    } finally {
      setScriptLoading(false);
    }
  }

  useEffect(() => {
    // Only re-scroll when the user was already at the bottom.
    // This keeps streaming Claude output visible without yanking the user if they scrolled up.
    if (!isAtBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({
      behavior: "auto",
      block: "end",
    });
    // After we scroll, we know we're at the bottom again.
    const el = chatScrollRef.current;
    if (el) isAtBottomRef.current = true;
  }, [messages.length]);

  function pickStyle(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setMeditationStyle(trimmed);
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setPhase("feeling");
    setInput("");

    const style = trimmed;
    const history: MedimadeChatTurn[] = [{ role: "user", content: trimmed }];
    let acc = "";
    let assistantBubbleStarted = false;

    setClaudeThread(history);
    setChatLoading(true);

    void streamMedimadeChat(
      {
        meditationStyle: style,
        messages: history,
        journalMode: journalMode === true,
        meditationTargetMinutes,
      },
      (d) => {
        acc += d;
        if (!assistantBubbleStarted) {
          assistantBubbleStarted = true;
          setMessages((m) => [...m, { role: "assistant", text: acc }]);
          maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
        } else {
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last?.role !== "assistant") return m;
            next[next.length - 1] = { role: "assistant", text: acc };
            return next;
          });
          maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
        }
      },
    )
      .then((text) => {
        setClaudeThread([...history, { role: "assistant", content: text }]);
      })
      .catch((e) => {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Sorry — ${msg}`,
          },
        ]);
      })
      .finally(() => {
        setChatLoading(false);
      });
  }

  function clearIntroTyping() {
    if (introTypingTimerRef.current !== null) {
      window.clearInterval(introTypingTimerRef.current);
      introTypingTimerRef.current = null;
    }
  }

  function startIntroTyping(messageIndex: number, fullText: string) {
    clearIntroTyping();
    setIntroTypingDone(false);
    let i = 0;
    const tickMs = 14;
    introTypingTimerRef.current = window.setInterval(() => {
      i += 1;
      setMessages((prev) => {
        if (!prev[messageIndex] || prev[messageIndex].role !== "assistant") return prev;
        const next = [...prev];
        next[messageIndex] = { ...next[messageIndex], text: fullText.slice(0, i) };
        return next;
      });
      if (i >= fullText.length) {
        clearIntroTyping();
        setIntroTypingDone(true);
      }
    }, tickMs);
  }

  // Simulate Claude-style streaming for the *opening* guide messages only.
  useEffect(() => {
    if (creationPath === "pending") return;
    // Only when we are at the start of a mode (style, journal feeling, or journal pick) and not already chatting.
    if (chatLoading || scriptLoading) return;
    const introTypingPhase =
      phase === "style" ||
      (journalMode && phase === "feeling" && !meditationStyle) ||
      (phase === "journalPick" && creationPath === "journalReflect") ||
      (phase === "goalPick" && creationPath === "goal");
    if (!introTypingPhase) return;
    const idx = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.kind === "divider") continue;
        if (m.role === "assistant" && m.variant !== "script" && !m.muted) return i;
        break;
      }
      return -1;
    })();
    if (idx < 0) return;
    const opening =
      phase === "journalPick" && creationPath === "journalReflect"
        ? JOURNAL_REFLECT_PICK_INTRO
        : phase === "goalPick" && creationPath === "goal"
          ? GOAL_PICK_INTRO
        : journalMode && phase === "feeling" && !meditationStyle
          ? OPENING_JOURNAL
          : OPENING_STYLE;
    const m = messages[idx];
    if (m.text === opening) {
      setIntroTypingDone(true);
      return;
    }
    // Only type if the message is empty (fresh) or equals one of the opening strings.
    if (
      m.text.trim().length === 0 ||
      m.text === OPENING_STYLE ||
      m.text === OPENING_JOURNAL ||
      m.text === JOURNAL_REFLECT_PICK_INTRO ||
      m.text === GOAL_PICK_INTRO
    ) {
      startIntroTyping(idx, opening);
    }
    return () => {
      clearIntroTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    creationPath,
    phase,
    journalMode,
    meditationStyle,
    chatLoading,
    scriptLoading,
    messages.length,
    introTypingSession,
  ]);

  function focusChatInput() {
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  }

  function resetChatKeepMode() {
    // Keep creation path / journal mode as-is; reset chat and retrigger the intro typing animation.
    setChatLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setIntroTypingSession((s) => s + 1);
    if (creationPath === "journalReflect") {
      const recent = reflectableJournalEntriesForPicker(journalPickerEntries);
      const next = new Set<string>();
      for (let i = 0; i < Math.min(3, recent.length); i += 1) {
        next.add(recent[i].id);
      }
      setJournalReflectSelectedIds(next);
      setPhase("journalPick");
      setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    } else if (creationPath === "goal") {
      setGoalSelectedId(null);
      setPhase("goalPick");
      setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    } else {
      setMessages([{ role: "assistant", text: "", variant: "chat" }]);
      setPhase(journalMode ? "feeling" : "style");
    }
    isAtBottomRef.current = true;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    focusChatInput();
  }

  function beginStylePath() {
    setCreationPath("style");
    setJournalMode(false);
    setPhase("style");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
  }

  function beginFreeFlowPath() {
    setCreationPath("freeflow");
    setJournalMode(true);
    setPhase("feeling");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
  }

  function beginJournalReflectPath() {
    const recent = reflectableJournalEntriesForPicker(journalPickerEntries);
    const next = new Set<string>();
    for (let i = 0; i < Math.min(3, recent.length); i += 1) {
      next.add(recent[i].id);
    }
    setJournalReflectSelectedIds(next);
    setCreationPath("journalReflect");
    setJournalMode(true);
    setPhase("journalPick");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setIntroTypingSession((s) => s + 1);
    setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
  }

  function beginGoalPath() {
    setCreationPath("goal");
    setJournalMode(true);
    setGoalSelectedId(null);
    setPhase("goalPick");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setIntroTypingSession((s) => s + 1);
    setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
  }

  async function confirmGoalSelection() {
    const id = goalSelectedId?.trim() ?? "";
    if (!id || chatLoading) return;
    const goal = planGoals.find((g) => g.id === id);
    if (!goal) return;

    const lines: string[] = [];
    lines.push(`Goal: ${goal.title.trim() || "Untitled goal"}`);
    if (goal.description?.trim()) lines.push(`Context: ${goal.description.trim()}`);
    const openTasks = (goal.tasks ?? [])
      .filter((t) => t && !t.done && (t.title ?? "").trim())
      .slice(0, 6)
      .map((t) => `- ${t.title.trim()}`);
    if (openTasks.length) {
      lines.push("");
      lines.push("Current tasks:");
      lines.push(...openTasks);
    }
    const goalSummary = lines.join("\n");

    const styleHint = "Manifestation";
    const history: MedimadeChatTurn[] = [
      { role: "assistant", content: OPENING_GOAL },
      { role: "user", content: goalSummary },
    ];

    setPhase("claude");
    setIntroTypingDone(true);
    setMeditationStyle(styleHint);
    setClaudeThread([]);
    setInput("");
    setMessages([
      {
        role: "user",
        text: goalSummary,
        variant: "chat",
      },
    ]);
    setChatLoading(true);

    try {
      let acc = "";
      let assistantBubbleStarted = false;
      const text = await streamMedimadeChat(
        {
          meditationStyle: styleHint,
          messages: history,
        },
        (d) => {
          acc += d;
          if (!assistantBubbleStarted) {
            assistantBubbleStarted = true;
            setMessages((m) => [...m, { role: "assistant", text: acc }]);
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          } else {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last?.role !== "assistant") return m;
              next[next.length - 1] = { role: "assistant", text: acc };
              return next;
            });
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          }
        },
      );
      setClaudeThread([...history, { role: "assistant", content: text }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not reach the guide.";
      setMessages((m) => [...m, { role: "assistant", text: `Sorry — ${msg}` }]);
    } finally {
      setChatLoading(false);
      requestAnimationFrame(() => {
        chatInputRef.current?.focus();
      });
    }
  }

  function toggleJournalReflectEntry(id: string) {
    setJournalReflectSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function confirmJournalReflectSelection() {
    const pickerList = reflectableJournalEntriesForPicker(journalPickerEntries);
    const ordered = pickerList.filter((e) => journalReflectSelectedIds.has(e.id));
    if (!ordered.length || chatLoading) return;

    const journalCards: JournalHandoffSegment[] = ordered.map((e) => ({
      entryId: e.id,
      title: e.title.trim() || deriveEntryTitle(e.contentHtml),
      bodyPlain: journalEntryPlainForHandoff(e.contentHtml),
      createdAt: e.createdAt,
    }));

    const apiUserContent = buildJournalHandoffApiContent(journalCards);
    const history: MedimadeChatTurn[] = [
      { role: "assistant", content: OPENING_JOURNAL },
      { role: "user", content: apiUserContent },
    ];
    const styleHint = "General";

    setCreationPath("freeflow");
    setPhase("claude");
    setIntroTypingDone(true);
    setMeditationStyle(styleHint);
    setClaudeThread([]);
    setInput("");
    setMessages([
      {
        role: "user",
        text: JOURNAL_CREATE_FIRST_MESSAGE,
        journalSegments: journalCards,
      },
    ]);
    setChatLoading(true);

    try {
      let acc = "";
      let assistantBubbleStarted = false;
      const text = await streamMedimadeChat(
        {
          meditationStyle: styleHint,
          messages: history,
          journalMode: true,
          meditationTargetMinutes,
        },
        (d) => {
          acc += d;
          if (!assistantBubbleStarted) {
            assistantBubbleStarted = true;
            setMessages((m) => [...m, { role: "assistant", text: acc }]);
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          } else {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last?.role !== "assistant") return m;
              next[next.length - 1] = { role: "assistant", text: acc };
              return next;
            });
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          }
        },
      );
      setClaudeThread([...history, { role: "assistant", content: text }]);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not reach the guide.";
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Sorry — ${msg}` },
      ]);
    } finally {
      setChatLoading(false);
      requestAnimationFrame(() => {
        chatInputRef.current?.focus();
      });
    }
  }

  function goBackToChatStyle() {
    const modeFromPath: null | "style" | "freeflow" | "journalReflect" | "goal" =
      creationPath === "style"
        ? "style"
        : creationPath === "freeflow"
          ? "freeflow"
          : creationPath === "journalReflect"
            ? "journalReflect"
            : creationPath === "goal"
              ? "goal"
            : null;
    setCreateStripStep(0);
    setCreationPath("pending");
    setPendingModeChoice(modeFromPath);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
  }

  function applyWorkspaceModeChange(
    v: "style" | "freeflow" | "journalReflect" | "goal",
  ) {
    if (v === "journalReflect" && (!journalPickerListReady || !hasReflectableJournal))
      return;
    if (v === "goal" && (!planGoalsReady || !hasPlanGoals)) return;
    const currentMode: null | "style" | "freeflow" | "journalReflect" | "goal" =
      creationPath === "style"
        ? "style"
        : creationPath === "freeflow"
          ? "freeflow"
          : creationPath === "journalReflect"
            ? "journalReflect"
            : creationPath === "goal"
              ? "goal"
            : null;
    if (v === currentMode) return;
    setPendingModeChoice(v);
    if (v === "style") beginStylePath();
    else if (v === "freeflow") beginFreeFlowPath();
    else if (v === "journalReflect") beginJournalReflectPath();
    else beginGoalPath();
  }

  async function send() {
    if (phase === "journalPick" || phase === "goalPick") return;
    const trimmed = input.trim();
    if (!trimmed || chatLoading || scriptLoading) return;

    // Journal mode: start the Claude chat from mood without requiring a style label.
    if (journalMode && phase === "feeling" && !meditationStyle) {
      // "How I Feel" mode is only an opener; still send a neutral style hint because the API requires it.
      const styleHint = "General";
      // Set a local style so subsequent turns can continue (the send() flow requires a truthy meditationStyle).
      setMeditationStyle(styleHint);
      setPhase("claude");
      const history: MedimadeChatTurn[] = [
        { role: "assistant", content: OPENING_JOURNAL },
        { role: "user", content: trimmed },
      ];
      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInput("");
      setChatLoading(true);
      try {
        let acc = "";
        let assistantBubbleStarted = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
            meditationTargetMinutes,
          },
          (d) => {
            acc += d;
            if (!assistantBubbleStarted) {
              assistantBubbleStarted = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            }
          },
        );
        setClaudeThread([...history, { role: "assistant", content: text }]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [...m, { role: "assistant", text: `Sorry — ${msg}` }]);
      } finally {
        setChatLoading(false);
      }
      return;
    }

    if (phase === "style") {
      const match = meditationStyles.find(
        (s) => s.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      if (match) {
        pickStyle(match);
        return;
      }
      // Free-text: treat as initial chat message and use it as style label too.
      setMeditationStyle(trimmed);
      setPhase("claude");
      const style = trimmed;
      const history: MedimadeChatTurn[] = [{ role: "user", content: trimmed }];
      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInput("");
      setChatLoading(true);
      try {
        let acc = "";
        let assistantBubbleStarted = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: style,
            messages: history,
            journalMode: journalMode === true,
            meditationTargetMinutes,
          },
          (d) => {
            acc += d;
            if (!assistantBubbleStarted) {
              assistantBubbleStarted = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            }
          },
        );
        setClaudeThread([
          ...history,
          { role: "assistant", content: text },
        ]);
        setPhase("claude");
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Sorry — ${msg}`,
          },
        ]);
      } finally {
        setChatLoading(false);
      }
      return;
    }

    const style = meditationStyle;
    if (!style) return;

    if (phase === "feeling") {
      const firstQuestion = getStyleFollowupQuestion(style);
      const nextMessages: MedimadeChatTurn[] =
        claudeThread.length > 0
          ? [...claudeThread, { role: "user", content: trimmed }]
          : [
              { role: "assistant", content: firstQuestion },
              { role: "user", content: trimmed },
            ];
      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInput("");
      setChatLoading(true);
      try {
        let acc = "";
        let assistantBubbleStarted = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: style,
            messages: nextMessages,
            journalMode: journalMode === true,
            meditationTargetMinutes,
          },
          (d) => {
            acc += d;
            if (!assistantBubbleStarted) {
              assistantBubbleStarted = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
              maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
            }
          },
        );
        setClaudeThread([
          ...nextMessages,
          { role: "assistant", content: text },
        ]);
        setPhase("claude");
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: `Sorry — ${msg}`,
          },
        ]);
      } finally {
        setChatLoading(false);
      }
      return;
    }

    const history: MedimadeChatTurn[] = [
      ...claudeThread,
      { role: "user", content: trimmed },
    ];
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setChatLoading(true);
    try {
      let acc = "";
      let assistantBubbleStarted = false;
      const text = await streamMedimadeChat(
        {
          meditationStyle: style,
          messages: history,
          journalMode: journalMode === true,
          meditationTargetMinutes,
        },
        (d) => {
          acc += d;
          if (!assistantBubbleStarted) {
            assistantBubbleStarted = true;
            setMessages((m) => [...m, { role: "assistant", text: acc }]);
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          } else {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last?.role !== "assistant") return m;
              next[next.length - 1] = { role: "assistant", text: acc };
              return next;
            });
            maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
          }
        },
      );
      setClaudeThread([
        ...history,
        { role: "assistant", content: text },
      ]);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not reach the guide.";
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Sorry — ${msg}`,
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  async function generateMeditationAudioAndShow() {
    if (audioLoading) return;
    setAudioError(null);
    // Stop all preview audio while generating.
    stopAllAudioPreview();
    setAudioLoading(true);
    try {
      const last = messages[messages.length - 1];
      const existingScript =
        last?.role === "assistant" && last.variant === "script"
          ? last.text
          : null;

      const transcript = messages
        .filter((m) => !(m.role === "assistant" && m.variant === "script"))
        .map(
          (m) =>
            `${m.role === "user" ? "User" : "Guide"}: ${chatMessageTranscriptLine(m)}`,
        )
        .join("\n\n");

      const { jobId } = await createMeditationAudioJob({
        meditationStyle,
        journalMode: journalMode === true,
        meditationTargetMinutes,
        transcript,
        scriptText: existingScript,
        reference_id: speakerModelId,
        speed: speechSpeed,
        voiceFxPreset: speakerFxPreviewOn ? "mixer" : null,
        ...(backgroundNatureKey
          ? {
              backgroundNatureKey: backgroundAudioStreamingKey(
                backgroundNatureKey,
              ),
              backgroundNatureGain,
            }
          : {}),
        ...(backgroundMusicKey
          ? {
              backgroundMusicKey: backgroundAudioStreamingKey(
                backgroundMusicKey,
              ),
              backgroundMusicGain,
            }
          : {}),
        ...(backgroundNoiseKey
          ? {
              backgroundNoiseKey: backgroundAudioStreamingKey(
                backgroundNoiseKey,
              ),
              backgroundNoiseGain,
            }
          : {}),
      });

      // Do not redirect until the worker has finished script + library metadata (title/description).
      // Audio synthesis continues after that; the Library card should show real copy from the job, not client guesses.
      const metaDeadlineMs = 5 * 60_000;
      const metaStart = Date.now();
      let metaTitle = "";
      let metaDesc = "";
      while (Date.now() - metaStart < metaDeadlineMs) {
        let st: Awaited<ReturnType<typeof getMeditationAudioJobStatus>>;
        try {
          st = await getMeditationAudioJobStatus(jobId);
        } catch {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        if (st.status === "failed") {
          throw new Error(st.error ?? "Generation failed");
        }
        const scriptOk = (st.scriptTextUsed ?? "").trim().length > 0;
        const t = (st.title ?? "").trim();
        const d = (st.description ?? "").trim();
        if (scriptOk && t && d) {
          metaTitle = t;
          metaDesc = d;
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      if (!metaTitle || !metaDesc) {
        throw new Error(
          "Timed out waiting for script and library details. Your job may still be running — open Library to check progress.",
        );
      }

      const speakerName =
        fishSpeakers.find((s) => s.modelId === speakerModelId)?.name ?? null;

      const pending: PendingLibraryGeneration = {
        jobId,
        createdAt: new Date().toISOString(),
        title: metaTitle,
        description: metaDesc,
        meditationStyle,
        speakerName,
        speakerModelId,
      };
      const nextPending = [pending, ...loadPendingGenerations()].filter(
        (x, idx, arr) => arr.findIndex((y) => y.jobId === x.jobId) === idx,
      );
      savePendingGenerations(nextPending);

      isRedirectingToLibraryRef.current = true;
      router.push(
        `/meditate/library?focus=${encodeURIComponent(`pending:${jobId}`)}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Audio generation failed";
      setAudioError(msg);
    } finally {
      // Avoid flashing the button back to "Generate meditation" while we redirect away.
      if (!isRedirectingToLibraryRef.current) {
        setAudioLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    const envMediaBase = getMedimadeMediaBaseUrl();
    (async () => {
      try {
        const data = await listBackgroundAudio();
        if (cancelled) return;
        setBackgroundNature(data.nature);
        setBackgroundMusic(data.music);
        setBackgroundNoise(data.noise);
        const fromApi = data.baseUrl?.trim();
        setMediaBaseUrl(fromApi || envMediaBase || null);
      } catch {
        if (cancelled) return;
        setBackgroundNature([]);
        setBackgroundMusic([]);
        setBackgroundNoise([]);
        setMediaBaseUrl(envMediaBase || null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const base = mediaBaseUrl;
    const sync = async (
      el: HTMLAudioElement | null,
      key: string,
      gain: number,
      track: Exclude<SoloTrack, "speaker">,
    ) => {
      if (!el) return;
      el.loop = true;
      // Match backend mixing: each bed layer uses (gain/100).
      // (See `mixSpeechWithBackgrounds` in `backend/lambdas/generate-meditation-audio.ts`.)
      el.volume = Math.min(1, Math.max(0, gain / 100));
      if (base && key) {
        const next = mediaFileUrl(base, backgroundAudioStreamingKey(key));
        const prevKey = lastBgKeysRef.current[track];
        const keyChanged = prevKey !== key;
        if (el.src !== next) {
          el.src = next;
          void el.load();
        }
        // Requirement: selecting a new sample should auto-play even if the track was paused.
        // Also keep playing if it was already playing.
        if (keyChanged || playing[track]) {
          try {
            await el.play();
            setPlaying((p) => ({ ...p, [track]: true }));
          } catch {
            stopTrack(track);
          }
        }
        lastBgKeysRef.current[track] = key;
      } else {
        el.removeAttribute("src");
        el.load();
        if (playing[track]) {
          stopTrack(track);
        }
        lastBgKeysRef.current[track] = "";
      }
    };
    void sync(previewNatureRef.current, backgroundNatureKey, backgroundNatureGain, "nature");
    void sync(previewMusicRef.current, backgroundMusicKey, backgroundMusicGain, "music");
    void sync(previewNoiseRef.current, backgroundNoiseKey, backgroundNoiseGain, "noise");
  }, [
    mediaBaseUrl,
    backgroundNatureKey,
    backgroundMusicKey,
    backgroundNoiseKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundNoiseGain,
    playing.nature,
    playing.music,
    playing.noise,
  ]);

  function clearSpeakerGapSchedule() {
    if (speakerGapTimeoutRef.current !== null) {
      clearTimeout(speakerGapTimeoutRef.current);
      speakerGapTimeoutRef.current = null;
    }
  }

  const anyTrackPlaying =
    playing.speaker || playing.nature || playing.music || playing.noise;

  function stopTrack(track: SoloTrack) {
    setPlayAllActive(false);
    if (track === "speaker") {
      clearSpeakerGapSchedule();
      speakerRepeatWantedRef.current = false;
      speakerSampleRef.current?.pause();
    } else if (track === "nature") {
      previewNatureRef.current?.pause();
    } else if (track === "music") {
      previewMusicRef.current?.pause();
    } else if (track === "noise") {
      previewNoiseRef.current?.pause();
    }
    setPlaying((p) => ({ ...p, [track]: false }));
  }

  function stopAllAudioPreview() {
    clearSpeakerGapSchedule();
    speakerRepeatWantedRef.current = false;
    previewNatureRef.current?.pause();
    previewMusicRef.current?.pause();
    previewNoiseRef.current?.pause();
    speakerSampleRef.current?.pause();
    setPlayAllActive(false);
    setPlaying({ speaker: false, nature: false, music: false, noise: false });
  }

  useEffect(() => {
    return () => {
      clearSpeakerGapSchedule();
      [previewNatureRef, previewMusicRef, previewNoiseRef].forEach((r) => {
        const el = r.current;
        if (el) {
          el.pause();
          el.removeAttribute("src");
        }
      });
      const sp = speakerSampleRef.current;
      if (sp) {
        sp.pause();
        sp.removeAttribute("src");
      }
    };
  }, []);

  useEffect(() => {
    const el = speakerSampleRef.current;
    if (!el) return;
    if (mediaBaseUrl && speakerModelId) {
      const key = speakerFxPreviewOn
        ? speakerPreviewLoudFxSampleKey(speakerModelId, speechSpeed)
        : speakerPreviewLoudSampleKey(speakerModelId, speechSpeed);
      const next = mediaFileUrl(mediaBaseUrl, key);
      if (el.src !== next) {
        el.src = next;
        void el.load();
      }
      // If the speaker track was already playing, hot-swap to the new URL and keep playing
      // (speed change, FX toggle, speaker change should not require re-pressing play).
      if (playing.speaker) {
        speakerRepeatWantedRef.current = true;
        void el.play().catch(() => {
          stopTrack("speaker");
        });
      }
    } else {
      el.removeAttribute("src");
      el.load();
      if (playing.speaker) {
        stopTrack("speaker");
      }
    }
  }, [mediaBaseUrl, speakerModelId, speechSpeed, speakerFxPreviewOn, playing.speaker]);

  useEffect(() => {
    const el = speakerSampleRef.current;
    if (!el) return;
    const onEnded = () => {
      if (!speakerRepeatWantedRef.current) return;
      clearSpeakerGapSchedule();
      // Keep UI in "playing" state while we schedule the next repeat.
      setPlaying((p) => ({ ...p, speaker: true }));
      speakerGapTimeoutRef.current = window.setTimeout(() => {
        speakerGapTimeoutRef.current = null;
        if (!speakerRepeatWantedRef.current) return;
        const a = speakerSampleRef.current;
        if (a?.src) void a.play().catch(() => {});
      }, SPEAKER_SAMPLE_GAP_MS);
    };
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("ended", onEnded);
      clearSpeakerGapSchedule();
    };
  }, []);

  async function togglePlayAll() {
    if (!mediaBaseUrl) return;
    if (anyTrackPlaying || playAllActive) {
      stopAllAudioPreview();
      return;
    }

    stopAllAudioPreview();

    const parts: Promise<void>[] = [];
    const sp = speakerSampleRef.current;
    if (sp?.src) {
      speakerRepeatWantedRef.current = true;
      parts.push(sp.play());
    } else {
      speakerRepeatWantedRef.current = false;
    }
    if (backgroundNatureKey && previewNatureRef.current?.src) {
      parts.push(previewNatureRef.current.play());
    }
    if (backgroundMusicKey && previewMusicRef.current?.src) {
      parts.push(previewMusicRef.current.play());
    }
    if (backgroundNoiseKey && previewNoiseRef.current?.src) {
      parts.push(previewNoiseRef.current.play());
    }

    if (parts.length === 0) return;

    setPlayAllActive(true);
    setPlaying({
      speaker: Boolean(sp?.src),
      nature: Boolean(backgroundNatureKey && previewNatureRef.current?.src),
      music: Boolean(backgroundMusicKey && previewMusicRef.current?.src),
      noise: Boolean(backgroundNoiseKey && previewNoiseRef.current?.src),
    });

    try {
      await Promise.all(parts);
    } catch {
      stopAllAudioPreview();
    }
  }

  async function toggleRowPreview(track: SoloTrack) {
    if (track === "speaker" && (!mediaBaseUrl || !speakerModelId)) return;
    if (track === "nature" && !backgroundNatureKey) return;
    if (track === "music" && !backgroundMusicKey) return;
    if (track === "noise" && !backgroundNoiseKey) return;

    const el =
      track === "speaker"
        ? speakerSampleRef.current
        : track === "nature"
          ? previewNatureRef.current
          : track === "music"
            ? previewMusicRef.current
            : previewNoiseRef.current;

    if (!el?.src) {
      return;
    }

    try {
      // Individual track toggles should not affect other tracks.
      // If "Play all" was active, this is now a manual mix.
      setPlayAllActive(false);

      if (track === "speaker") {
        clearSpeakerGapSchedule();
      }

      if (!el.paused) {
        el.pause();
        if (track === "speaker") {
          speakerRepeatWantedRef.current = false;
          clearSpeakerGapSchedule();
        }
        setPlaying((p) => ({ ...p, [track]: false }));
        return;
      }

      if (track === "speaker") {
        speakerRepeatWantedRef.current = true;
      }

      await el.play();
      setPlaying((p) => ({ ...p, [track]: true }));
    } catch {
      // Don't stop other tracks; just mark this one as not playing.
      if (track === "speaker") {
        speakerRepeatWantedRef.current = false;
        clearSpeakerGapSchedule();
      }
      setPlaying((p) => ({ ...p, [track]: false }));
    }
  }

  const activeWorkspaceMode: null | "style" | "freeflow" | "journalReflect" | "goal" =
    creationPath === "style"
      ? "style"
      : creationPath === "freeflow"
        ? "freeflow"
        : creationPath === "journalReflect"
          ? "journalReflect"
          : creationPath === "goal"
            ? "goal"
          : null;
  const activeWorkspaceModeLabel =
    WORKSPACE_GENERATION_MODES.find((o) => o.value === activeWorkspaceMode)
      ?.label ?? "Mode";

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <div className="mb-6 shrink-0">
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Create a meditation
        </h1>
        {workspaceSectionStep === 0 ? (
          <p className="mt-2 text-muted">
            Create a personalised meditation just for you.
          </p>
        ) : (
          <p className="mt-2 text-muted">
            Chat with the guide to shape your script, then pick a voice, mix
            nature sounds, music, and noise, and preview the blend before you
            generate your meditation audio.
          </p>
        )}
      </div>

      {draftLoadError ? (
        <div
          className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
          role="alert"
        >
          {draftLoadError}
        </div>
      ) : null}

      {creationPath === "pending" &&
      initialDraftSk?.trim() &&
      !draftHydrated &&
      !draftLoadError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-muted">
          Loading draft…
        </div>
      ) : (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {workspaceSectionStep === 0 ? (
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <h2 className="shrink-0 font-display text-lg font-medium tracking-tight text-foreground sm:text-xl">
            How would you like to generate your script?
          </h2>
          <div
            ref={chooserCardsRef}
            className={`grid min-h-0 flex-1 grid-cols-1 items-stretch gap-4 md:gap-6 ${
              chooserLayout === "row4" ? "md:grid-cols-4" : "sm:grid-cols-2"
            }`}
          >
            <button
              type="button"
              onClick={() => setPendingModeChoice("style")}
              aria-pressed={pendingModeChoice === "style"}
              className={`flex h-full flex-col rounded-2xl border-2 bg-card text-left shadow-sm transition-colors ${
                pendingModeChoice === "style"
                  ? "cursor-pointer border-accent ring-2 ring-accent/25"
                  : "cursor-pointer border-border hover:border-accent/40 hover:bg-accent-soft/15"
              } ${chooserLayout === "row4" ? "min-h-[200px] p-6 sm:min-h-[260px] sm:p-8" : "p-6"}`}
            >
              {chooserLayout === "row4" ? (
                <>
                  <span className="font-display text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                    Pick a meditation style
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                    You start by choosing a meditation style in chat. The guide then asks
                    follow-up questions so that style is shaped around your mood, goals,
                    and what you need today.
                  </p>
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconMeditationStyle className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent shadow-inner"
                    aria-hidden
                  >
                    <IconMeditationStyle className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-display text-lg font-medium tracking-tight text-foreground">
                      Pick a meditation style
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-muted sm:text-base">
                      You start by choosing a meditation style in chat. The guide then asks
                      follow-up questions so that style is shaped around your mood, goals,
                      and what you need today.
                    </p>
                  </div>
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={() => setPendingModeChoice("freeflow")}
              aria-pressed={pendingModeChoice === "freeflow"}
              className={`flex h-full flex-col rounded-2xl border-2 bg-card text-left shadow-sm transition-colors ${
                pendingModeChoice === "freeflow"
                  ? "cursor-pointer border-accent ring-2 ring-accent/25"
                  : "cursor-pointer border-border hover:border-accent/40 hover:bg-accent-soft/15"
              } ${chooserLayout === "row4" ? "min-h-[200px] p-6 sm:min-h-[260px] sm:p-8" : "p-6"}`}
            >
              {chooserLayout === "row4" ? (
                <>
                  <span className="font-display text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                    Free flow chat
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                    Start from mood and what is on your mind—no style label up front.
                    The guide uses open, journal-style questions.
                  </p>
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconChatBubbles className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent shadow-inner"
                    aria-hidden
                  >
                    <IconChatBubbles className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-display text-lg font-medium tracking-tight text-foreground">
                      Free flow chat
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-muted sm:text-base">
                      Start from mood and what is on your mind—no style label up front.
                      The guide uses open, journal-style questions.
                    </p>
                  </div>
                </div>
              )}
            </button>
            <button
              type="button"
              disabled={!journalPickerListReady || !hasReflectableJournal}
              onClick={() => setPendingModeChoice("journalReflect")}
              aria-pressed={pendingModeChoice === "journalReflect"}
              className={`flex h-full flex-col rounded-2xl border-2 bg-card text-left shadow-sm transition-colors ${
                !journalPickerListReady || !hasReflectableJournal
                  ? "cursor-not-allowed border-border opacity-50"
                  : pendingModeChoice === "journalReflect"
                    ? "cursor-pointer border-accent ring-2 ring-accent/25"
                    : "cursor-pointer border-border hover:border-accent/40 hover:bg-accent-soft/15"
              } ${chooserLayout === "row4" ? "min-h-[200px] p-6 sm:min-h-[260px] sm:p-8" : "p-6"}`}
            >
              {chooserLayout === "row4" ? (
                <>
                  <span className="font-display text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                    Reflect on a journal entry
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                    In the next step you choose saved entries; the coach uses them as context for your meditation.
                  </p>
                  {!journalPickerListReady ? (
                    <p className="mt-3 text-xs text-muted">Checking your saved journal…</p>
                  ) : !hasReflectableJournal ? (
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      Start journaling to unlock this option.{" "}
                      <Link
                        href="/journal"
                        className="font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        Open Journal
                      </Link>
                    </p>
                  ) : null}
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconJournalReflect className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent shadow-inner"
                    aria-hidden
                  >
                    <IconJournalReflect className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-display text-lg font-medium tracking-tight text-foreground">
                      Reflect on a journal entry
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-muted sm:text-base">
                      In the next step you choose saved entries; the coach uses them as context for your meditation.
                    </p>
                    {!journalPickerListReady ? (
                      <p className="mt-2 text-xs text-muted">Checking your saved journal…</p>
                    ) : !hasReflectableJournal ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        Start journaling to unlock this option.{" "}
                        <Link
                          href="/journal"
                          className="cursor-pointer font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          Open Journal
                        </Link>
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </button>
            <button
              type="button"
              disabled={!planGoalsReady || !hasPlanGoals}
              onClick={() => setPendingModeChoice("goal")}
              aria-pressed={pendingModeChoice === "goal"}
              className={`flex h-full flex-col rounded-2xl border-2 bg-card text-left shadow-sm transition-colors ${
                !planGoalsReady || !hasPlanGoals
                  ? "cursor-not-allowed border-border opacity-50"
                  : pendingModeChoice === "goal"
                    ? "cursor-pointer border-accent ring-2 ring-accent/25"
                    : "cursor-pointer border-border hover:border-accent/40 hover:bg-accent-soft/15"
              } ${chooserLayout === "row4" ? "min-h-[200px] p-6 sm:min-h-[260px] sm:p-8" : "p-6"}`}
            >
              {chooserLayout === "row4" ? (
                <>
                  <span className="font-display text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                    Move towards a goal
                  </span>
                  <p className="mt-2 text-sm leading-relaxed text-muted sm:text-base">
                    Choose a goal from Plan. The guide creates a visualization / manifestation meditation that helps you step toward it.
                  </p>
                  {!planGoalsReady ? (
                    <p className="mt-3 text-xs text-muted">Checking your goals…</p>
                  ) : !hasPlanGoals ? (
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      Add a dream in{" "}
                      <Link
                        href="/plan"
                        className="cursor-pointer font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        Plan
                      </Link>{" "}
                      to unlock this option.
                    </p>
                  ) : null}
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconGoalTarget className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex min-h-0 flex-1 items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent shadow-inner"
                    aria-hidden
                  >
                    <IconGoalTarget className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-display text-lg font-medium tracking-tight text-foreground">
                      Move towards a goal
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-muted sm:text-base">
                      Choose a goal from Plan. The guide creates a visualization / manifestation meditation that helps you step toward it.
                    </p>
                    {!planGoalsReady ? (
                      <p className="mt-2 text-xs text-muted">Checking your goals…</p>
                    ) : !hasPlanGoals ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        Add a dream in{" "}
                        <Link
                          href="/plan"
                          className="cursor-pointer font-semibold text-accent underline-offset-2 hover:underline"
                        >
                          Plan
                        </Link>{" "}
                        to unlock this option.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </button>
          </div>
          </div>
          <div className="shrink-0 border-t border-border/60 bg-background pt-4">
            <div className="flex justify-end">
            <button
              type="button"
              disabled={!pendingModeChoice}
              onClick={() => {
                if (pendingModeChoice === "style") {
                  beginStylePath();
                } else if (pendingModeChoice === "freeflow") {
                  beginFreeFlowPath();
                } else if (pendingModeChoice === "journalReflect") {
                  beginJournalReflectPath();
                } else if (pendingModeChoice === "goal") {
                  beginGoalPath();
                }
                setCreateStripStep(1);
              }}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              aria-label={
                pendingModeChoice === "journalReflect"
                  ? "Continue and pick journal entries in chat"
                  : pendingModeChoice === "goal"
                    ? "Continue and pick a goal in chat"
                  : "Continue to script and chat"
              }
            >
              <span>Script</span>
              <IconChevronRight className="text-accent" />
            </button>
            </div>
          </div>
        </div>
        ) : null}
        {workspaceSectionStep === 1 ? (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <h2 className="mb-2 shrink-0 font-display text-lg font-medium tracking-tight text-foreground sm:mb-3 sm:text-xl">
          Shape how your meditation script is written
        </h2>
        <section className="flex w-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 className="min-w-0 shrink text-base font-semibold tracking-tight">Script</h2>
            <div className="flex shrink-0 items-center gap-2">
              <div ref={workspaceModeMenuRef} className="relative">
                <button
                  type="button"
                  id="create-workspace-mode-trigger"
                  aria-label="How to generate your script"
                  aria-haspopup="listbox"
                  aria-expanded={workspaceModeMenuOpen}
                  aria-controls="create-workspace-mode-listbox"
                  disabled={chatControlsDisabled}
                  onClick={() => setWorkspaceModeMenuOpen((o) => !o)}
                  className="inline-flex h-8 max-w-[min(16rem,calc(100vw-6rem))] cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-left text-xs font-medium text-foreground shadow-sm transition-colors hover:border-accent/45 hover:bg-accent-soft/25 disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[18rem]"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {activeWorkspaceModeLabel}
                  </span>
                  <IconChevronDown
                    className={`shrink-0 text-muted transition-transform ${workspaceModeMenuOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {workspaceModeMenuOpen ? (
                  <div
                    id="create-workspace-mode-listbox"
                    role="listbox"
                    aria-labelledby="create-workspace-mode-trigger"
                    className="absolute right-0 top-full z-30 mt-1 w-max min-w-full max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-md"
                  >
                    {WORKSPACE_GENERATION_MODES.map((opt) => {
                      const selected = opt.value === activeWorkspaceMode;
                      const journalDisabled =
                        opt.value === "journalReflect" &&
                        (!journalPickerListReady || !hasReflectableJournal);
                      const goalDisabled =
                        opt.value === "goal" && (!planGoalsReady || !hasPlanGoals);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          disabled={journalDisabled || goalDisabled}
                          onClick={() => {
                            applyWorkspaceModeChange(opt.value);
                            setWorkspaceModeMenuOpen(false);
                          }}
                          className={`flex w-full cursor-pointer items-center px-3 py-2.5 text-left text-xs font-medium text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                            selected
                              ? "bg-accent-soft/45 text-foreground"
                              : "hover:bg-accent-soft/30"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            <Tooltip.Provider delayDuration={250} disableHoverableContent>
              <div className="inline-flex shrink-0 items-center gap-2">
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      onClick={resetChatKeepMode}
                      aria-label="Reset chat"
                      disabled={chatControlsDisabled}
                      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors hover:bg-accent-soft/35 hover:text-foreground"
                      title="Reset chat"
                    >
                      <IconResetArrow />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      align="center"
                      sideOffset={8}
                      className="max-w-[12rem] rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground shadow-md"
                    >
                      Reset chat
                      <Tooltip.Arrow className="fill-card stroke-border" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              </div>
            </Tooltip.Provider>
            </div>
            {/* Preview script — hidden for now
            <button
              type="button"
              onClick={() => void generateScript()}
              disabled={scriptLoading || chatControlsDisabled}
              className="ml-3 shrink-0 cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-accent/50 hover:bg-accent-soft/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scriptLoading ? "…" : "Preview script"}
            </button>
            */}
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div
              ref={chatScrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto"
              onScroll={() => {
                const el = chatScrollRef.current;
                if (!el) return;
                const distanceFromBottom =
                  el.scrollHeight - el.scrollTop - el.clientHeight;
                // Consider within ~50px as "at bottom".
                isAtBottomRef.current = distanceFromBottom < 50;
              }}
            >
              {/* Track whether user is already at bottom so streaming doesn't yank scroll */}
              {messages.filter((m) => !m.muted).map((msg, i) => {
                const isScript =
                  msg.role === "assistant" && msg.variant === "script";
                if (msg.kind === "divider") {
                  return (
                    <div
                      key={`divider-${i}`}
                      className="py-2 text-center text-xs text-muted"
                    >
                      {msg.text}
                    </div>
                  );
                }
                const muted = msg.muted ? "opacity-50" : "";
                const row =
                  msg.role === "user"
                    ? "flex w-full justify-end"
                    : "flex w-full justify-start";
                const bubbleBase = "inline-block w-fit max-w-full rounded-xl px-3 py-2";
                const bubble =
                  msg.role === "user"
                    ? `${bubbleBase} bg-border/40 text-[15px] text-foreground ${muted}`
                    : isScript
                      ? `${bubbleBase} border border-gold/45 bg-gold/5 text-foreground shadow-sm ${muted}`
                      : `${bubbleBase} bg-accent-soft/80 text-[15px] text-foreground ${muted}`;

                // Treat *paragraph breaks* in Claude responses as separate bubbles.
                // (Single newlines are kept so bullet lists stay in one bubble.)
                const assistantParts =
                  msg.role === "assistant" && !isScript
                    ? msg.text
                        .split(/\n{2,}/g)
                        .map((s) => s.trim())
                        .filter(Boolean)
                        // If a lead-in ends with ":" and the next paragraph is a bullet list,
                        // keep them in the same bubble (even if the model inserted a blank line).
                        .reduce<string[]>((acc, part) => {
                          const prev = acc[acc.length - 1];
                          const isBulletList =
                            /^[-*•]\s+/.test(part) || /^\d+\.\s+/.test(part);
                          if (
                            prev &&
                            /:\s*$/.test(prev) &&
                            isBulletList
                          ) {
                            acc[acc.length - 1] = `${prev}\n${part}`;
                            return acc;
                          }
                          acc.push(part);
                          return acc;
                        }, [])
                    : null;
                return (
                  <div key={`${msg.role}-${i}-${msg.variant ?? "u"}`} className={row}>
                    {assistantParts ? (
                      <div className="flex w-fit max-w-[92%] flex-col items-start gap-2">
                        {assistantParts.map((part, pi) => (
                          <div key={pi} className={bubble}>
                            <ChatMarkdown
                              text={part}
                              className="text-[15px] leading-snug"
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className={bubble}>
                        {isScript ? (
                          <>
                            <div className="mb-2 inline-flex items-center rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                              Meditation script · ~5 min
                            </div>
                            <ChatMarkdown
                              text={msg.text}
                              className="font-serif text-[14px] leading-relaxed text-foreground/95"
                            />
                          </>
                        ) : msg.role === "user" &&
                          msg.journalSegments &&
                          msg.journalSegments.length > 0 ? (
                          <div className="text-[15px] leading-snug">
                            <p className="whitespace-pre-wrap">{msg.text}</p>
                            <JournalHandoffEntryCards
                              segments={msg.journalSegments}
                            />
                          </div>
                        ) : (
                          <ChatMarkdown
                            text={msg.text}
                            className="text-[15px] leading-snug"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {phase === "style" && !journalMode && introTypingDone && (
                <Tooltip.Provider delayDuration={250} disableHoverableContent>
                <div className="flex flex-wrap gap-2 pt-1">
                  {meditationStyles.map((s) => (
                    <Tooltip.Root key={s}>
                      <Tooltip.Trigger asChild>
                        <button
                          type="button"
                          onClick={() => pickStyle(s)}
                          aria-label={`${s}. ${meditationStyleTooltip[s]}`}
                          className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors duration-200 ease-out hover:border-accent/50 hover:bg-accent-soft/40"
                        >
                          {s}
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content
                          side="top"
                          align="center"
                          sideOffset={8}
                          className="max-w-[18rem] rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground shadow-md"
                        >
                          {meditationStyleTooltip[s]}
                          <Tooltip.Arrow className="fill-card stroke-border" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  ))}
                </div>
                </Tooltip.Provider>
              )}
              {phase === "journalPick" && introTypingDone ? (
                <div className="mt-3 space-y-3 rounded-xl border border-border bg-background px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Your journal
                  </p>
                  <ul className="max-h-[min(16rem,42vh)] space-y-1.5 overflow-y-auto pr-1">
                    {reflectableJournalEntriesForPicker(journalPickerEntries).map(
                      (e) => {
                        const title =
                          e.title.trim() || deriveEntryTitle(e.contentHtml);
                        const preview = stripHtmlToText(e.contentHtml).trim();
                        const previewLine =
                          preview.length > 96
                            ? `${preview.slice(0, 93)}…`
                            : preview;
                        return (
                          <li key={e.id}>
                            <label className="flex cursor-pointer gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-border hover:bg-accent-soft/25">
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-foreground"
                                checked={journalReflectSelectedIds.has(e.id)}
                                onChange={() => toggleJournalReflectEntry(e.id)}
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-foreground">
                                  {title}
                                </span>
                                <span className="mt-0.5 block text-xs text-muted">
                                  {formatJournalEntryDate(e.updatedAt)}
                                  {previewLine ? ` · ${previewLine}` : ""}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      },
                    )}
                  </ul>
                  <div className="flex justify-end border-t border-border/60 pt-3">
                    <button
                      type="button"
                      disabled={
                        chatLoading || journalReflectSelectedIds.size === 0
                      }
                      onClick={() => void confirmJournalReflectSelection()}
                      className="cursor-pointer rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                    >
                      Continue with selected
                    </button>
                  </div>
                </div>
              ) : null}
              {phase === "goalPick" ? (
                <div className="mt-3 space-y-3 rounded-xl border border-border bg-background px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Your goals (from Plan)
                  </p>
                  {!planGoalsReady ? (
                    <p className="text-sm text-muted">Loading goals…</p>
                  ) : !hasPlanGoals ? (
                    <p className="text-sm leading-relaxed text-muted">
                      Add a dream in{" "}
                      <Link
                        href="/plan"
                        className="cursor-pointer font-semibold text-accent underline-offset-2 hover:underline"
                      >
                        Plan
                      </Link>{" "}
                      to use this flow.
                    </p>
                  ) : introTypingDone ? (
                    <>
                      <ul className="max-h-[min(16rem,42vh)] space-y-1.5 overflow-y-auto pr-1">
                        {[...planGoals]
                          .sort((a, b) =>
                            (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
                          )
                          .slice(0, 25)
                          .map((g) => {
                            const title = (g.title ?? "").trim() || "Untitled goal";
                            const preview = (g.description ?? "").trim();
                            const previewLine =
                              preview.length > 96 ? `${preview.slice(0, 93)}…` : preview;
                            const openTasks = (g.tasks ?? []).filter((t) => !t.done).length;
                            return (
                              <li key={g.id}>
                                <label className="flex cursor-pointer gap-3 rounded-lg border border-transparent px-2 py-2 hover:border-border hover:bg-accent-soft/25">
                                  <input
                                    type="radio"
                                    name="goal-pick"
                                    className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-foreground"
                                    checked={goalSelectedId === g.id}
                                    onChange={() => setGoalSelectedId(g.id)}
                                  />
                                  <span className="min-w-0">
                                    <span className="block text-sm font-medium text-foreground">
                                      {title}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-muted">
                                      {openTasks ? `${openTasks} open tasks` : "No open tasks"}
                                      {previewLine ? ` · ${previewLine}` : ""}
                                    </span>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                      </ul>
                      <div className="flex justify-end border-t border-border/60 pt-3">
                        <button
                          type="button"
                          disabled={chatLoading || !goalSelectedId}
                          onClick={() => void confirmGoalSelection()}
                          className="cursor-pointer rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
                        >
                          Continue with selected
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
            {phase === "journalPick" || phase === "goalPick" ? null : (
            <div className="mt-3 flex shrink-0 gap-2 border-t border-border pt-3">
              <input
                ref={chatInputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void send()}
                aria-busy={chatLoading || scriptLoading}
                disabled={chatControlsDisabled}
                placeholder={
                  journalMode
                    ? "Share how you're feeling..."
                    : phase === "style"
                      ? "Or type a style (e.g. Yoga nidra)..."
                      : phase === "feeling"
                        ? "Share how you feel today…"
                        : "Reply to the guide…"
                }
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={chatControlsDisabled || chatLoading || scriptLoading}
                aria-label={chatLoading ? "Sending…" : "Send message"}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-accent text-white transition-opacity dark:text-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {chatLoading ? (
                  <span className="text-sm font-medium" aria-hidden>
                    …
                  </span>
                ) : (
                  <IconPaperAirplane className="-translate-y-px translate-x-px" />
                )}
              </button>
            </div>
            )}
          </div>
        </section>
        </div>
          <div className="shrink-0 border-t border-border/60 bg-background pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBackToChatStyle}
              disabled={chatControlsDisabled}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              aria-label="Back to chat style selection"
            >
              <IconChevronLeft className="shrink-0 text-accent" />
              <span>Chat style</span>
            </button>
            <button
              type="button"
              disabled={phase === "journalPick" || phase === "goalPick"}
              onClick={() => {
                setMobileCreateStep("audio");
                setCreateStripStep(2);
              }}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:pointer-events-none disabled:opacity-40 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              aria-label="Next: audio and voice settings"
            >
              <span>Audio & voice</span>
              <IconChevronRight className="text-accent" />
            </button>
          </div>
          </div>
        </div>
        ) : null}
        {workspaceSectionStep === 2 ? (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto sm:gap-3">
          <h2 className="shrink-0 font-display text-lg font-medium tracking-tight text-foreground sm:text-xl">
            Customise how your meditation will sound
          </h2>
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold tracking-tight">Audio</h2>
              </div>
              <button
                type="button"
                onClick={() => void togglePlayAll()}
                disabled={soundControlsDisabled || !mediaBaseUrl}
                aria-label={
                  anyTrackPlaying || playAllActive
                    ? "Pause all previews"
                    : "Play all selected tracks"
                }
                className="shrink-0 cursor-pointer rounded-lg border border-border bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-50"
              >
                {anyTrackPlaying || playAllActive
                  ? "Pause all"
                  : "Play all"}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <audio ref={previewNatureRef} className="hidden" playsInline />
              <audio ref={previewMusicRef} className="hidden" playsInline />
              <audio ref={previewNoiseRef} className="hidden" playsInline />
              <audio ref={speakerSampleRef} className="hidden" playsInline />

              <div className="space-y-6">
                <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted sm:w-[5.25rem]">
                    Speaker
                  </span>
                  <select
                    value={speakerModelId}
                    onChange={(e) => {
                      setSpeakerModelId(e.target.value);
                    }}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    disabled={soundControlsDisabled}
                  >
                    {fishSpeakers.map((s) => (
                      <option key={s.modelId} value={s.modelId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div
                    className="shrink-0 flex flex-col items-center"
                    title={
                      speakerFxPreviewOn
                        ? "Preview uses mixer FX (WAV on CDN). Click for dry Fish sample."
                        : "Preview uses dry Fish MP3. Click for FX (requires generated *-fx.wav)."
                    }
                  >
                    <div className="relative top-[2px] mb-1 text-center text-[10px] font-semibold uppercase leading-none tracking-wide text-muted">
                      FX
                    </div>
                    <Switch.Root
                      checked={speakerFxPreviewOn}
                      onCheckedChange={(v) => setSpeakerFxPreviewOn(Boolean(v))}
                      disabled={soundControlsDisabled || !mediaBaseUrl || !speakerModelId}
                      aria-label={
                        speakerFxPreviewOn
                          ? "Turn speaker FX off"
                          : "Turn speaker FX on"
                      }
                      className="relative top-[2px] h-4 w-8 cursor-pointer rounded-full border border-border bg-muted/30 align-middle transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Switch.Thumb className="block h-3 w-3 translate-x-[2px] rounded-full bg-white shadow transition-transform will-change-transform data-[state=checked]:translate-x-[18px]" />
                    </Switch.Root>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("speaker")}
                    disabled={soundControlsDisabled || !mediaBaseUrl || !speakerModelId}
                    aria-label={
                      playing.speaker
                        ? "Pause speaker sample"
                        : "Play speaker sample"
                    }
                    title={
                      !mediaBaseUrl
                        ? "Voice samples need your media URL."
                        : "Play or pause this voice sample (loops with a short gap)"
                    }
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PreviewPlayPauseIcon
                      playing={
                        playing.speaker
                      }
                    />
                  </button>
                </div>

                <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted sm:w-[5.25rem]">
                    Music
                  </span>
                  <select
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={backgroundMusicKey}
                    onChange={(e) => {
                      setBackgroundMusicKey(e.target.value);
                    }}
                    disabled={soundControlsDisabled}
                  >
                    <option value="">None</option>
                    {backgroundMusic.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex w-full flex-col gap-1 sm:w-40 sm:shrink-0">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Level</span>
                      <span className="tabular-nums">
                        {backgroundMusicGain}%
                      </span>
                    </div>
                    <input
                      aria-label="Music level"
                      type="range"
                      min={0}
                      max={100}
                      value={backgroundMusicGain}
                      onChange={(e) =>
                        setBackgroundMusicGain(Number(e.target.value))
                      }
                      disabled={soundControlsDisabled || !backgroundMusicKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("music")}
                    disabled={soundControlsDisabled || !backgroundMusicKey}
                    aria-label={
                      playing.music
                        ? "Pause music"
                        : "Play music"
                    }
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PreviewPlayPauseIcon
                      playing={playing.music}
                    />
                  </button>
                </div>

                <div className="flex flex-col gap-2 border-b border-border pb-6 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted sm:w-[5.25rem]">
                    Nature
                  </span>
                  <select
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={backgroundNatureKey}
                    onChange={(e) => {
                      setBackgroundNatureKey(e.target.value);
                    }}
                    disabled={soundControlsDisabled}
                  >
                    <option value="">None</option>
                    {backgroundNature.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex w-full flex-col gap-1 sm:w-40 sm:shrink-0">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Level</span>
                      <span className="tabular-nums">
                        {backgroundNatureGain}%
                      </span>
                    </div>
                    <input
                      aria-label="Nature level"
                      type="range"
                      min={0}
                      max={100}
                      value={backgroundNatureGain}
                      onChange={(e) =>
                        setBackgroundNatureGain(Number(e.target.value))
                      }
                      disabled={soundControlsDisabled || !backgroundNatureKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("nature")}
                    disabled={soundControlsDisabled || !backgroundNatureKey}
                    aria-label={
                      playing.nature
                        ? "Pause nature"
                        : "Play nature"
                    }
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PreviewPlayPauseIcon
                      playing={playing.nature}
                    />
                  </button>
                </div>

                {/* Drums fader removed for now; replaced by Noise. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted sm:w-[5.25rem]">
                    Noise
                  </span>
                  <select
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={backgroundNoiseKey}
                    onChange={(e) => {
                      setBackgroundNoiseKey(e.target.value);
                    }}
                    disabled={soundControlsDisabled}
                  >
                    <option value="">None</option>
                    {backgroundNoise.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex w-full flex-col gap-1 sm:w-40 sm:shrink-0">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Level</span>
                      <span className="tabular-nums">
                        {backgroundNoiseGain}%
                      </span>
                    </div>
                    <input
                      aria-label="Noise level"
                      type="range"
                      min={0}
                      max={100}
                      value={backgroundNoiseGain}
                      onChange={(e) =>
                        setBackgroundNoiseGain(Number(e.target.value))
                      }
                      disabled={soundControlsDisabled || !backgroundNoiseKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("noise")}
                    disabled={soundControlsDisabled || !backgroundNoiseKey}
                    aria-label={
                      playing.noise
                        ? "Pause noise"
                        : "Play noise"
                    }
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PreviewPlayPauseIcon
                      playing={playing.noise}
                    />
                  </button>
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted sm:w-[5.25rem]">
                    Length
                  </span>
                  <select
                    className="h-9 min-w-0 w-full max-w-[11rem] shrink-0 rounded-lg border border-border bg-background px-2.5 text-sm sm:w-auto"
                    value={meditationTargetMinutes}
                    onChange={(e) =>
                      setMeditationTargetMinutes(
                        parseMeditationTargetMinutes(Number(e.target.value)),
                      )
                    }
                    disabled={audioLoading}
                    aria-label="Target meditation length"
                    title="Coach + script target. Regenerate script if you already have one."
                  >
                    <option value={2}>2 min</option>
                    <option value={5}>5 min</option>
                    <option value={10}>10 min</option>
                  </select>
                </div>
              </div>

            </div>
          </section>
        </div>
          {draftSaveMessage ? (
            <p
              className="shrink-0 py-2 text-center text-xs text-muted sm:text-right"
              role="status"
              aria-live="polite"
            >
              {draftSaveMessage}
            </p>
          ) : null}
          <div className="shrink-0 border-t border-border/60 bg-background pt-4">
            <div className="flex min-h-[3rem] w-full flex-nowrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => {
                setMobileCreateStep("chat");
                setCreateStripStep(1);
              }}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              aria-label="Back to script and chat"
            >
              <IconChevronLeft className="shrink-0 text-accent" />
              Script
            </button>
            <div className="ml-auto flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
              <button
                type="button"
                onClick={() => void saveCurrentDraft()}
                disabled={draftSaving || soundControlsDisabled}
                className="shrink-0 cursor-pointer rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              >
                {draftSaving ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => void generateMeditationAudioAndShow()}
                disabled={audioLoading}
                className={`shrink-0 cursor-pointer whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-white shadow-md transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 ${
                  audioLoading ? "animate-pulse" : ""
                }`}
              >
                {audioLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <span>Generating…</span>
                    <svg
                      className="h-4 w-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      aria-hidden
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    </svg>
                  </span>
                ) : (
                  "Generate meditation"
                )}
              </button>
            </div>
            </div>
          </div>

          {/*
          Optional video, Markers, Manifestation (no wiring yet). Restore beside Speaker in sm:grid-cols-2 if needed.

          <Panel title="Optional video">
            <div className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted">
              Drop logo / short loop
              <span className="mt-1 text-[10px]">MP4 / MOV · mock UI</span>
            </div>
          </Panel>

          <Panel title="Markers">
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
                <span>Opening chime</span>
                <span className="text-xs text-muted">0:00</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
                <span>Pause · body settle</span>
                <span className="text-xs text-muted">2:30</span>
              </li>
              <li className="flex items-center justify-between rounded-lg bg-background px-3 py-2">
                <span>Section chime · visualization</span>
                <span className="text-xs text-muted">5:00</span>
              </li>
            </ul>
            <button
              type="button"
              className="mt-3 w-full rounded-xl border border-border py-2 text-xs font-medium text-muted hover:border-accent/40"
            >
              + Add marker
            </button>
          </Panel>

          <Panel title="Manifestation focus">
            <textarea
              rows={3}
              placeholder="e.g. Walk on stage feeling grounded; hear the first phrase clearly…"
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
            />
          </Panel>
          */}
        </div>
        ) : null}
      </div>
      )}

      {audioModalUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Meditation audio</div>
                <div className="text-xs text-muted">
                  Streaming from CloudFront (MP3)
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAudioModalUrl(null)}
                className="cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground"
              >
                Close
              </button>
            </div>

            {audioError ? (
              <div className="mt-3 rounded-lg border border-border bg-background p-2 text-xs text-muted">
                {audioError}
              </div>
            ) : null}

            <audio controls src={audioModalUrl} className="mt-4 w-full" />

            {lastUsedScript && (
              <details className="mt-3 rounded-lg border border-border bg-background p-3 text-xs">
                <summary className="cursor-pointer font-semibold text-foreground">
                  Show script used for this audio
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                  {lastUsedScript}
                </div>
              </details>
            )}

            <div className="mt-3 flex gap-2">
              <a
                href={audioModalUrl}
                target="_blank"
                rel="noreferrer"
                className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-accent/50"
              >
                Download
              </a>
              {audioModalKey ? (
                <Link
                  href={`/meditate/library?focus=${encodeURIComponent(audioModalKey)}&play=1`}
                  className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-accent/50"
                >
                  View in Library
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card shadow-sm">
      <div className="shrink-0 border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
