import {
  isMeditationTargetMinutes,
  type MedimadeChatTurn,
  type MeditationTargetMinutes,
  type TtsProvider,
} from "@/lib/medimade-api";
import type { CreateMeditationPath } from "@/lib/create-meditation-path";

export const CREATE_SESSION_STORAGE_KEY = "mm_create_session_v1";
export const CREATE_SESSION_VERSION = 1 as const;

export type CreateSessionPhase =
  | "stylePick"
  | "styleQuestions"
  | "style"
  | "feeling"
  | "claude"
  | "journalPick"
  | "goalPick"
  | "promptPick";

export type CreateSessionMessage = {
  role: "assistant" | "user";
  text: string;
  variant?: "chat" | "script";
  muted?: boolean;
  kind?: "divider";
  journalSegments?: Array<{
    entryId: string;
    title: string;
    bodyPlain: string;
    createdAt?: string;
  }>;
  audioReadyCta?: boolean;
};

export type CreateSessionV1 = {
  v: typeof CREATE_SESSION_VERSION;
  pathname: string;
  creationPath: CreateMeditationPath;
  initedPaths: CreateMeditationPath[];
  phase: CreateSessionPhase;
  journalMode: boolean;
  meditationStyle: string | null;
  pendingStyleType: string | null;
  styleQuestionAnswers: [string, string, string, string];
  styleQuestionsRevealed: number;
  messages: CreateSessionMessage[];
  claudeThread: MedimadeChatTurn[];
  input: string;
  speakerModelId: string;
  ttsProvider: TtsProvider;
  orpheusVoiceId: string;
  speakerFxPreviewOn: boolean;
  backgroundNatureKey: string;
  backgroundMusicKey: string;
  backgroundDrumsKey: string;
  backgroundNoiseKey: string;
  /** Which sound bed the page is on: a ready-made composition or the mixer. */
  soundMode: "soundscape" | "mixer";
  compositionKey: string;
  backgroundNatureGain: number;
  backgroundMusicGain: number;
  backgroundDrumsGain: number;
  backgroundNoiseGain: number;
  createStripStep: 0 | 1 | 2;
  mobileCreateStep: "chat" | "audio";
  lastUsedScript: string | null;
  meditationTargetMinutes: MeditationTargetMinutes;
  pendingModeChoice: null | "style" | "freeflow" | "journalReflect" | "goal" | "oneShot";
  journalReflectSelectedIds: string[];
  journalReflectGuidance: string;
  goalSelectedId: string | null;
  oneShotPrompt: string;
  draftSk: string | null;
  coachAudioReady: boolean;
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isCreatePath(v: unknown): v is CreateMeditationPath {
  return (
    v === "pending" ||
    v === "style" ||
    v === "freeflow" ||
    v === "journalReflect" ||
    v === "goal" ||
    v === "oneShot"
  );
}

function isPhase(v: unknown): v is CreateSessionPhase {
  return (
    v === "stylePick" ||
    v === "styleQuestions" ||
    v === "style" ||
    v === "feeling" ||
    v === "claude" ||
    v === "journalPick" ||
    v === "goalPick" ||
    v === "promptPick"
  );
}

function isMessage(v: unknown): v is CreateSessionMessage {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.role !== "assistant" && o.role !== "user") return false;
  return typeof o.text === "string";
}

function isTurn(v: unknown): v is MedimadeChatTurn {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (o.role !== "assistant" && o.role !== "user") return false;
  return typeof o.content === "string";
}

