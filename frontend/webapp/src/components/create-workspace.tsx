"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import * as Switch from "@radix-ui/react-switch";
import * as Tooltip from "@radix-ui/react-tooltip";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  type MedimadeChatTurn,
  type MeditationDraftStateV1,
  MEDITATION_DRAFT_STATE_VERSION,
  streamMedimadeChat,
  streamMeditationScript,
  createMeditationAudioJob,
  getMeditationAudioJobStatus,
  getMeditationDraft,
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  listFishSpeakers,
  saveMeditationDraft,
  type FishSpeaker,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import {
  SPEAKER_SAMPLE_SPEED_MAX,
  SPEAKER_SAMPLE_SPEED_MIN,
  SPEAKER_SAMPLE_SPEED_STEP,
  snapSpeakerSampleSpeed,
  speakerPreviewFxSampleKey,
  speakerPreviewLoudFxSampleKey,
  speakerPreviewLoudSampleKey,
  speakerPreviewSampleKey,
} from "@/lib/speaker-sample-speed";

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

const SPEAKER_SAMPLE_GAP_MS = 3000;

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

function deriveTitleAndDescriptionFromScript(script: string | null): {
  title: string;
  description: string | null;
} {
  const fallback = { title: "Generating meditation…", description: null };
  if (!script) return fallback;
  const lines = script
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return fallback;
  const first = lines[0].replace(/^#+\s*/, "").trim();
  const title = first.length > 0 ? first.slice(0, 80) : fallback.title;
  const descLine = lines.find((l) => l.length > 20 && l !== lines[0]) ?? null;
  const description = descLine ? descLine.replace(/^[-*]\s+/, "").slice(0, 140) : null;
  return { title, description };
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

/** Tailwind `lg` breakpoint (1024px); SSR defaults false (mobile-first slide). */
function useLgViewport(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia("(min-width: 1024px)");
      mq.addEventListener("change", onStoreChange);
      return () => mq.removeEventListener("change", onStoreChange);
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
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

type SoloTrack = "speaker" | "nature" | "music" | "drums";

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

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  /** Distinct styling for generated meditation script vs coach replies. */
  variant?: "chat" | "script";
  muted?: boolean;
  kind?: "divider";
};

const meditationStyles = [
  "Body scan",
  "Visualization",
  "Breath-led",
  "Manifestation",
  "Affirmation loop",
  "Sleep",
  "Loving-kindness",
  "Anxiety relief",
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
  Sleep:
    "Gentle, slower pacing designed to help you wind down and drift off.",
  "Loving-kindness":
    "Warm, compassionate phrases for yourself and others (metta practice).",
  "Anxiety relief":
    "Grounding cues + reassurance to reduce anxious arousal and regain steadiness.",
};

type Phase = "style" | "feeling" | "claude";

const OPENING_STYLE =
  "What style of meditation should we build? Pick one below or describe your own.";
const OPENING_JOURNAL = "What’s on your mind?";

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
  if (typeof o.backgroundDrumsKey !== "string") return false;
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
  if (
    typeof o.backgroundDrumsGain !== "number" ||
    !Number.isFinite(o.backgroundDrumsGain)
  ) {
    return false;
  }
  if (o.mobileCreateStep !== "chat" && o.mobileCreateStep !== "audio") {
    return false;
  }
  if (o.meditationStyle != null && typeof o.meditationStyle !== "string") {
    return false;
  }
  if (o.lastUsedScript != null && typeof o.lastUsedScript !== "string") {
    return false;
  }
  return true;
}

type CreateWorkspaceProps = {
  initialDraftSk?: string | null;
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
  const trimmed = style.trim();
  if (trimmed) {
    return `How are you feeling today—and what do you want this “${trimmed}” meditation to support?`;
  }
  return "How are you feeling today—and what do you want this meditation to support?";
}

export function CreateWorkspace({
  initialDraftSk = null,
}: CreateWorkspaceProps) {
  const router = useRouter();
  const isRedirectingToLibraryRef = useRef(false);
  const isLgViewport = useLgViewport();
  const [mobileCreateStep, setMobileCreateStep] = useState<"chat" | "audio">(
    "chat",
  );

  useEffect(() => {
    if (isLgViewport) setMobileCreateStep("chat");
  }, [isLgViewport]);

  // Reduce perceived navigation latency (and any browser "redirecting" UI) by prefetching Library.
  useEffect(() => {
    router.prefetch("/library");
  }, [router]);

  const [phase, setPhase] = useState<Phase>("style");
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioModalUrl, setAudioModalUrl] = useState<string | null>(null);
  const [audioModalKey, setAudioModalKey] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lastUsedScript, setLastUsedScript] = useState<string | null>(null);
  const [speechSpeed, setSpeechSpeed] = useState<number>(() =>
    snapSpeakerSampleSpeed(1),
  );
  /** When on, speaker row plays CDN `*-fx.wav` (Pedalboard preset mixer); when off, dry Fish `*.mp3`. */
  const [speakerFxPreviewOn, setSpeakerFxPreviewOn] = useState(true);
  const [backgroundNature, setBackgroundNature] = useState<
    BackgroundAudioItem[]
  >([]);
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundDrums, setBackgroundDrums] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);
  const [backgroundNatureKey, setBackgroundNatureKey] = useState<string>("");
  const [backgroundMusicKey, setBackgroundMusicKey] = useState<string>("");
  const [backgroundDrumsKey, setBackgroundDrumsKey] = useState<string>("");
  const [backgroundNatureGain, setBackgroundNatureGain] = useState(50);
  const [backgroundMusicGain, setBackgroundMusicGain] = useState(70);
  const [backgroundDrumsGain, setBackgroundDrumsGain] = useState(70);
  const [playAllActive, setPlayAllActive] = useState(false);
  const [playing, setPlaying] = useState<Record<SoloTrack, boolean>>({
    speaker: false,
    nature: false,
    music: false,
    drums: false,
  });
  const previewNatureRef = useRef<HTMLAudioElement | null>(null);
  const previewMusicRef = useRef<HTMLAudioElement | null>(null);
  const previewDrumsRef = useRef<HTMLAudioElement | null>(null);
  const speakerSampleRef = useRef<HTMLAudioElement | null>(null);
  const speakerGapTimeoutRef = useRef<number | null>(null);
  const speakerRepeatWantedRef = useRef(false);
  const lastBgKeysRef = useRef<{ nature: string; music: string; drums: string }>({
    nature: "",
    music: "",
    drums: "",
  });
  // Speakers come from backend `GET /fish/speakers` (single source of truth).
  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: OPENING_STYLE,
      variant: "chat",
    },
  ]);
  const [introTypingDone, setIntroTypingDone] = useState(false);
  const introTypingTimerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [input, setInput] = useState("");
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const [speakerModelId, setSpeakerModelId] = useState<string>("");
  const [journalMode, setJournalMode] = useState(false);
  const [journalConfirmOpen, setJournalConfirmOpen] = useState(false);
  const pendingJournalModeRef = useRef<boolean | null>(null);

  const [draftSk, setDraftSk] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveMessage, setDraftSaveMessage] = useState<string | null>(null);

  const soundControlsDisabled =
    audioLoading && !isRedirectingToLibraryRef.current;
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);

  function buildDraftState(): MeditationDraftStateV1 {
    return {
      v: MEDITATION_DRAFT_STATE_VERSION,
      phase,
      meditationStyle,
      messages,
      claudeThread,
      input,
      speechSpeed,
      speakerModelId,
      backgroundNatureKey,
      backgroundMusicKey,
      backgroundDrumsKey,
      backgroundNatureGain,
      backgroundMusicGain,
      backgroundDrumsGain,
      mobileCreateStep,
      lastUsedScript,
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
    if (!sk) return;
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
          return;
        }
        const s = row.draftState;
        setPhase(s.phase);
        setMeditationStyle(s.meditationStyle);
        setMessages(s.messages);
        setClaudeThread(s.claudeThread);
        setInput(s.input);
        setSpeechSpeed(snapSpeakerSampleSpeed(s.speechSpeed));
        setSpeakerModelId(s.speakerModelId);
        setBackgroundNatureKey(s.backgroundNatureKey);
        setBackgroundMusicKey(s.backgroundMusicKey);
        setBackgroundDrumsKey(s.backgroundDrumsKey);
        setBackgroundNatureGain(s.backgroundNatureGain);
        setBackgroundMusicGain(s.backgroundMusicGain);
        setBackgroundDrumsGain(s.backgroundDrumsGain);
        setMobileCreateStep(s.mobileCreateStep);
        setLastUsedScript(s.lastUsedScript);
        setDraftSk(row.sk);
      } catch (e) {
        if (!cancelled) {
          setDraftLoadError(
            e instanceof Error ? e.message : "Could not load draft",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialDraftSk]);

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
      .map((m) => `${m.role === "user" ? "User" : "Guide"}: ${m.text}`)
      .join("\n\n");
    setScriptLoading(true);
    try {
      let acc = "";
      let assistantBubbleStarted = false;
      await streamMeditationScript(
        { meditationStyle, transcript },
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
      { meditationStyle: style, messages: history },
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

  function applyJournalToggle(next: boolean) {
    pendingJournalModeRef.current = null;
    setJournalMode(next);

    const hasAnyUserMessage = messages.some((m) => m.role === "user");
    const hasGeneratedScript = messages.some(
      (m) => m.role === "assistant" && m.variant === "script",
    );

    // Reset all backend-driven state for a fresh chat start.
    setChatLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");

    // If nothing has been sent yet, silently swap the opening message and clear chat.
    if (!hasAnyUserMessage && !hasGeneratedScript) {
      setIntroTypingDone(false);
      setMessages([
        { role: "assistant", text: "", variant: "chat" },
      ]);
      // typing animation is handled by effect watching `messages`
      // and will use the correct opening based on `journalMode`.
      setPhase(next ? "feeling" : "style");
      focusChatInput();
      return;
    }

    // Otherwise, preserve history (muted), add divider, and start fresh below.
    setMessages((prev) => [
      ...prev.map((x) => ({ ...x, muted: true })),
      {
        role: "assistant",
        text: "──── switched mode ────",
        variant: "chat",
        muted: true,
        kind: "divider",
      },
      { role: "assistant", text: "", variant: "chat" },
    ]);
    setIntroTypingDone(false);
    setPhase(next ? "feeling" : "style");
    focusChatInput();
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
    // Only when we are at the start of a mode (style or journal feeling) and not already chatting.
    if (chatLoading || scriptLoading) return;
    if (!(phase === "style" || (journalMode && phase === "feeling" && !meditationStyle))) return;
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
    const opening = journalMode && phase === "feeling" && !meditationStyle ? OPENING_JOURNAL : OPENING_STYLE;
    const m = messages[idx];
    if (m.text === opening) {
      setIntroTypingDone(true);
      return;
    }
    // Only type if the message is empty (fresh) or equals one of the opening strings.
    if (m.text.trim().length === 0 || m.text === OPENING_STYLE || m.text === OPENING_JOURNAL) {
      startIntroTyping(idx, opening);
    }
    return () => {
      clearIntroTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, journalMode, meditationStyle, chatLoading, scriptLoading, messages.length]);

  function requestJournalToggle(next: boolean) {
    const hasGeneratedScript = messages.some(
      (m) => m.role === "assistant" && m.variant === "script",
    );
    if (hasGeneratedScript) {
      pendingJournalModeRef.current = next;
      setJournalConfirmOpen(true);
      return;
    }
    applyJournalToggle(next);
  }

  function focusChatInput() {
    requestAnimationFrame(() => {
      chatInputRef.current?.focus();
    });
  }

  function resetChatKeepMode() {
    // Keep `journalMode` as-is; reset the chat and retrigger the intro typing animation.
    pendingJournalModeRef.current = null;
    setJournalConfirmOpen(false);
    setChatLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    setPhase(journalMode ? "feeling" : "style");
    isAtBottomRef.current = true;
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
    });
    focusChatInput();
  }

  async function send() {
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
          { meditationStyle: styleHint, messages: history },
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
          { meditationStyle: style, messages: history },
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
          { meditationStyle: style, messages: nextMessages },
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
        { meditationStyle: style, messages: history },
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
      const startedAt = Date.now();
      const last = messages[messages.length - 1];
      const existingScript =
        last?.role === "assistant" && last.variant === "script"
          ? last.text
          : null;

      const transcript = messages
        .filter((m) => !(m.role === "assistant" && m.variant === "script"))
        .map((m) => `${m.role === "user" ? "User" : "Guide"}: ${m.text}`)
        .join("\n\n");

      const { jobId } = await createMeditationAudioJob({
        meditationStyle,
        transcript,
        scriptText: existingScript,
        reference_id: speakerModelId,
        speed: speechSpeed,
        voiceFxPreset: speakerFxPreviewOn ? "mixer" : null,
        ...(backgroundNatureKey
          ? {
              backgroundNatureKey,
              backgroundNatureGain,
            }
          : {}),
        ...(backgroundMusicKey
          ? {
              backgroundMusicKey,
              backgroundMusicGain,
            }
          : {}),
        ...(backgroundDrumsKey
          ? {
              backgroundDrumsKey,
              backgroundDrumsGain,
            }
          : {}),
      });

      // Wait until (a) at least 2s has elapsed AND (b) the script-derived metadata is ready.
      // The backend generates the script first, then derives title/description, then does slow audio work.
      let metaTitle: string | null = null;
      let metaDesc: string | null = null;
      const metaDeadlineMs = 30_000;
      const metaStart = Date.now();
      while (Date.now() - metaStart < metaDeadlineMs) {
        try {
          const st = await getMeditationAudioJobStatus(jobId);
          const t = (st.title ?? "").trim();
          const d = (st.description ?? "").trim();
          if (t) metaTitle = t;
          if (d) metaDesc = d;
          if (metaTitle && metaDesc) break;
          // If we at least have a title, that's enough to avoid the fallback card.
          if (metaTitle) break;
        } catch {
          // ignore transient status errors
        }
        await new Promise((r) => setTimeout(r, 350));
      }

      const fallback = deriveTitleAndDescriptionFromScript(
        existingScript ?? lastUsedScript,
      );
      const title = metaTitle ?? fallback.title;
      const description = metaDesc ?? fallback.description;
      const speakerName =
        fishSpeakers.find((s) => s.modelId === speakerModelId)?.name ?? null;

      const pending: PendingLibraryGeneration = {
        jobId,
        createdAt: new Date().toISOString(),
        title,
        description,
        meditationStyle,
        speakerName,
        speakerModelId,
      };
      const nextPending = [pending, ...loadPendingGenerations()].filter(
        (x, idx, arr) => arr.findIndex((y) => y.jobId === x.jobId) === idx,
      );
      savePendingGenerations(nextPending);

      // Keep the button in "Generating…" state for at least 2 seconds, then redirect to Library.
      const elapsed = Date.now() - startedAt;
      const remaining = Math.max(0, 2000 - elapsed);
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      isRedirectingToLibraryRef.current = true;
      router.push(`/library?focus=${encodeURIComponent(`pending:${jobId}`)}`);
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
        setBackgroundDrums(data.drums);
        const fromApi = data.baseUrl?.trim();
        setMediaBaseUrl(fromApi || envMediaBase || null);
      } catch {
        if (cancelled) return;
        setBackgroundNature([]);
        setBackgroundMusic([]);
        setBackgroundDrums([]);
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
      el.volume = Math.min(1, Math.max(0, gain / 100));
      if (base && key) {
        const next = mediaFileUrl(base, key);
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
    void sync(previewDrumsRef.current, backgroundDrumsKey, backgroundDrumsGain, "drums");
  }, [
    mediaBaseUrl,
    backgroundNatureKey,
    backgroundMusicKey,
    backgroundDrumsKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundDrumsGain,
    playing.nature,
    playing.music,
    playing.drums,
  ]);

  function clearSpeakerGapSchedule() {
    if (speakerGapTimeoutRef.current !== null) {
      clearTimeout(speakerGapTimeoutRef.current);
      speakerGapTimeoutRef.current = null;
    }
  }

  const anyTrackPlaying =
    playing.speaker || playing.nature || playing.music || playing.drums;

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
    } else if (track === "drums") {
      previewDrumsRef.current?.pause();
    }
    setPlaying((p) => ({ ...p, [track]: false }));
  }

  function stopAllAudioPreview() {
    clearSpeakerGapSchedule();
    speakerRepeatWantedRef.current = false;
    previewNatureRef.current?.pause();
    previewMusicRef.current?.pause();
    previewDrumsRef.current?.pause();
    speakerSampleRef.current?.pause();
    setPlayAllActive(false);
    setPlaying({ speaker: false, nature: false, music: false, drums: false });
  }

  useEffect(() => {
    return () => {
      clearSpeakerGapSchedule();
      [previewNatureRef, previewMusicRef, previewDrumsRef].forEach((r) => {
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
    if (backgroundDrumsKey && previewDrumsRef.current?.src) {
      parts.push(previewDrumsRef.current.play());
    }

    if (parts.length === 0) return;

    setPlayAllActive(true);
    setPlaying({
      speaker: Boolean(sp?.src),
      nature: Boolean(backgroundNatureKey && previewNatureRef.current?.src),
      music: Boolean(backgroundMusicKey && previewMusicRef.current?.src),
      drums: Boolean(backgroundDrumsKey && previewDrumsRef.current?.src),
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
    if (track === "drums" && !backgroundDrumsKey) return;

    const el =
      track === "speaker"
        ? speakerSampleRef.current
        : track === "nature"
          ? previewNatureRef.current
          : track === "music"
            ? previewMusicRef.current
            : previewDrumsRef.current;

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

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      <div className="mb-6 shrink-0">
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Create a meditation
        </h1>
        <p className="mt-2 text-muted">
          Choose a style, share how you’re feeling, and chat with the guide to
          shape your script. Then, pick a voice, mix nature sounds, music, and
          drums, and preview the blend before you create your meditation audio.
        </p>
      </div>

      {draftLoadError ? (
        <div
          className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
          role="alert"
        >
          {draftLoadError}
        </div>
      ) : null}

      {/* Mobile (&lt;lg): horizontal slide Script → Audio. lg+: two-column grid. */}
      <div className="min-h-0 flex-1 overflow-hidden lg:overflow-visible">
        <div
          className={`flex h-full min-h-0 w-[200%] flex-row transition-transform duration-300 ease-out will-change-transform motion-reduce:duration-0 lg:grid lg:h-full lg:w-full lg:min-h-0 lg:translate-x-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] lg:gap-8 ${
            !isLgViewport && mobileCreateStep === "audio"
              ? "-translate-x-1/2"
              : "translate-x-0"
          }`}
        >
          <div className="flex h-full min-h-0 w-1/2 min-w-0 shrink-0 flex-col lg:contents">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 lg:h-full lg:min-h-0">
        <section className="flex min-h-[40vh] w-full flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:h-full lg:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold tracking-tight">Script</h2>
            </div>
            <Tooltip.Provider delayDuration={250} disableHoverableContent>
              <div className="inline-flex shrink-0 items-center gap-2">
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-muted">
                      <input
                        type="checkbox"
                        checked={journalMode}
                        onChange={(e) => requestJournalToggle(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-border accent-foreground"
                        aria-label="Journal mode"
                      />
                      <span>Journal mode</span>
                    </label>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="top"
                      align="center"
                      sideOffset={8}
                      className="max-w-[16rem] rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-foreground shadow-md"
                    >
                      Mood based questions
                      <Tooltip.Arrow className="fill-card stroke-border" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>

                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      onClick={resetChatKeepMode}
                      aria-label="Reset chat"
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
            <button
              type="button"
              onClick={() => void generateScript()}
              disabled={scriptLoading}
              className="ml-3 shrink-0 cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-accent/50 hover:bg-accent-soft/35 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {scriptLoading ? "…" : "Preview script"}
            </button>
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
              <div ref={messagesEndRef} />
            </div>
            <div className="mt-3 flex shrink-0 gap-2 border-t border-border pt-3">
              <input
                ref={chatInputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void send()}
                aria-busy={chatLoading || scriptLoading}
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
                disabled={chatLoading || scriptLoading}
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
          </div>
        </section>

          <div className="flex shrink-0 justify-end lg:hidden">
            <button
              type="button"
              onClick={() => setMobileCreateStep("audio")}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              aria-label="Next: audio and voice settings"
            >
              <span>Audio & voice</span>
              <IconChevronRight className="text-accent" />
            </button>
          </div>
        </div>
          </div>

          <div className="flex h-full min-h-0 w-1/2 min-w-0 shrink-0 flex-col gap-6 overflow-y-auto pb-12 lg:contents lg:overflow-visible lg:pb-0">
        <div className="flex min-h-0 w-full flex-1 flex-col gap-6 pb-12 lg:h-full lg:min-h-0 lg:max-h-full lg:flex-1 lg:flex-col lg:gap-4 lg:overflow-hidden lg:pb-4 max-lg:min-h-0">
          <section className="rounded-2xl border border-border bg-card shadow-sm lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-hidden">
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

            <div className="p-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              <audio ref={previewNatureRef} className="hidden" playsInline />
              <audio ref={previewMusicRef} className="hidden" playsInline />
              <audio ref={previewDrumsRef} className="hidden" playsInline />
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
                  <div className="flex w-full flex-col gap-1 sm:w-40 sm:shrink-0">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Speed</span>
                      <span className="tabular-nums">
                        {speechSpeed.toFixed(2)}×
                      </span>
                    </div>
                    <input
                      aria-label="Voice speed"
                      type="range"
                      min={SPEAKER_SAMPLE_SPEED_MIN}
                      max={SPEAKER_SAMPLE_SPEED_MAX}
                      step={SPEAKER_SAMPLE_SPEED_STEP}
                      value={speechSpeed}
                      onChange={(e) =>
                        setSpeechSpeed(
                          snapSpeakerSampleSpeed(Number(e.target.value)),
                        )
                      }
                      disabled={soundControlsDisabled}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
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

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted sm:w-[5.25rem]">
                    Drums
                  </span>
                  <select
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                    value={backgroundDrumsKey}
                    onChange={(e) => {
                      setBackgroundDrumsKey(e.target.value);
                    }}
                    disabled={soundControlsDisabled}
                  >
                    <option value="">None</option>
                    {backgroundDrums.map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex w-full flex-col gap-1 sm:w-40 sm:shrink-0">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>Level</span>
                      <span className="tabular-nums">
                        {backgroundDrumsGain}%
                      </span>
                    </div>
                    <input
                      aria-label="Drums level"
                      type="range"
                      min={0}
                      max={100}
                      value={backgroundDrumsGain}
                      onChange={(e) =>
                        setBackgroundDrumsGain(Number(e.target.value))
                      }
                      disabled={soundControlsDisabled || !backgroundDrumsKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("drums")}
                    disabled={soundControlsDisabled || !backgroundDrumsKey}
                    aria-label={
                      playing.drums
                        ? "Pause drums"
                        : "Play drums"
                    }
                    className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 dark:text-deep disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <PreviewPlayPauseIcon
                      playing={playing.drums}
                    />
                  </button>
                </div>
              </div>

              {!mediaBaseUrl ? (
                <p className="mt-6 text-xs text-muted">
                  Sound preview is not available here. Your meditations still
                  generate with the mix you choose.
                </p>
              ) : null}

              <button
                type="button"
                className="mt-6 w-full cursor-pointer rounded-xl border border-dashed border-gold/60 bg-gold/5 py-2 text-xs font-medium text-gold"
              >
                Voice cloning setup (Pro)
              </button>
            </div>
          </section>

          <div className="mt-5 flex min-h-[3rem] w-full shrink-0 flex-nowrap items-center justify-between gap-4 px-0 lg:mt-0 lg:shrink-0">
            <button
              type="button"
              onClick={() => setMobileCreateStep("chat")}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition-colors hover:bg-neutral-50 lg:hidden dark:border-neutral-300 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-100"
              aria-label="Back to script and chat"
            >
              <IconChevronLeft className="shrink-0 text-accent" />
              Script
            </button>
            <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2 lg:ml-auto">
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
                {audioLoading ? "Generating…" : "Generate meditation"}
              </button>
            </div>
          </div>
          {draftSaveMessage ? (
            <p
              className="mt-2 shrink-0 text-center text-xs text-muted sm:text-right lg:mt-1 lg:text-right"
              role="status"
              aria-live="polite"
            >
              {draftSaveMessage}
            </p>
          ) : null}

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
          </div>
        </div>
      </div>

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
                  href={`/library?focus=${encodeURIComponent(audioModalKey)}&play=1`}
                  className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-accent/50"
                >
                  View in Library
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {journalConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
            <div className="text-sm font-semibold text-foreground">
              Starting over will replace your current script. Continue?
            </div>
            <div className="mt-4 flex justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  pendingJournalModeRef.current = null;
                  setJournalConfirmOpen(false);
                }}
                className="cursor-pointer rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-accent/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = pendingJournalModeRef.current;
                  pendingJournalModeRef.current = null;
                  setJournalConfirmOpen(false);
                  if (typeof next === "boolean") applyJournalToggle(next);
                }}
                className="cursor-pointer rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 dark:text-deep"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