export function parseCreateSession(raw: unknown): CreateSessionV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== CREATE_SESSION_VERSION) return null;
  if (typeof o.pathname !== "string") return null;
  if (!isCreatePath(o.creationPath)) return null;
  if (!Array.isArray(o.initedPaths) || !o.initedPaths.every(isCreatePath)) {
    return null;
  }
  if (!isPhase(o.phase)) return null;
  if (typeof o.journalMode !== "boolean") return null;
  if (o.meditationStyle != null && typeof o.meditationStyle !== "string") {
    return null;
  }
  if (o.pendingStyleType != null && typeof o.pendingStyleType !== "string") {
    return null;
  }
  if (
    !Array.isArray(o.styleQuestionAnswers) ||
    o.styleQuestionAnswers.length < 3 ||
    !o.styleQuestionAnswers.every((x) => typeof x === "string")
  ) {
    return null;
  }
  const answers: [string, string, string, string] = [
    String(o.styleQuestionAnswers[0] ?? ""),
    String(o.styleQuestionAnswers[1] ?? ""),
    String(o.styleQuestionAnswers[2] ?? ""),
    String(o.styleQuestionAnswers[3] ?? ""),
  ];
  if (
    typeof o.styleQuestionsRevealed !== "number" ||
    !Number.isFinite(o.styleQuestionsRevealed)
  ) {
    return null;
  }
  if (!Array.isArray(o.messages) || !o.messages.every(isMessage)) return null;
  if (!Array.isArray(o.claudeThread) || !o.claudeThread.every(isTurn)) {
    return null;
  }
  if (typeof o.input !== "string") return null;
  if (typeof o.speakerModelId !== "string") return null;
  if (o.ttsProvider !== "fish" && o.ttsProvider !== "orpheus") return null;
  if (typeof o.orpheusVoiceId !== "string") return null;
  if (typeof o.speakerFxPreviewOn !== "boolean") return null;
  if (typeof o.backgroundNatureKey !== "string") return null;
  if (typeof o.backgroundMusicKey !== "string") return null;
  if (typeof o.backgroundDrumsKey !== "string") return null;
  if (typeof o.backgroundNoiseKey !== "string") return null;
  if (!isFiniteNumber(o.backgroundNatureGain)) return null;
  if (!isFiniteNumber(o.backgroundMusicGain)) return null;
  if (!isFiniteNumber(o.backgroundDrumsGain)) return null;
  if (!isFiniteNumber(o.backgroundNoiseGain)) return null;
  if (o.createStripStep !== 0 && o.createStripStep !== 1 && o.createStripStep !== 2) {
    return null;
  }
  if (o.mobileCreateStep !== "chat" && o.mobileCreateStep !== "audio") {
    return null;
  }
  if (o.lastUsedScript != null && typeof o.lastUsedScript !== "string") {
    return null;
  }
  if (!isMeditationTargetMinutes(o.meditationTargetMinutes)) return null;
  const pending = o.pendingModeChoice;
  if (
    pending !== null &&
    pending !== "style" &&
    pending !== "freeflow" &&
    pending !== "journalReflect" &&
    pending !== "goal" &&
    pending !== "oneShot"
  ) {
    return null;
  }
  if (
    !Array.isArray(o.journalReflectSelectedIds) ||
    !o.journalReflectSelectedIds.every((x) => typeof x === "string")
  ) {
    return null;
  }
  if (o.goalSelectedId != null && typeof o.goalSelectedId !== "string") {
    return null;
  }
  if (o.draftSk != null && typeof o.draftSk !== "string") return null;

  return {
    v: CREATE_SESSION_VERSION,
    pathname: o.pathname,
    creationPath: o.creationPath,
    initedPaths: o.initedPaths as CreateMeditationPath[],
    phase: o.phase,
    journalMode: o.journalMode,
    meditationStyle: typeof o.meditationStyle === "string" ? o.meditationStyle : null,
    pendingStyleType:
      typeof o.pendingStyleType === "string" ? o.pendingStyleType : null,
    styleQuestionAnswers: answers,
    styleQuestionsRevealed: Math.min(4, Math.max(1, o.styleQuestionsRevealed)),
    messages: o.messages as CreateSessionMessage[],
    claudeThread: o.claudeThread as MedimadeChatTurn[],
    input: o.input,
    speakerModelId: o.speakerModelId,
    ttsProvider: o.ttsProvider,
    orpheusVoiceId: o.orpheusVoiceId,
    speakerFxPreviewOn: o.speakerFxPreviewOn,
    backgroundNatureKey: o.backgroundNatureKey,
    backgroundMusicKey: o.backgroundMusicKey,
    backgroundDrumsKey: o.backgroundDrumsKey,
    backgroundNoiseKey: o.backgroundNoiseKey,
    soundMode: o.soundMode === "mixer" ? "mixer" : "soundscape",
    compositionKey: typeof o.compositionKey === "string" ? o.compositionKey : "",
    backgroundNatureGain: o.backgroundNatureGain,
    backgroundMusicGain: o.backgroundMusicGain,
    backgroundDrumsGain: o.backgroundDrumsGain,
    backgroundNoiseGain: o.backgroundNoiseGain,
    createStripStep: o.createStripStep,
    mobileCreateStep: o.mobileCreateStep,
    lastUsedScript: typeof o.lastUsedScript === "string" ? o.lastUsedScript : null,
    meditationTargetMinutes: o.meditationTargetMinutes,
    pendingModeChoice: pending,
    journalReflectSelectedIds: o.journalReflectSelectedIds as string[],
    journalReflectGuidance:
      typeof o.journalReflectGuidance === "string" ? o.journalReflectGuidance : "",
    goalSelectedId: typeof o.goalSelectedId === "string" ? o.goalSelectedId : null,
    oneShotPrompt: typeof o.oneShotPrompt === "string" ? o.oneShotPrompt : "",
    draftSk: typeof o.draftSk === "string" ? o.draftSk : null,
    coachAudioReady: o.coachAudioReady === true,
  };
}

export function readCreateSession(): CreateSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CREATE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    return parseCreateSession(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeCreateSession(session: CreateSessionV1): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CREATE_SESSION_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* quota / private mode */
  }
}

export function clearCreateSession(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(CREATE_SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function createSessionSatisfiesRoute(
  session: CreateSessionV1,
  path: CreateMeditationPath,
  styleStep: "type" | "questions",
  mix: boolean,
): boolean {
  if (path === "style" && styleStep === "questions") {
    return Boolean(session.meditationStyle?.trim());
  }
  if (mix && path === "style") {
    return Boolean(session.meditationStyle?.trim());
  }
  return true;
}
