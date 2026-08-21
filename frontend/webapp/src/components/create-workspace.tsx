"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { DrumsLockedWrap } from "@/components/drums-locked-wrap";
import { MixerChannel, MixerPresetChannel, MixerVoiceChannel } from "@/components/mixer-channel";
import { isMelodicMusicKey } from "@/lib/sound-taxonomy";
import {
  CREATE_MEDITATE_ROOT,
  createMeditationHref,
  createMeditationHrefWithDraft,
  createMeditationPathStartHref,
  createRouteNeedsPriorState,
  parseCreateMeditationPathname,
  type CreateMeditationPath,
} from "@/lib/create-meditation-path";
import {
  clearCreateSession,
  createSessionSatisfiesRoute,
  readCreateSession,
  writeCreateSession,
  type CreateSessionV1,
} from "@/lib/create-session-storage";
import { JournalReflectPicker } from "@/components/journal-reflect-picker";
import { MeditationTypeCardGrid } from "@/components/community-category-grid";
import {
  DictationMicButton,
  appendSpokenText,
} from "@/components/dictation-mic-button";
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
  fetchJournalStoreRemote,
  listBackgroundAudio,
  listFishSpeakers,
  listOrpheusSpeakers,
  saveMeditationDraft,
  backgroundAudioStreamingKey,
  type FishSpeaker,
  type OrpheusSpeaker,
  type TtsProvider,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import {
  DEFAULT_ORPHEUS_VOICE_ID,
  ORPHEUS_VOICES,
} from "@/lib/orpheus-voices";
import {
  factoryPresetToMix,
  type MixerFactoryPreset,
} from "@/lib/mixer-factory-presets";
import {
  loadMixerPresetStore,
  mixerPresetToMix,
  mixEquals,
  newMixerPreset,
  saveMixerPresetStore,
  type MixerPreset,
  type MixerPresetMix,
} from "@/lib/mixer-preset-storage";
import {
  FIXED_SPEECH_PREVIEW_SPEED,
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
  isGratitudeEntry,
  journalEntryPlainForHandoff,
  loadJournalStore,
  parseJournalMeditationPayload,
  peekJournalMeditationHandoffJson,
  saveJournalStore,
  shouldPreferRemoteJournalStore,
  type JournalEntry,
  type JournalFolder,
} from "@/lib/journal-storage";
import {
  PLAN_CREATE_FIRST_MESSAGE,
  PLAN_CREATE_OPENING_ASSISTANT,
  buildPlanCreateHandoffApiContent,
  clearPlanCreateHandoff,
  readPlanCreateHandoff,
} from "@/lib/plan-create-handoff";
import { loadPlanDreamsStore, type PlanDream } from "@/lib/plan-dreams";
import { ChatMarkdown } from "@/components/chat-markdown";
import { bedElementVolume, BED_VOICE_INTRO_SECONDS } from "@/lib/bed-volume";

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

const SPEAKER_SAMPLE_GAP_MS = 3000;

function isLocalDevHost(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

const DEV_RANDOM_SCRIPT_SEEDS: readonly { style: string; user: string }[] = [
  {
    style: "Body scan",
    user: "My jaw and shoulders are clenched after staring at a screen all day.",
  },
  {
    style: "Breath-led",
    user: "I can't catch my breath; everything feels rushed.",
  },
  {
    style: "Sleep",
    user: "I'm exhausted but my mind won't stop replaying the day.",
  },
  {
    style: "Anxiety relief",
    user: "I have a presentation tomorrow and my stomach is in knots.",
  },
  {
    style: "Visualization",
    user: "I want to feel like I'm walking somewhere quiet and green.",
  },
  {
    style: "Loving-kindness",
    user: "I've been hard on myself lately and want to soften.",
  },
  {
    style: "Open awareness",
    user: "I'm overstimulated and want to just notice what's here without fixing it.",
  },
  {
    style: "Reflection",
    user: "Something ended this week and I haven't really sat with it.",
  },
  {
    style: "Story",
    user: "I want a gentle story that helps me feel safe and small in a good way.",
  },
  {
    style: "Affirmation loop",
    user: "I need simple phrases I can repeat when I start spiraling.",
  },
  {
    style: "Manifestation",
    user: "I want to feel the life I'm building as if it's already here.",
  },
  {
    style: "Movement meditation",
    user: "I've been sitting too long; I need to move slowly and wake up my body.",
  },
];

function pickDevRandomScriptSeed(): { style: string; transcript: string } {
  const seed =
    DEV_RANDOM_SCRIPT_SEEDS[
      Math.floor(Math.random() * DEV_RANDOM_SCRIPT_SEEDS.length)
    ]!;
  return {
    style: seed.style,
    transcript: `User: ${seed.user}\n\nGuide: Let's shape a short practice around that.`,
  };
}

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

function ChatTypingIndicator() {
  return (
    <div
      className="mb-3 flex w-full justify-start px-3.5 py-2.5"
      aria-live="polite"
      aria-label="Guide is typing"
    >
      <div className="flex h-4 items-end gap-1.5">
        <span className="chat-typing-dot h-2 w-2 rounded-full bg-accent" />
        <span className="chat-typing-dot h-2 w-2 rounded-full bg-accent" />
        <span className="chat-typing-dot h-2 w-2 rounded-full bg-accent" />
      </div>
    </div>
  );
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

type SoloTrack = "speaker" | "nature" | "music" | "drums" | "noise";

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
  /** Pin the proceed-to-audio control under this recap message. */
  audioReadyCta?: boolean;
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
    "Guided imagery of a place, object, or presence (including the sacred) to shift mood or rest with what matters to you.",
  "Breath-led":
    "Breath-focused practice to steady attention and regulate the nervous system.",
  Manifestation:
    "Intention-setting with vivid future focus; supportive, motivating tone.",
  "Affirmation loop":
    "Repetitive positive statements to reinforce belief, safety, and self-trust.",
  Story:
    "A calm narrative—zen parable, kids’ tale, fable, or a story you inhabit—with sensory detail and a gentle arc.",
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

/** Shown under the type grid after a card is selected. */
const meditationStyleDescription: Record<(typeof meditationStyles)[number], string> = {
  "Body scan":
    "You rest still while attention moves slowly through the body—feet, legs, torso, arms, face. Noticing sensation (warmth, tightness, space) helps release holding and settle the nervous system. Good when you feel scattered, tense, or disconnected from the body.",
  Visualization:
    "The guide paints images you can see and feel: a place, a future moment, an object, an inner quality, or a figure or presence you want to be with—including the sacred, if that’s yours. You stay with the imagery so mood and confidence can shift. Choose this when you want to rehearse a state or rest with something meaningful, not only relax.",
  "Breath-led":
    "The breath is the main anchor—its rhythm, the feel of air, or a simple count. Attention keeps returning to inhaling and exhaling to steady the mind and downshift arousal. A clear choice when you want something simple and regulating.",
  Manifestation:
    "You name what you want to call in and spend time in the feeling of it already here—vivid, future-facing, still grounded. The tone is supportive rather than striving. Use this when intention and “as if” matter more than a generic unwind.",
  "Affirmation loop":
    "Short phrases repeat throughout the practice so they can land in the body, not just the mind (“I am safe,” “I can meet this”). Pacing stays calm; you rest between lines. Helpful for rebuilding self-trust or a kinder inner voice.",
  Story:
    "A coherent narrative unfolds—setting, sensory detail, a gentle arc. It might be a zen parable, a kids’ tale, a fable, or a story you step into. Fits when metaphor and story feel more natural than instructions.",
  Reflection:
    "Quiet prompts help you look at what you’re carrying: meaning, values, a decision, or an experience that needs space. There are pauses to notice and integrate, not only to relax. Choose this when you want insight, not only calm.",
  Sleep:
    "Language, pacing, and imagery are built to wind the system down—no problem-solving, no bright energy. The practice is meant to be listened to in bed and allowed to trail off. Pick this when the goal is drifting, not staying alert.",
  "Loving-kindness":
    "Classic metta: warm phrases of goodwill, first toward yourself and then widening to others (a friend, a stranger, all beings). Repetition is the method. Reach for this when you want compassion, connection, or a softer heart.",
  "Anxiety relief":
    "Grounding and breath sit alongside working with worry—racing thoughts, what-ifs, a tight chest. The script offers reassurance and a way to meet the mind without feeding it. Use this when anxiety is the thing you need help with today.",
  "Movement meditation":
    "Attention lives in slow walking, stretching, or small posture shifts rather than stillness. Sensation of feet, joints, and breath in motion is the practice. Choose this if sitting still feels restless or you want to meditate on the go.",
  "Open awareness":
    "Instead of fixing on one object, you rest in a wide field—sounds, body, thoughts—letting experience come and go. Nothing needs to be pushed away or held. Good when you already have some stillness and want a more spacious sit.",
};

function descriptionForMeditationStyle(label: string): string | null {
  if ((meditationStyles as readonly string[]).includes(label)) {
    return meditationStyleDescription[label as (typeof meditationStyles)[number]];
  }
  return null;
}

const STYLE_ANYTHING_ELSE_PROMPT = "Anything else you would like to add?";

/** Three targeted intake questions per preset type (style path; not chat). */
const STYLE_INTAKE_QUESTIONS: Record<(typeof meditationStyles)[number], [string, string, string]> = {
  "Body scan": [
    "Would you like a full head-to-toe scan, or to linger on a few areas?",
    "Where in your body are you holding the most tension or discomfort right now?",
    "What would you like to feel in your body by the end?",
  ],
  Visualization: [
    "What do you want to picture — a place, object, or presence that matters to you?",
    "What’s the first vivid detail you notice (sight, sound, touch, or a sense of presence)?",
    "How do you want to feel as you stay with this image?",
  ],
  "Breath-led": [
    "Do you want counted breaths, or to follow the breath as it is?",
    "How do you feel right now—wired, tired, scattered, something else?",
    "Do you want a slow, long breath, or to keep a natural pace?",
  ],
  Manifestation: [
    "What do you want to manifest?",
    "Is anything getting in the way of this—doubt, fear, a practical obstacle?",
    "How would you feel if this actually came true?",
  ],
  "Affirmation loop": [
    "What feeling are you trying to generate?",
    "Is there a goal you’re moving towards?",
    "Are there any words or phrases you want to use specifically?",
  ],
  Story: [
    "What style should the story be—zen story, kids’ story, fable, something else?",
    "Are you in the story, or is it about someone else?",
    "What feeling should it leave you with?",
  ],
  Reflection: [
    "What do you need to process?",
    "Do you want to look for an answer, or just sit with it?",
    "What would a helpful insight or shift look like when you’re done?",
  ],
  Sleep: [
    "How are you feeling as you get ready for sleep?",
    "Do you want a drifting scene, or just body and breath?",
    "How do you want to feel as you fall asleep?",
  ],
  "Loving-kindness": [
    "Who is this practice for today—yourself, someone else, or both?",
    "How do you feel toward them—or toward yourself—right now?",
    "What kind of kindness is most needed (warmth, forgiveness, belonging)?",
  ],
  "Anxiety relief": [
    "What’s the main worry or pressure right now?",
    "Do you feel it in your body, and if so, where?",
    "How do you want to feel by the end of this session?",
  ],
  "Movement meditation": [
    "Will you be walking, stretching in place, or something else?",
    "How does your body feel as you start—restless, stiff, tired?",
    "Any limits we should work around—injury, tight space, needing to stay quiet?",
  ],
  "Open awareness": [
    "What pulls your attention away most—thoughts, sounds, restlessness?",
    "What’s your position—sitting, standing, lying down, or walking?",
    "Where are you right now? Is it quiet or noisy?",
  ],
};

function intakeQuestionsForStyle(style: string): [string, string, string] {
  if ((meditationStyles as readonly string[]).includes(style)) {
    return STYLE_INTAKE_QUESTIONS[style as (typeof meditationStyles)[number]];
  }
  const trimmed = style.trim() || "this";
  return [
    `How are you feeling today, and what do you want this “${trimmed}” practice to support?`,
    "Is there a situation, person, or inner state we should keep in mind?",
    "How do you want to feel when the meditation ends?",
  ];
}

function emptyStyleQuestionAnswers(): [string, string, string, string] {
  return ["", "", "", ""];
}

/** How many intake fields to show: 1–4 (3 questions + optional anything else). */
function revealedCountFromStyleAnswers(
  answers: [string, string, string, string],
): number {
  let n = 1;
  for (let i = 0; i < 3; i += 1) {
    if (!answers[i].trim()) break;
    n = i + 2;
  }
  return Math.min(4, n);
}

function StyleIntakeField({
  label,
  optional,
  value,
  onChange,
  onAdvance,
  autoFocus,
  scrollOnEnter,
}: {
  label: string;
  optional?: boolean;
  value: string;
  onChange: (value: string) => void;
  onAdvance?: () => void;
  autoFocus?: boolean;
  scrollOnEnter?: boolean;
}) {
  const [entered, setEntered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shouldFocusRef = useRef(Boolean(autoFocus));
  shouldFocusRef.current = Boolean(autoFocus);
  const setTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    textareaRef.current = el;
    if (el && shouldFocusRef.current) el.focus();
  }, []);
  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setEntered(true);
      return;
    }
    const t = window.setTimeout(() => setEntered(true), 20);
    return () => window.clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    if (!autoFocus) return;
    textareaRef.current?.focus();
  }, [autoFocus, entered]);
  useEffect(() => {
    if (!autoFocus || !entered) return;
    if (scrollOnEnter) {
      textareaRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
    textareaRef.current?.focus();
  }, [entered, scrollOnEnter, autoFocus]);
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-4 shadow-sm transition-[opacity,transform] duration-500 ease-out sm:p-5 dark:border-border dark:bg-surface ${
        entered ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
    >
      <label className="block">
        <span className="font-display text-[1.0625rem] font-medium tracking-tight text-foreground sm:text-lg">
          {label}
        </span>
        {optional ? (
          <span className="mt-1 block text-xs text-muted">Optional</span>
        ) : null}
        <div className="mt-3 flex items-end gap-2">
          <textarea
            ref={setTextareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              if (!onAdvance) return;
              e.preventDefault();
              if (!value.trim()) return;
              onAdvance();
            }}
            rows={1}
            className="min-w-0 flex-1 resize-y rounded-2xl border border-border bg-background px-3.5 py-2.5 text-sm leading-relaxed text-foreground outline-none ring-accent/30 focus:ring-2 sm:text-[15px]"
          />
          <DictationMicButton
            variant="inset"
            onTranscript={(spoken) => {
              const current = textareaRef.current?.value ?? value;
              onChange(appendSpokenText(current, spoken));
              textareaRef.current?.focus();
            }}
          />
        </div>
      </label>
    </div>
  );
}

function parseStyleQuestionAnswers(
  raw: unknown,
): [string, string, string, string] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const next = emptyStyleQuestionAnswers();
  for (let i = 0; i < 4; i += 1) {
    const v = raw[i];
    next[i] = typeof v === "string" ? v : "";
  }
  return next;
}

function transcriptFromStyleAnswers(
  style: string,
  answers: [string, string, string, string],
): { messages: ChatMessage[]; claudeThread: MedimadeChatTurn[] } {
  const questions = intakeQuestionsForStyle(style);
  const messages: ChatMessage[] = [
    {
      role: "assistant",
      text: `We'll shape a ${style} meditation from your answers.`,
      variant: "chat",
    },
  ];
  questions.forEach((q, i) => {
    messages.push({ role: "assistant", text: q, variant: "chat" });
    messages.push({ role: "user", text: answers[i].trim() });
  });
  const extra = answers[3].trim();
  if (extra) {
    messages.push({
      role: "assistant",
      text: STYLE_ANYTHING_ELSE_PROMPT,
      variant: "chat",
    });
    messages.push({ role: "user", text: extra });
  }
  const claudeThread: MedimadeChatTurn[] = messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));
  return { messages, claudeThread };
}

type Phase =
  | "stylePick"
  | "styleQuestions"
  | "style"
  | "feeling"
  | "claude"
  | "journalPick"
  | "goalPick";

/** Before chat: user picks style-first vs free-flow vs journal-reflect creation. */
type CreationPath = CreateMeditationPath;

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
  "I’ll write a visualization around this goal. What would success look like, and how would it feel?";

function parseCoachDisplayText(raw: string): { text: string; ready: boolean } {
  let ready = false;
  let s = raw.replace(/\[\[\s*READY\s*\]\]/gi, () => {
    ready = true;
    return "";
  });
  s = s.replace(/\[\[[^\]]*\]\]/g, "");
  const open = s.lastIndexOf("[[");
  if (open !== -1 && !s.slice(open).includes("]]")) {
    s = s.slice(0, open);
  }
  if (s.endsWith("[")) s = s.slice(0, -1);
  s = s.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
  return { text: s.trimEnd(), ready };
}

function pinAudioReadyCtaOnLastAssistant(messages: ChatMessage[]): ChatMessage[] {
  const next = [...messages];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    const msg = next[i];
    if (msg.kind === "divider" || msg.muted) continue;
    if (msg.role === "assistant" && msg.variant !== "script") {
      next[i] = { ...msg, audioReadyCta: true };
      return next;
    }
  }
  return messages;
}

function coachChatBubbles(text: string): string[] {
  return text
    .split(/\n{2,}/g)
    .map((s) => s.replace(/[ \t]*\n+[ \t]*/g, " ").trim())
    .filter(Boolean);
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
                className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-accent-link transition-colors hover:bg-accent-soft/40"
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
  if (
    o.ttsProvider !== undefined &&
    o.ttsProvider !== "fish" &&
    o.ttsProvider !== "orpheus"
  ) {
    return false;
  }
  if (o.orpheusVoiceId !== undefined && typeof o.orpheusVoiceId !== "string") {
    return false;
  }
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
  if (o.styleQuestionAnswers != null) {
    if (
      !Array.isArray(o.styleQuestionAnswers) ||
      !o.styleQuestionAnswers.every((x) => typeof x === "string")
    ) {
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
    return "How are you feeling as you get ready for sleep—do you want a drifting scene or just body and breath—and how do you want to feel as you drift off?";
  }
  if (s === "loving-kindness" || s === "loving kindness" || s === "metta") {
    return "Who would you like to send kindness to today—yourself, someone else, or both?";
  }
  if (s === "anxiety relief" || s === "anxiety") {
    return "What’s the main worry or pressure right now—and how do you want to feel by the end of this session?";
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
    return "What pulls your attention away most, what’s your position, and what’s the environment like?";
  }
  if (s === "story") {
    return "What style of story is this (zen parable, kids’ tale, fable…), what is it about, and what feeling should it leave you with?";
  }
  if (s === "reflection") {
    return "What do you need to process, do you want an answer or just to sit with it, and what would a helpful insight or shift look like when you’re done?";
  }
  const trimmed = style.trim();
  if (trimmed) {
    return `How are you feeling today—and what do you want this “${trimmed}” meditation to support?`;
  }
  return "How are you feeling today—and what do you want this meditation to support?";
}

/** Live mixer snapshot on Create audio — factory mixes stay read-only; this is compare-only. */
type CreateMixSnapshot = MixerPresetMix & {
  speakerModelId: string;
  speakerFxPreviewOn: boolean;
  meditationTargetMinutes: MeditationTargetMinutes;
};

function createMixSnapshotEquals(a: CreateMixSnapshot, b: CreateMixSnapshot): boolean {
  return (
    mixEquals(a, b) &&
    a.speakerModelId === b.speakerModelId &&
    a.speakerFxPreviewOn === b.speakerFxPreviewOn &&
    a.meditationTargetMinutes === b.meditationTargetMinutes
  );
}

export function CreateWorkspace({
  initialDraftSk = null,
  seedJournalContext = false,
  seedPlanContext = false,
}: CreateWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname() || CREATE_MEDITATE_ROOT;
  const parsedCreateRoute = parseCreateMeditationPathname(pathname);
  const isRedirectingToLibraryRef = useRef(false);
  const seedFromHandoff = seedJournalContext || seedPlanContext;
  const initedCreatePathsRef = useRef(new Set<CreationPath>());
  const pendingUrlSyncRef = useRef<string | null>(null);
  const [mobileCreateStep, setMobileCreateStep] = useState<"chat" | "audio">(
    "chat",
  );
  /** 0 = chooser, 1 = script/chat, 2 = audio — same horizontal strip at every viewport width. */
  const [createStripStep, setCreateStripStep] = useState<0 | 1 | 2>(() => {
    if (seedFromHandoff) return 1;
    if (parsedCreateRoute.mix) return 2;
    if (parsedCreateRoute.path === "pending") return 0;
    if (parsedCreateRoute.path === "style") return 0;
    return 1;
  });

  // Reduce perceived navigation latency (and any browser "redirecting" UI) by prefetching Library.
  useEffect(() => {
    router.prefetch("/meditate/library");
  }, [router]);

  const [phase, setPhase] = useState<Phase>(() => {
    if (seedFromHandoff) return "claude";
    if (parsedCreateRoute.path === "style") {
      return parsedCreateRoute.styleStep === "questions"
        ? "styleQuestions"
        : "stylePick";
    }
    if (parsedCreateRoute.path === "journalReflect") return "journalPick";
    if (parsedCreateRoute.path === "goal") return "goalPick";
    if (parsedCreateRoute.path === "freeflow") return "feeling";
    return "style";
  });
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [coachAudioReady, setCoachAudioReady] = useState(false);
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
  const [backgroundDrums, setBackgroundDrums] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);
  const [backgroundNatureKey, setBackgroundNatureKey] = useState<string>("");
  const [backgroundMusicKey, setBackgroundMusicKey] = useState<string>("");
  const [backgroundNoiseKey, setBackgroundNoiseKey] = useState<string>("");
  const [backgroundDrumsKey, setBackgroundDrumsKey] = useState<string>("");
  const [backgroundNatureGain, setBackgroundNatureGain] = useState(25);
  const [backgroundMusicGain, setBackgroundMusicGain] = useState(50);
  const [backgroundNoiseGain, setBackgroundNoiseGain] = useState(10);
  const [backgroundDrumsGain, setBackgroundDrumsGain] = useState(40);
  const [factoryMixes, setFactoryMixes] = useState<MixerFactoryPreset[]>([]);
  const [userMixPresets, setUserMixPresets] = useState<MixerPreset[]>([]);
  const [selectedMixKey, setSelectedMixKey] = useState("");
  const [factoryMixesLoading, setFactoryMixesLoading] = useState(true);
  const [mixBaseline, setMixBaseline] = useState<CreateMixSnapshot | null>(
    null,
  );
  const mixBaselineReadyRef = useRef(false);
  const [playAllActive, setPlayAllActive] = useState(false);
  const [playing, setPlaying] = useState<Record<SoloTrack, boolean>>({
    speaker: false,
    nature: false,
    music: false,
    drums: false,
    noise: false,
  });
  const previewNatureRef = useRef<HTMLAudioElement | null>(null);
  const previewMusicRef = useRef<HTMLAudioElement | null>(null);
  const previewDrumsRef = useRef<HTMLAudioElement | null>(null);
  const previewNoiseRef = useRef<HTMLAudioElement | null>(null);
  const speakerSampleRef = useRef<HTMLAudioElement | null>(null);
  const speakerGapTimeoutRef = useRef<number | null>(null);
  const playAllVoiceDelayRef = useRef<number | null>(null);
  const speakerRepeatWantedRef = useRef(false);
  const lastBgKeysRef = useRef<{
    nature: string;
    music: string;
    drums: string;
    noise: string;
  }>({
    nature: "",
    music: "",
    drums: "",
    noise: "",
  });
  // Speakers come from backend `GET /fish/speakers` (single source of truth).
  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>([]);
  const [orpheusSpeakers, setOrpheusSpeakers] = useState<OrpheusSpeaker[]>(
    () => [...ORPHEUS_VOICES],
  );
  const [ttsProvider, setTtsProvider] = useState<TtsProvider>("fish");
  const [orpheusVoiceId, setOrpheusVoiceId] = useState<string>(
    DEFAULT_ORPHEUS_VOICE_ID,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "", variant: "chat" },
  ]);
  const [introTypingDone, setIntroTypingDone] = useState(false);
  /** Bumped on reset so intro typing re-runs even when `messages.length` stays 1. */
  const [introTypingSession, setIntroTypingSession] = useState(0);
  const introTypingTimerRef = useRef<number | null>(null);
  const coachTypeTargetRef = useRef("");
  const coachTypeRevealRef = useRef(0);
  const coachTypePauseTicksRef = useRef(0);
  const coachTypeTimerRef = useRef<number | null>(null);
  const coachTypeNetworkDoneRef = useRef(false);
  const coachTypeOwnsMessageRef = useRef(false);
  const coachTypeCaughtUpRef = useRef<(() => void) | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [input, setInput] = useState("");
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const initialChatAutofocusDoneRef = useRef(false);
  const [speakerModelId, setSpeakerModelId] = useState<string>("");
  const [journalMode, setJournalMode] = useState(
    () =>
      Boolean(seedFromHandoff) ||
      parsedCreateRoute.path === "freeflow" ||
      parsedCreateRoute.path === "journalReflect" ||
      parsedCreateRoute.path === "goal",
  );
  const [creationPath, setCreationPath] = useState<CreationPath>(() =>
    seedFromHandoff ? "freeflow" : parsedCreateRoute.path,
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
  const [pendingStyleType, setPendingStyleType] = useState<string | null>(null);
  const [styleQuestionAnswers, setStyleQuestionAnswers] = useState<
    [string, string, string, string]
  >(() => emptyStyleQuestionAnswers());
  const [styleQuestionsRevealed, setStyleQuestionsRevealed] = useState(1);
  const chooserCardsRef = useRef<HTMLDivElement | null>(null);
  /** Default to 2×2 until measured — avoids a one-frame “skinny 4-up” layout. */
  const [chooserLayout, setChooserLayout] = useState<"row4" | "grid2">("grid2");
  /** Journal list for Create chooser + in-chat reflect picker (local + optional cloud). */
  const [journalPickerEntries, setJournalPickerEntries] = useState<JournalEntry[]>(
    [],
  );
  const [journalPickerFolders, setJournalPickerFolders] = useState<JournalFolder[]>(
    [],
  );
  const [journalPickerListReady, setJournalPickerListReady] = useState(false);
  const [journalReflectSelectedIds, setJournalReflectSelectedIds] = useState(
    () => new Set<string>(),
  );
  const [journalReflectGuidance, setJournalReflectGuidance] = useState("");
  const [planGoals, setPlanGoals] = useState<PlanGoal[]>([]);
  const [planGoalsReady, setPlanGoalsReady] = useState(false);
  const [goalSelectedId, setGoalSelectedId] = useState<string | null>(null);

  /** Dev: skip chat → audio; Generate asks the worker for a random script. */
  const [devSkipToAudio, setDevSkipToAudio] = useState(false);
  const devRandomTranscriptRef = useRef<string | null>(null);

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
  const [sessionHydrated, setSessionHydrated] = useState(false);

  function createHrefForNav(opts: {
    path: CreationPath;
    styleStep?: "type" | "questions";
    mix?: boolean;
  }): string {
    return createMeditationHrefWithDraft(
      createMeditationHref(opts),
      draftSk ?? initialDraftSk,
    );
  }

  function pathOnly(href: string): string {
    return href.split("?")[0] ?? href;
  }

  function pushCreate(opts: {
    path: CreationPath;
    styleStep?: "type" | "questions";
    mix?: boolean;
  }) {
    const href = createHrefForNav(opts);
    pendingUrlSyncRef.current = pathOnly(href);
    router.push(href);
  }

  function applyCreateSession(s: CreateSessionV1) {
    const answers = parseStyleQuestionAnswers(s.styleQuestionAnswers)
      ?? emptyStyleQuestionAnswers();
    setStyleQuestionAnswers(answers);
    setStyleQuestionsRevealed(
      Math.max(s.styleQuestionsRevealed, revealedCountFromStyleAnswers(answers)),
    );
    setMeditationStyle(s.meditationStyle);
    setPendingStyleType(s.pendingStyleType);
    setMessages(
      s.coachAudioReady && !s.messages.some((m) => m.audioReadyCta)
        ? pinAudioReadyCtaOnLastAssistant(s.messages)
        : s.messages,
    );
    setClaudeThread(s.claudeThread);
    setCoachAudioReady(s.coachAudioReady === true);
    setInput(s.input);
    setSpeakerModelId(s.speakerModelId);
    setTtsProvider(s.ttsProvider === "orpheus" ? "orpheus" : "fish");
    setOrpheusVoiceId(s.orpheusVoiceId || DEFAULT_ORPHEUS_VOICE_ID);
    setSpeakerFxPreviewOn(s.speakerFxPreviewOn);
    setBackgroundNatureKey(backgroundAudioStreamingKey(s.backgroundNatureKey));
    setBackgroundMusicKey(backgroundAudioStreamingKey(s.backgroundMusicKey));
    setBackgroundDrumsKey(backgroundAudioStreamingKey(s.backgroundDrumsKey));
    setBackgroundNoiseKey(backgroundAudioStreamingKey(s.backgroundNoiseKey));
    setBackgroundNatureGain(s.backgroundNatureGain);
    setBackgroundMusicGain(s.backgroundMusicGain);
    setBackgroundDrumsGain(s.backgroundDrumsGain);
    setBackgroundNoiseGain(s.backgroundNoiseGain);
    setCreateStripStep(s.createStripStep);
    setMobileCreateStep(s.mobileCreateStep);
    setLastUsedScript(s.lastUsedScript);
    setMeditationTargetMinutes(s.meditationTargetMinutes);
    setCreationPath(s.creationPath);
    setJournalMode(s.journalMode);
    setPhase(s.phase === "style" ? "stylePick" : s.phase);
    setPendingModeChoice(s.pendingModeChoice);
    setJournalReflectSelectedIds(
      new Set(s.journalReflectSelectedIds.slice(0, 1)),
    );
    setJournalReflectGuidance(s.journalReflectGuidance ?? "");
    setGoalSelectedId(s.goalSelectedId);
    if (s.draftSk) setDraftSk(s.draftSk);
    setIntroTypingDone(true);
    initedCreatePathsRef.current = new Set(s.initedPaths);
    if (s.creationPath !== "pending") {
      initedCreatePathsRef.current.add(s.creationPath);
    }
  }

  useLayoutEffect(() => {
    if (initialDraftSk?.trim() || seedJournalContext || seedPlanContext) {
      setSessionHydrated(true);
      return;
    }
    const parsed = parseCreateMeditationPathname(pathname);
    const session = readCreateSession();
    const sessionOk =
      session != null &&
      parsed.valid &&
      createSessionSatisfiesRoute(
        session,
        parsed.path,
        parsed.styleStep,
        parsed.mix,
      );
    if (sessionOk && session) {
      applyCreateSession(session);
      setSessionHydrated(true);
      return;
    }
    if (parsed.valid && createRouteNeedsPriorState(parsed)) {
      const href = createMeditationPathStartHref(parsed);
      pendingUrlSyncRef.current = href;
      router.replace(href);
    }
    setSessionHydrated(true);
    // Restore once per mount (full refresh). Client navigations keep the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drumsLockedForMelodic = isMelodicMusicKey(
    backgroundMusic,
    backgroundMusicKey,
  );
  const drumsPreviewKey = drumsLockedForMelodic ? "" : backgroundDrumsKey;

  const currentBedMix: MixerPresetMix = {
    musicKey: backgroundMusicKey,
    natureKey: backgroundNatureKey,
    drumsKey: backgroundDrumsKey,
    noiseKey: backgroundNoiseKey,
    musicGain: backgroundMusicGain,
    natureGain: backgroundNatureGain,
    drumsGain: backgroundDrumsGain,
    noiseGain: backgroundNoiseGain,
  };
  const currentMixSnapshot: CreateMixSnapshot = {
    ...currentBedMix,
    speakerModelId,
    speakerFxPreviewOn,
    meditationTargetMinutes,
  };
  const mixDirty =
    mixBaseline != null &&
    !createMixSnapshotEquals(currentMixSnapshot, mixBaseline);
  const selectedFactoryMix = factoryMixes.find(
    (p) => `factory:${p.id}` === selectedMixKey,
  );
  const selectedUserMix = userMixPresets.find(
    (p) => `user:${p.id}` === selectedMixKey,
  );
  const loadedMixName =
    selectedFactoryMix?.name || selectedUserMix?.name || "";
  const mixSaveDefaultName = loadedMixName
    ? `${loadedMixName} (edited)`
    : "Untitled mix";

  function rememberMixBaseline(mix: CreateMixSnapshot) {
    mixBaselineReadyRef.current = true;
    setMixBaseline(mix);
  }

  function applyBedMix(mix: MixerPresetMix) {
    setBackgroundMusicKey(mix.musicKey);
    setBackgroundNatureKey(mix.natureKey);
    setBackgroundDrumsKey(mix.drumsKey);
    setBackgroundNoiseKey(mix.noiseKey);
    setBackgroundMusicGain(mix.musicGain);
    setBackgroundNatureGain(mix.natureGain);
    setBackgroundDrumsGain(mix.drumsGain);
    setBackgroundNoiseGain(mix.noiseGain);
    rememberMixBaseline({
      ...mix,
      speakerModelId,
      speakerFxPreviewOn,
      meditationTargetMinutes,
    });
    const drumsLocked = isMelodicMusicKey(backgroundMusic, mix.musicKey);
    setPlaying((p) => ({
      ...p,
      music: Boolean(mix.musicKey.trim()),
      nature: Boolean(mix.natureKey.trim()),
      drums: Boolean(mix.drumsKey.trim()) && !drumsLocked,
      noise: Boolean(mix.noiseKey.trim()),
    }));
  }

  function onSelectMixPreset(key: string) {
    setSelectedMixKey(key);
    if (!key) {
      rememberMixBaseline(currentMixSnapshot);
      return;
    }
    const sep = key.indexOf(":");
    const kind = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (kind === "factory") {
      const p = factoryMixes.find((x) => x.id === id);
      if (p) applyBedMix(factoryPresetToMix(p));
      return;
    }
    if (kind === "user") {
      const p = userMixPresets.find((x) => x.id === id);
      if (p) applyBedMix(mixerPresetToMix(p));
    }
  }

  function saveNewMixPreset(name: string) {
    // Always insert a user mix. Factory presets are never written.
    const p: MixerPreset = {
      ...newMixerPreset(name),
      musicKey: backgroundMusicKey,
      natureKey: backgroundNatureKey,
      drumsKey: backgroundDrumsKey,
      noiseKey: backgroundNoiseKey,
      musicGain: backgroundMusicGain,
      natureGain: backgroundNatureGain,
      drumsGain: backgroundDrumsGain,
      noiseGain: backgroundNoiseGain,
    };
    const store = loadMixerPresetStore();
    const next = {
      version: 1 as const,
      activeId: p.id,
      presets: [p, ...store.presets.filter((x) => x.id !== p.id)],
    };
    saveMixerPresetStore(next);
    setUserMixPresets(next.presets);
    setSelectedMixKey(`user:${p.id}`);
    rememberMixBaseline({
      ...mixerPresetToMix(p),
      speakerModelId,
      speakerFxPreviewOn,
      meditationTargetMinutes,
    });
  }

  useEffect(() => {
    if (!sessionHydrated || mixBaselineReadyRef.current) return;
    rememberMixBaseline(currentMixSnapshot);
    // Capture once after session restore so default beds aren't treated as unsaved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionHydrated]);

  useEffect(() => {
    if (!drumsLockedForMelodic) return;
    previewDrumsRef.current?.pause();
    setPlaying((p) => (p.drums ? { ...p, drums: false } : p));
  }, [drumsLockedForMelodic]);

  useEffect(() => {
    if (initialChatAutofocusDoneRef.current) return;
    if (chatControlsDisabled) return;
    if (workspaceSectionStep !== 1) return;
    initialChatAutofocusDoneRef.current = true;
    focusChatInput();
  }, [chatControlsDisabled, workspaceSectionStep]);

  function buildDraftState(): MeditationDraftStateV1 {
    const phaseForDraft: MeditationDraftStateV1["phase"] =
      phase === "stylePick"
        ? "style"
        : phase === "styleQuestions" ||
            phase === "journalPick" ||
            phase === "goalPick"
          ? "feeling"
          : phase;
    return {
      v: MEDITATION_DRAFT_STATE_VERSION,
      phase: phaseForDraft,
      meditationStyle,
      messages,
      claudeThread,
      input,
      speechSpeed,
      speakerModelId,
      ttsProvider,
      orpheusVoiceId,
      backgroundNatureKey: backgroundAudioStreamingKey(backgroundNatureKey),
      backgroundMusicKey: backgroundAudioStreamingKey(backgroundMusicKey),
      backgroundDrumsKey: backgroundAudioStreamingKey(backgroundDrumsKey),
      backgroundNoiseKey: backgroundAudioStreamingKey(backgroundNoiseKey),
      backgroundNatureGain,
      backgroundMusicGain,
      backgroundDrumsGain,
      backgroundNoiseGain,
      mobileCreateStep,
      lastUsedScript,
      meditationTargetMinutes,
      journalMode: journalMode === true,
      styleQuestionAnswers,
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
        const restoredAnswers = parseStyleQuestionAnswers(s.styleQuestionAnswers);
        const answers = restoredAnswers ?? emptyStyleQuestionAnswers();
        setStyleQuestionAnswers(answers);
        setStyleQuestionsRevealed(revealedCountFromStyleAnswers(answers));
        setMeditationStyle(s.meditationStyle);
        setMessages(s.messages);
        setClaudeThread(s.claudeThread);
        setInput(s.input);
        setSpeakerModelId(s.speakerModelId);
        setTtsProvider(
          s.ttsProvider === "orpheus" || s.ttsProvider === "fish"
            ? s.ttsProvider
            : "fish",
        );
        setOrpheusVoiceId(
          typeof s.orpheusVoiceId === "string" && s.orpheusVoiceId.trim()
            ? s.orpheusVoiceId
            : DEFAULT_ORPHEUS_VOICE_ID,
        );
        setBackgroundNatureKey(
          backgroundAudioStreamingKey(s.backgroundNatureKey),
        );
        setBackgroundMusicKey(
          backgroundAudioStreamingKey(s.backgroundMusicKey),
        );
        setBackgroundDrumsKey(
          backgroundAudioStreamingKey(s.backgroundDrumsKey ?? ""),
        );
        setBackgroundNoiseKey(
          backgroundAudioStreamingKey(s.backgroundNoiseKey ?? ""),
        );
        setBackgroundNatureGain(s.backgroundNatureGain);
        setBackgroundMusicGain(s.backgroundMusicGain);
        setBackgroundDrumsGain(s.backgroundDrumsGain ?? 40);
        setBackgroundNoiseGain(s.backgroundNoiseGain ?? 10);
        setMobileCreateStep(s.mobileCreateStep);
        setLastUsedScript(s.lastUsedScript);
        setMeditationTargetMinutes(parseMeditationTargetMinutes(s.meditationTargetMinutes));
        const path = inferCreationPathFromDraft(s);
        setCreationPath(path);
        setJournalMode(path === "freeflow");
        const styleIntake =
          path === "style" &&
          Boolean(s.meditationStyle?.trim()) &&
          restoredAnswers != null &&
          restoredAnswers.slice(0, 3).some((a) => a.trim().length > 0);
        if (s.phase === "style" && !s.meditationStyle?.trim()) {
          setPhase("stylePick");
        } else if (styleIntake) {
          setPhase("styleQuestions");
          setPendingStyleType(s.meditationStyle);
        } else {
          setPhase(s.phase);
        }
        setCreateStripStep(
          s.mobileCreateStep === "audio"
            ? 2
            : styleIntake
              ? 0
              : 1,
        );
        setDraftSk(row.sk);
        initedCreatePathsRef.current.add(path);
        const restoredStrip =
          s.mobileCreateStep === "audio" ? 2 : styleIntake ? 0 : 1;
        const restoredPhase =
          s.phase === "style" && !s.meditationStyle?.trim()
            ? "stylePick"
            : styleIntake
              ? "styleQuestions"
              : s.phase;
        if (!cancelled) {
          const href = createMeditationHrefWithDraft(
            createMeditationHref({
              path,
              styleStep:
                restoredPhase === "styleQuestions" ? "questions" : "type",
              mix: restoredStrip === 2,
            }),
            row.sk,
          );
          pendingUrlSyncRef.current = href.split("?")[0] ?? href;
          setDraftHydrated(true);
          router.replace(href);
        }
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
    const local = loadJournalStore();
    setJournalPickerEntries(local.entries);
    setJournalPickerFolders(local.folders ?? []);

    const base = getMedimadeApiBase();
    if (!base) {
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
            setJournalPickerFolders(remote.folders ?? []);
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
    () => journalPickerEntries.some((e) => !isGratitudeEntry(e)),
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

  /** Chooser cards stay aligned with the active path. */
  useEffect(() => {
    if (creationPath === "pending") return;
    if (creationPath === "style") setPendingModeChoice("style");
    else if (creationPath === "freeflow") setPendingModeChoice("freeflow");
    else if (creationPath === "journalReflect") setPendingModeChoice("journalReflect");
    else if (creationPath === "goal") setPendingModeChoice("goal");
  }, [creationPath]);

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

    pendingUrlSyncRef.current = createMeditationHref({ path: "freeflow" });
    router.replace(pendingUrlSyncRef.current);

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
    initedCreatePathsRef.current.add("freeflow");
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
        const text = await streamCoachChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
            meditationTargetMinutes,
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
    pendingUrlSyncRef.current = createMeditationHref({ path: "freeflow" });
    router.replace(pendingUrlSyncRef.current);

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
    initedCreatePathsRef.current.add("freeflow");
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
        const text = await streamCoachChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
            meditationTargetMinutes,
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

  useEffect(() => {
    if (fishSpeakers.length === 0) return;
    setSpeakerModelId((current) => {
      if (current && fishSpeakers.some((s) => s.modelId === current)) return current;
      const emily = fishSpeakers.find((s) => s.name.toLowerCase() === "emily");
      return emily?.modelId ?? fishSpeakers[0].modelId;
    });
  }, [fishSpeakers, speakerModelId]);

  useEffect(() => {
    void listOrpheusSpeakers()
      .then((voices) => {
        if (!voices || voices.length === 0) return;
        setOrpheusSpeakers(voices);
        setOrpheusVoiceId((current) => {
          if (voices.some((v) => v.id === current)) return current;
          return voices[0]?.id ?? DEFAULT_ORPHEUS_VOICE_ID;
        });
      })
      .catch(() => {
        // Fall back to bundled ORPHEUS_VOICES constants.
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
  }, [messages.length, chatLoading]);

  function pickStyle(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setMeditationStyle(trimmed);
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setPhase("feeling");
    setInput("");

    const style = trimmed;
    const history: MedimadeChatTurn[] = [{ role: "user", content: trimmed }];
    setClaudeThread(history);
    setChatLoading(true);

    void streamCoachChat(
      {
        meditationStyle: style,
        messages: history,
        journalMode: journalMode === true,
        meditationTargetMinutes,
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

  function abortCoachLetterStream() {
    if (coachTypeTimerRef.current !== null) {
      window.clearInterval(coachTypeTimerRef.current);
      coachTypeTimerRef.current = null;
    }
    coachTypeTargetRef.current = "";
    coachTypeRevealRef.current = 0;
    coachTypePauseTicksRef.current = 0;
    coachTypeNetworkDoneRef.current = true;
    coachTypeOwnsMessageRef.current = false;
    const done = coachTypeCaughtUpRef.current;
    coachTypeCaughtUpRef.current = null;
    done?.();
  }

  function applyCoachRevealedText(displayed: string) {
    const parsed = parseCoachDisplayText(displayed);
    if (parsed.ready) setCoachAudioReady(true);
    if (!parsed.text && !coachTypeOwnsMessageRef.current) return;
    setMessages((m) => {
      const pinCta = parsed.ready && !m.some((msg) => msg.audioReadyCta);
      if (!coachTypeOwnsMessageRef.current) {
        coachTypeOwnsMessageRef.current = true;
        return [
          ...m,
          {
            role: "assistant",
            text: parsed.text,
            variant: "chat",
            ...(pinCta ? { audioReadyCta: true } : {}),
          },
        ];
      }
      const next = [...m];
      for (let i = next.length - 1; i >= 0; i -= 1) {
        const msg = next[i];
        if (msg.kind === "divider" || msg.muted) continue;
        if (msg.role === "assistant" && msg.variant !== "script") {
          const updated: ChatMessage = {
            ...msg,
            text: parsed.text,
            ...(pinCta ? { audioReadyCta: true } : {}),
          };
          if (
            updated.text === msg.text &&
            Boolean(updated.audioReadyCta) === Boolean(msg.audioReadyCta)
          ) {
            return m;
          }
          next[i] = updated;
          return next;
        }
        break;
      }
      return [
        ...m,
        {
          role: "assistant",
          text: parsed.text,
          variant: "chat",
          ...(pinCta ? { audioReadyCta: true } : {}),
        },
      ];
    });
    maybeScrollChatToBottom(isAtBottomRef, messagesEndRef);
  }

  function beginCoachLetterStream() {
    abortCoachLetterStream();
    coachTypeTargetRef.current = "";
    coachTypeRevealRef.current = 0;
    coachTypePauseTicksRef.current = 0;
    coachTypeNetworkDoneRef.current = false;
    coachTypeOwnsMessageRef.current = false;
    const tickMs = 14;
    coachTypeTimerRef.current = window.setInterval(() => {
      if (coachTypePauseTicksRef.current > 0) {
        coachTypePauseTicksRef.current -= 1;
        return;
      }
      const target = coachTypeTargetRef.current;
      let i = coachTypeRevealRef.current;
      if (i >= target.length) {
        if (coachTypeNetworkDoneRef.current) {
          if (coachTypeTimerRef.current !== null) {
            window.clearInterval(coachTypeTimerRef.current);
            coachTypeTimerRef.current = null;
          }
          const done = coachTypeCaughtUpRef.current;
          coachTypeCaughtUpRef.current = null;
          done?.();
        }
        return;
      }
      if (target[i] === "[" && target[i + 1] === "[") {
        const close = target.indexOf("]]", i + 2);
        if (close === -1) {
          if (coachTypeNetworkDoneRef.current) {
            coachTypeRevealRef.current = target.length;
            applyCoachRevealedText(target);
          }
          return;
        }
        coachTypeRevealRef.current = close + 2;
        applyCoachRevealedText(target.slice(0, close + 2));
        return;
      }
      i += 1;
      if (target[i - 1] === "\n" && target[i] === "\n") {
        i += 1;
        coachTypePauseTicksRef.current = 18;
      }
      coachTypeRevealRef.current = i;
      applyCoachRevealedText(target.slice(0, i));
    }, tickMs);
  }

  function onCoachStreamDelta(d: string) {
    coachTypeTargetRef.current += d;
  }

  function endCoachLetterStream(): Promise<void> {
    coachTypeNetworkDoneRef.current = true;
    if (
      coachTypeTimerRef.current === null ||
      coachTypeRevealRef.current >= coachTypeTargetRef.current.length
    ) {
      if (coachTypeTimerRef.current !== null) {
        window.clearInterval(coachTypeTimerRef.current);
        coachTypeTimerRef.current = null;
      }
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      coachTypeCaughtUpRef.current = resolve;
    });
  }

  async function streamCoachChat(
    params: Parameters<typeof streamMedimadeChat>[0],
  ): Promise<string> {
    beginCoachLetterStream();
    try {
      const text = await streamMedimadeChat(params, onCoachStreamDelta);
      await endCoachLetterStream();
      const parsed = parseCoachDisplayText(text);
      if (parsed.ready) setCoachAudioReady(true);
      // Keep [[READY]] in the Claude thread so later turns stay in post-ready mode.
      return text;
    } catch (e) {
      abortCoachLetterStream();
      throw e;
    }
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
    abortCoachLetterStream();
    setCoachAudioReady(false);
    setChatLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(false);
    setIntroTypingSession((s) => s + 1);
    if (creationPath === "journalReflect") {
      setJournalReflectSelectedIds(new Set());
      setJournalReflectGuidance("");
      setPhase("journalPick");
      setMessages([]);
    } else if (creationPath === "goal") {
      setGoalSelectedId(null);
      setPhase("goalPick");
      setMessages([{ role: "assistant", text: "", variant: "chat" }]);
    } else if (creationPath === "style") {
      setPendingStyleType(null);
      setStyleQuestionAnswers(emptyStyleQuestionAnswers());
      setStyleQuestionsRevealed(1);
      setPhase("stylePick");
      setMessages([]);
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
    initedCreatePathsRef.current.add("style");
    abortCoachLetterStream();
    setCoachAudioReady(false);
    setCreationPath("style");
    setJournalMode(false);
    setPhase("stylePick");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setPendingStyleType(null);
    setStyleQuestionAnswers(emptyStyleQuestionAnswers());
    setStyleQuestionsRevealed(1);
    setInput("");
    setIntroTypingDone(false);
    setMessages([]);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
  }

  function confirmStyleTypePick() {
    const label = pendingStyleType?.trim();
    if (!label) return;
    if (meditationStyle !== label) {
      setStyleQuestionAnswers(emptyStyleQuestionAnswers());
      setStyleQuestionsRevealed(1);
    } else {
      setStyleQuestionsRevealed(
        revealedCountFromStyleAnswers(styleQuestionAnswers),
      );
    }
    setMeditationStyle(label);
    setMessages([]);
    setClaudeThread([]);
    setChatLoading(false);
    setScriptLoading(false);
    setIntroTypingDone(true);
    setPhase("styleQuestions");
    pushCreate({ path: "style", styleStep: "questions" });
  }

  function confirmStyleQuestions() {
    const style = meditationStyle?.trim();
    if (!style) return;
    if (
      !styleQuestionAnswers[0].trim() ||
      !styleQuestionAnswers[1].trim() ||
      !styleQuestionAnswers[2].trim()
    ) {
      return;
    }
    const built = transcriptFromStyleAnswers(style, styleQuestionAnswers);
    setMessages(built.messages);
    setClaudeThread(built.claudeThread);
    setMobileCreateStep("audio");
    setCreateStripStep(2);
    pushCreate({ path: "style", styleStep: "questions", mix: true });
  }

  function beginFreeFlowPath() {
    initedCreatePathsRef.current.add("freeflow");
    setCoachAudioReady(false);
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
    setJournalReflectSelectedIds(new Set());
    setJournalReflectGuidance("");
    initedCreatePathsRef.current.add("journalReflect");
    setCoachAudioReady(false);
    setCreationPath("journalReflect");
    setJournalMode(true);
    setPhase("journalPick");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(null);
    setInput("");
    setIntroTypingDone(true);
    setMessages([]);
    setMobileCreateStep("chat");
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
  }

  function beginGoalPath() {
    initedCreatePathsRef.current.add("goal");
    setCoachAudioReady(false);
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

  function beginDevSkipToAudio() {
    const seed = pickDevRandomScriptSeed();
    devRandomTranscriptRef.current = seed.transcript;
    setDevSkipToAudio(true);
    initedCreatePathsRef.current.add("style");
    setCreationPath("style");
    setJournalMode(false);
    setPhase("claude");
    setChatLoading(false);
    setScriptLoading(false);
    setClaudeThread([]);
    setMeditationStyle(seed.style);
    setInput("");
    setIntroTypingDone(true);
    setMessages([]);
    setLastUsedScript(null);
    setAudioError(null);
    setPendingModeChoice("style");
    setMobileCreateStep("audio");
    setCreateStripStep(2);
    initialChatAutofocusDoneRef.current = false;
    isAtBottomRef.current = true;
    pushCreate({ path: "style", mix: true });
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
      const text = await streamCoachChat(
        {
          meditationStyle: styleHint,
          messages: history,
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

  function selectJournalReflectEntry(id: string) {
    setJournalReflectSelectedIds((prev) => {
      if (prev.size === 1 && prev.has(id)) return new Set();
      return new Set([id]);
    });
  }

  async function confirmJournalReflectSelection() {
    const id = [...journalReflectSelectedIds][0];
    if (!id || chatLoading) return;
    const entry = journalPickerEntries.find((e) => e.id === id);
    if (!entry) return;

    const journalCards: JournalHandoffSegment[] = [
      {
        entryId: entry.id,
        title: entry.title.trim() || deriveEntryTitle(entry.contentHtml),
        bodyPlain: journalEntryPlainForHandoff(entry.contentHtml),
        createdAt: entry.createdAt,
      },
    ];

    const guidance = journalReflectGuidance.trim();
    const apiUserContent = buildJournalHandoffApiContent(
      journalCards,
      guidance || undefined,
    );
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
      const text = await streamCoachChat(
        {
          meditationStyle: styleHint,
          messages: history,
          journalMode: true,
          meditationTargetMinutes,
          ...(guidance ? { journalGuidance: guidance } : {}),
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
    setDevSkipToAudio(false);
    devRandomTranscriptRef.current = null;
    initialChatAutofocusDoneRef.current = false;
    pushCreate({ path: "pending" });
  }

  function goToAudioSettings() {
    if (!coachAudioReady) return;
    setMobileCreateStep("audio");
    setCreateStripStep(2);
    pushCreate({
      path: creationPath === "pending" ? "freeflow" : creationPath,
      styleStep:
        creationPath === "style" && phase === "styleQuestions"
          ? "questions"
          : "type",
      mix: true,
    });
  }

  useEffect(() => {
    if (!sessionHydrated) return;
    if (initialDraftSk?.trim() && !draftHydrated) return;
    if (seedJournalContext || seedPlanContext) {
      const parsedHandoff = parseCreateMeditationPathname(pathname);
      if (parsedHandoff.path === "pending") return;
    }
    if (pendingUrlSyncRef.current && pathname !== pendingUrlSyncRef.current) {
      return;
    }
    pendingUrlSyncRef.current = null;
    const parsed = parseCreateMeditationPathname(pathname);
    if (!parsed.valid) {
      router.replace(CREATE_MEDITATE_ROOT);
      return;
    }
    if (parsed.path === "pending") {
      setCreationPath("pending");
      setCreateStripStep(0);
      setMobileCreateStep("chat");
      return;
    }
    if (parsed.path === "style") {
      if (!initedCreatePathsRef.current.has("style")) beginStylePath();
      else setCreationPath("style");
      setJournalMode(false);
      if (parsed.mix) {
        setCreateStripStep(2);
        setMobileCreateStep("audio");
      } else {
        setCreateStripStep(0);
        setMobileCreateStep("chat");
        setPhase(
          parsed.styleStep === "questions" ? "styleQuestions" : "stylePick",
        );
      }
      return;
    }
    if (parsed.path === "freeflow") {
      if (!initedCreatePathsRef.current.has("freeflow")) beginFreeFlowPath();
      else {
        setCreationPath("freeflow");
        setJournalMode(true);
      }
      if (parsed.mix) {
        setCreateStripStep(2);
        setMobileCreateStep("audio");
      } else {
        setCreateStripStep(1);
        setMobileCreateStep("chat");
      }
      return;
    }
    if (parsed.path === "journalReflect") {
      if (!initedCreatePathsRef.current.has("journalReflect")) {
        beginJournalReflectPath();
      } else {
        setCreationPath("journalReflect");
        setJournalMode(true);
      }
      if (parsed.mix) {
        setCreateStripStep(2);
        setMobileCreateStep("audio");
      } else {
        setCreateStripStep(1);
        setMobileCreateStep("chat");
      }
      return;
    }
    if (parsed.path === "goal") {
      if (!initedCreatePathsRef.current.has("goal")) beginGoalPath();
      else {
        setCreationPath("goal");
        setJournalMode(true);
      }
      if (parsed.mix) {
        setCreateStripStep(2);
        setMobileCreateStep("audio");
      } else {
        setCreateStripStep(1);
        setMobileCreateStep("chat");
      }
    }
  }, [pathname, draftHydrated, sessionHydrated, initialDraftSk, router, seedJournalContext, seedPlanContext]);

  useEffect(() => {
    if (!sessionHydrated) return;
    if (isRedirectingToLibraryRef.current) return;
    if (initialDraftSk?.trim() && !draftHydrated) return;
    const t = window.setTimeout(() => {
      const snapshot: CreateSessionV1 = {
        v: 1,
        pathname,
        creationPath,
        initedPaths: Array.from(initedCreatePathsRef.current),
        phase,
        journalMode,
        meditationStyle,
        pendingStyleType,
        styleQuestionAnswers,
        styleQuestionsRevealed,
        messages,
        claudeThread,
        input,
        speakerModelId,
        ttsProvider,
        orpheusVoiceId,
        speakerFxPreviewOn,
        backgroundNatureKey,
        backgroundMusicKey,
        backgroundDrumsKey,
        backgroundNoiseKey,
        backgroundNatureGain,
        backgroundMusicGain,
        backgroundDrumsGain,
        backgroundNoiseGain,
        createStripStep,
        mobileCreateStep,
        lastUsedScript,
        meditationTargetMinutes,
        pendingModeChoice,
        journalReflectSelectedIds: Array.from(journalReflectSelectedIds),
        journalReflectGuidance,
        goalSelectedId,
        draftSk,
        coachAudioReady,
      };
      writeCreateSession(snapshot);
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    sessionHydrated,
    draftHydrated,
    initialDraftSk,
    pathname,
    creationPath,
    phase,
    journalMode,
    meditationStyle,
    pendingStyleType,
    styleQuestionAnswers,
    styleQuestionsRevealed,
    messages,
    claudeThread,
    input,
    speakerModelId,
    ttsProvider,
    orpheusVoiceId,
    speakerFxPreviewOn,
    backgroundNatureKey,
    backgroundMusicKey,
    backgroundDrumsKey,
    backgroundNoiseKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundDrumsGain,
    backgroundNoiseGain,
    createStripStep,
    mobileCreateStep,
    lastUsedScript,
    meditationTargetMinutes,
    pendingModeChoice,
    journalReflectSelectedIds,
    journalReflectGuidance,
    goalSelectedId,
    draftSk,
    coachAudioReady,
  ]);

  async function send() {
    if (phase === "journalPick" || phase === "goalPick" || phase === "styleQuestions")
      return;
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
        const text = await streamCoachChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
            meditationTargetMinutes,
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
        const text = await streamCoachChat(
          {
            meditationStyle: style,
            messages: history,
            journalMode: journalMode === true,
            meditationTargetMinutes,
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
        const text = await streamCoachChat(
          {
            meditationStyle: style,
            messages: nextMessages,
            journalMode: journalMode === true,
            meditationTargetMinutes,
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
      const text = await streamCoachChat(
        {
          meditationStyle: style,
          messages: history,
          journalMode: journalMode === true,
          meditationTargetMinutes,
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

    const voiceId = speakerModelId.trim();
    if (!voiceId) {
      setAudioError("Choose a Fish Audio voice before generating.");
      return;
    }
    if (!getMedimadeApiBase()) {
      setAudioError("API URL is not configured (NEXT_PUBLIC_MEDIMADE_API_URL).");
      return;
    }

    // Stop all preview audio while generating.
    stopAllAudioPreview();
    setAudioLoading(true);
    try {
      const last = messages[messages.length - 1];
      const existingScript =
        devSkipToAudio
          ? null
          : last?.role === "assistant" && last.variant === "script"
            ? last.text
            : null;

      const transcript = devSkipToAudio
        ? (devRandomTranscriptRef.current?.trim() ||
          "User: I want a short random guided meditation.\n\nGuide: Let's begin.")
        : messages
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
        ttsProvider: "fish",
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
        ...(drumsPreviewKey
          ? {
              backgroundDrumsKey: backgroundAudioStreamingKey(
                drumsPreviewKey,
              ),
              backgroundDrumsGain,
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
      clearCreateSession();
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
    setUserMixPresets(loadMixerPresetStore().presets);
  }, []);

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
        setBackgroundNoise(data.noise);
        setFactoryMixes(data.factoryMixes ?? []);
        const fromApi = data.baseUrl?.trim();
        setMediaBaseUrl(fromApi || envMediaBase || null);
      } catch {
        if (cancelled) return;
        setBackgroundNature([]);
        setBackgroundMusic([]);
        setBackgroundDrums([]);
        setBackgroundNoise([]);
        setFactoryMixes([]);
        setMediaBaseUrl(envMediaBase || null);
      } finally {
        if (!cancelled) setFactoryMixesLoading(false);
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
      // Mixer 100% is 0.5 so speech at 1.0 stays louder.
      el.volume = bedElementVolume(gain);
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
    void sync(previewDrumsRef.current, drumsPreviewKey, backgroundDrumsGain, "drums");
    void sync(previewNoiseRef.current, backgroundNoiseKey, backgroundNoiseGain, "noise");
  }, [
    mediaBaseUrl,
    backgroundNatureKey,
    backgroundMusicKey,
    drumsPreviewKey,
    backgroundNoiseKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundDrumsGain,
    backgroundNoiseGain,
    playing.nature,
    playing.music,
    playing.drums,
    playing.noise,
  ]);

  function clearSpeakerGapSchedule() {
    if (playAllVoiceDelayRef.current !== null) {
      clearTimeout(playAllVoiceDelayRef.current);
      playAllVoiceDelayRef.current = null;
    }
    if (speakerGapTimeoutRef.current !== null) {
      clearTimeout(speakerGapTimeoutRef.current);
      speakerGapTimeoutRef.current = null;
    }
  }

  const anyTrackPlaying =
    playing.speaker || playing.nature || playing.music || playing.drums || playing.noise;

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
    previewDrumsRef.current?.pause();
    previewNoiseRef.current?.pause();
    speakerSampleRef.current?.pause();
    setPlayAllActive(false);
    setPlaying({ speaker: false, nature: false, music: false, drums: false, noise: false });
  }

  useEffect(() => {
    return () => {
      clearSpeakerGapSchedule();
      [previewNatureRef, previewMusicRef, previewDrumsRef, previewNoiseRef].forEach((r) => {
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

    const voiceId = speakerModelId;
    if (mediaBaseUrl && voiceId) {
      const key = speakerFxPreviewOn
        ? speakerPreviewLoudFxSampleKey(voiceId, speechSpeed)
        : speakerPreviewLoudSampleKey(voiceId, speechSpeed);
      const next = mediaFileUrl(mediaBaseUrl, key);
      if (el.src !== next) {
        el.src = next;
        void el.load();
      }
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
  }, [
    mediaBaseUrl,
    speakerModelId,
    speechSpeed,
    speakerFxPreviewOn,
    playing.speaker,
  ]);

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
    const hasBed = Boolean(
      (backgroundNatureKey && previewNatureRef.current?.src) ||
        (backgroundMusicKey && previewMusicRef.current?.src) ||
        (drumsPreviewKey && previewDrumsRef.current?.src) ||
        (backgroundNoiseKey && previewNoiseRef.current?.src),
    );
    if (sp?.src) {
      speakerRepeatWantedRef.current = true;
      if (hasBed) {
        playAllVoiceDelayRef.current = window.setTimeout(() => {
          playAllVoiceDelayRef.current = null;
          void sp.play().catch(() => {});
        }, BED_VOICE_INTRO_SECONDS * 1000);
      } else {
        parts.push(sp.play());
      }
    } else {
      speakerRepeatWantedRef.current = false;
    }
    if (backgroundNatureKey && previewNatureRef.current?.src) {
      parts.push(previewNatureRef.current.play());
    }
    if (backgroundMusicKey && previewMusicRef.current?.src) {
      parts.push(previewMusicRef.current.play());
    }
    if (drumsPreviewKey && previewDrumsRef.current?.src) {
      parts.push(previewDrumsRef.current.play());
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
      drums: Boolean(drumsPreviewKey && previewDrumsRef.current?.src),
      noise: Boolean(backgroundNoiseKey && previewNoiseRef.current?.src),
    });

    try {
      await Promise.all(parts);
    } catch {
      stopAllAudioPreview();
    }
  }

  async function toggleRowPreview(track: SoloTrack) {
    if (track === "speaker") {
      if (!mediaBaseUrl || !speakerModelId) return;
    }
    if (track === "nature" && !backgroundNatureKey) return;
    if (track === "music" && !backgroundMusicKey) return;
    if (track === "drums" && (!backgroundDrumsKey || drumsLockedForMelodic)) return;
    if (track === "noise" && !backgroundNoiseKey) return;

    const el =
      track === "speaker"
        ? speakerSampleRef.current
        : track === "nature"
          ? previewNatureRef.current
          : track === "music"
            ? previewMusicRef.current
            : track === "drums"
              ? previewDrumsRef.current
              : previewNoiseRef.current;

    if (!el) return;

    if (track === "speaker" && mediaBaseUrl) {
      if (!speakerModelId) return;
      const key = speakerFxPreviewOn
        ? speakerPreviewLoudFxSampleKey(speakerModelId, speechSpeed)
        : speakerPreviewLoudSampleKey(speakerModelId, speechSpeed);
      const next = mediaFileUrl(mediaBaseUrl, key);
      if (el.src !== next) {
        el.src = next;
        el.load();
      }
    }

    if (!el.src) {
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

  const showPathChooser = creationPath === "pending";
  const showStyleTypePick =
    creationPath === "style" &&
    phase === "stylePick" &&
    workspaceSectionStep !== 2;
  const showStyleQuestions =
    creationPath === "style" &&
    phase === "styleQuestions" &&
    workspaceSectionStep !== 2;
  const showJournalPick =
    creationPath === "journalReflect" &&
    phase === "journalPick" &&
    workspaceSectionStep !== 2;
  const styleQuestionsReady =
    styleQuestionAnswers[0].trim().length > 0 &&
    styleQuestionAnswers[1].trim().length > 0 &&
    styleQuestionAnswers[2].trim().length > 0;
  const showChatReset =
    !showPathChooser &&
    !showStyleTypePick &&
    !showStyleQuestions &&
    !showJournalPick &&
    workspaceSectionStep === 1;
  const showAudioPlayAll = workspaceSectionStep === 2;
  const lastVisibleChat = [...messages]
    .reverse()
    .find((m) => !m.muted && m.kind !== "divider");
  const lastCoachParts =
    lastVisibleChat?.role === "assistant" && lastVisibleChat.variant !== "script"
      ? coachChatBubbles(lastVisibleChat.text)
      : [];
  const awaitingCoachQuestionBubble =
    chatLoading &&
    lastVisibleChat?.role === "assistant" &&
    lastVisibleChat.variant !== "script" &&
    /\n\n/.test(lastVisibleChat.text) &&
    lastCoachParts.length < 2;
  const showChatTyping =
    chatLoading &&
    (awaitingCoachQuestionBubble ||
      !(
        lastVisibleChat?.role === "assistant" &&
        lastVisibleChat.variant !== "script" &&
        lastVisibleChat.text.trim().length > 0
      ));

  const createPageChrome: {
    title: string;
    blurb: string;
    crumbs: Array<{ label: string; href?: string }>;
  } = showPathChooser
    ? {
        title: "Create a meditation",
        blurb: "Create a personalised meditation just for you.",
        crumbs: [],
      }
    : showStyleTypePick
      ? {
          title: "What type of meditation?",
          blurb:
            "Choose the practice you want to build. Next you’ll answer a few short questions so it fits what you need today.",
          crumbs: [
            { label: "Create a meditation", href: CREATE_MEDITATE_ROOT },
            { label: "Type" },
          ],
        }
      : showStyleQuestions
        ? {
            title: meditationStyle?.trim() || "A few questions",
            blurb: "These help shape the practice around what you need today.",
            crumbs: [
              { label: "Create a meditation", href: CREATE_MEDITATE_ROOT },
              {
                label: "Type",
                href: createMeditationHref({ path: "style" }),
              },
              { label: meditationStyle?.trim() || "Questions" },
            ],
          }
        : showJournalPick
          ? {
              title: "Which entry should this reflect on?",
              blurb: "Pick one entry to build the meditation around.",
              crumbs: [
                { label: "Create a meditation", href: CREATE_MEDITATE_ROOT },
                { label: "Reflect on a journal entry" },
              ],
            }
        : workspaceSectionStep === 2 && creationPath === "style"
          ? {
              title: "Customise how your meditation will sound",
              blurb:
                "Pick a voice, mix nature sounds, music, and noise, then preview the blend before you generate.",
              crumbs: [
                { label: "Create a meditation", href: CREATE_MEDITATE_ROOT },
                {
                  label: "Type",
                  href: createMeditationHref({ path: "style" }),
                },
                {
                  label: meditationStyle?.trim() || "Questions",
                  href: createMeditationHref({
                    path: "style",
                    styleStep: "questions",
                  }),
                },
                { label: "Audio" },
              ],
            }
          : workspaceSectionStep === 2
            ? {
                title: "Customise how your meditation will sound",
                blurb:
                  "Pick a voice, mix nature sounds, music, and noise, then preview the blend before you generate.",
                crumbs: [
                  { label: "Create a meditation", href: CREATE_MEDITATE_ROOT },
                  {
                    label: creationPath === "freeflow" ? "Chat" : "Script",
                    href: createMeditationHref({
                      path: creationPath,
                    }),
                  },
                  { label: "Audio" },
                ],
              }
            : {
                title: "Shape how your meditation script is written",
                blurb: "Chat with the guide to shape your script.",
                crumbs: [
                  { label: "Create a meditation", href: CREATE_MEDITATE_ROOT },
                  { label: creationPath === "freeflow" ? "Chat" : "Script" },
                ],
              };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6">
      {/* Keep preview elements mounted on every step so src is assigned before the Audio panel. */}
      <audio ref={previewNatureRef} className="hidden" playsInline />
      <audio ref={previewMusicRef} className="hidden" playsInline />
      <audio ref={previewDrumsRef} className="hidden" playsInline />
      <audio ref={previewNoiseRef} className="hidden" playsInline />
      <audio ref={speakerSampleRef} className="hidden" playsInline />
      <div className="mb-6 shrink-0">
          {createPageChrome.crumbs.length > 0 ? (
            <nav aria-label="Breadcrumb" className="mb-2">
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                {createPageChrome.crumbs.map((crumb, i) => {
                  const last = i === createPageChrome.crumbs.length - 1;
                  return (
                    <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                      {i > 0 ? (
                        <IconChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" />
                      ) : null}
                      {crumb.href && !last ? (
                        <Link
                          href={crumb.href}
                          className="cursor-pointer font-medium text-accent-link underline decoration-accent/50 underline-offset-[3px] hover:decoration-accent"
                        >
                          {crumb.label}
                        </Link>
                      ) : (
                        <span
                          className={last ? "font-medium text-foreground" : "text-muted"}
                          aria-current={last ? "page" : undefined}
                        >
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          ) : null}
          <div className="flex items-center justify-between gap-4">
            <h1 className="min-w-0 font-display text-3xl font-medium tracking-tight">
              {createPageChrome.title}
            </h1>
            {isLocalDevHost() && showPathChooser ? (
              <button
                type="button"
                onClick={beginDevSkipToAudio}
                className="shrink-0 cursor-pointer rounded-full border border-dashed border-accent/50 bg-accent-soft/40 px-3 py-1.5 text-xs font-semibold text-accent-link transition-colors hover:bg-accent-soft/70"
                aria-label="Dev: skip chat and go to audio setup with a random script on generate"
              >
                Skip to audio
              </button>
            ) : showChatReset ? (
              <button
                type="button"
                onClick={resetChatKeepMode}
                disabled={chatControlsDisabled}
                aria-label="Reset chat"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-accent/50 hover:bg-accent-soft/35 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconResetArrow className="h-3.5 w-3.5" />
                Reset
              </button>
            ) : showAudioPlayAll ? (
              <button
                type="button"
                onClick={() => void togglePlayAll()}
                disabled={soundControlsDisabled || !mediaBaseUrl}
                aria-label={
                  anyTrackPlaying || playAllActive
                    ? "Pause all previews"
                    : "Play all selected tracks"
                }
                className="accent-fill-gradient inline-flex shrink-0 cursor-pointer items-center rounded-full px-3 py-1.5 text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {anyTrackPlaying || playAllActive ? "Pause all" : "Play all"}
              </button>
            ) : null}
          </div>
          <p className="mt-2 text-muted">{createPageChrome.blurb}</p>
      </div>

      {draftLoadError ? (
        <div
          className="mb-4 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"
          role="alert"
        >
          {draftLoadError}
        </div>
      ) : null}

      {(!sessionHydrated && !seedFromHandoff && !initialDraftSk?.trim()) ||
      (creationPath === "pending" &&
        initialDraftSk?.trim() &&
        !draftHydrated &&
        !draftLoadError) ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8 text-sm text-muted">
          {initialDraftSk?.trim() ? "Loading draft…" : "Loading…"}
        </div>
      ) : (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {showPathChooser ? (
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
          <h2 className="shrink-0 font-display text-lg font-medium tracking-tight text-foreground sm:text-xl">
            How would you like to generate your script?
          </h2>
          <div
            ref={chooserCardsRef}
            className={`grid grid-cols-1 items-stretch gap-4 md:gap-6 ${
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
                    You start by choosing a meditation type, then answer a few
                    questions so that style is shaped around your mood, goals,
                    and what you need today.
                  </p>
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent-link shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconMeditationStyle className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent-link shadow-inner"
                    aria-hidden
                  >
                    <IconMeditationStyle className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-display text-lg font-medium tracking-tight text-foreground">
                      Pick a meditation style
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-muted sm:text-base">
                      You start by choosing a meditation type, then answer a few
                      questions so that style is shaped around your mood, goals,
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
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent-link shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconChatBubbles className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent-link shadow-inner"
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
                        className="font-semibold text-accent-link underline-offset-2 hover:underline"
                      >
                        Open Journal
                      </Link>
                    </p>
                  ) : null}
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent-link shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconJournalReflect className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent-link shadow-inner"
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
                          className="cursor-pointer font-semibold text-accent-link underline-offset-2 hover:underline"
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
                    Choose a goal from Ideate. The guide creates a visualization / manifestation meditation that helps you step toward it.
                  </p>
                  {!planGoalsReady ? (
                    <p className="mt-3 text-xs text-muted">Checking your goals…</p>
                  ) : !hasPlanGoals ? (
                    <p className="mt-3 text-sm leading-relaxed text-muted">
                      Add a project in{" "}
                      <Link
                        href="/ideate"
                        className="cursor-pointer font-semibold text-accent-link underline-offset-2 hover:underline"
                      >
                        Ideate
                      </Link>{" "}
                      to unlock this option.
                    </p>
                  ) : null}
                  <span
                    className="mx-auto mt-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-3xl bg-accent-soft/90 text-accent-link shadow-inner sm:h-32 sm:w-32"
                    aria-hidden
                  >
                    <IconGoalTarget className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" />
                  </span>
                </>
              ) : (
                <div className="flex items-start gap-4">
                  <span
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-soft/90 text-accent-link shadow-inner"
                    aria-hidden
                  >
                    <IconGoalTarget className="h-9 w-9" />
                  </span>
                  <div className="min-w-0">
                    <span className="block font-display text-lg font-medium tracking-tight text-foreground">
                      Move towards a goal
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-muted sm:text-base">
                      Choose a goal from Ideate. The guide creates a visualization / manifestation meditation that helps you step toward it.
                    </p>
                    {!planGoalsReady ? (
                      <p className="mt-2 text-xs text-muted">Checking your goals…</p>
                    ) : !hasPlanGoals ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted">
                        Add a project in{" "}
                        <Link
                          href="/ideate"
                          className="cursor-pointer font-semibold text-accent-link underline-offset-2 hover:underline"
                        >
                          Ideate
                        </Link>{" "}
                        to unlock this option.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </button>
          </div>
          <div className="min-h-8 flex-1" aria-hidden />
          </div>
          <div className="shrink-0 border-t border-border/60 bg-background pt-4">
            <div className="flex min-h-[2.75rem] justify-end">
            {pendingModeChoice ? (
            <button
              type="button"
              onClick={() => {
                if (pendingModeChoice === "style") {
                  beginStylePath();
                  pushCreate({ path: "style" });
                } else if (pendingModeChoice === "freeflow") {
                  beginFreeFlowPath();
                  setCreateStripStep(1);
                  pushCreate({ path: "freeflow" });
                } else if (pendingModeChoice === "journalReflect") {
                  beginJournalReflectPath();
                  setCreateStripStep(1);
                  pushCreate({ path: "journalReflect" });
                } else if (pendingModeChoice === "goal") {
                  beginGoalPath();
                  setCreateStripStep(1);
                  pushCreate({ path: "goal" });
                }
              }}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
              aria-label={
                pendingModeChoice === "style"
                  ? "Next: choose a meditation type"
                  : pendingModeChoice === "journalReflect"
                    ? "Next: choose a journal entry"
                    : pendingModeChoice === "goal"
                      ? "Next: choose a goal"
                      : "Next: chat"
              }
            >
              <span>
                {pendingModeChoice === "style"
                  ? "Type"
                  : pendingModeChoice === "journalReflect"
                    ? "Journal"
                    : pendingModeChoice === "goal"
                      ? "Goal"
                      : "Chat"}
              </span>
              <IconChevronRight className="text-accent-link" />
            </button>
            ) : null}
            </div>
          </div>
        </div>
        ) : null}
        {showStyleTypePick ? (
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              <MeditationTypeCardGrid
                selected={pendingStyleType ?? ""}
                onSelect={setPendingStyleType}
                titles={meditationStyleTooltip}
              />
              {pendingStyleType ? (
                <div className="shrink-0 rounded-2xl border border-border bg-card px-4 py-3 sm:px-5 sm:py-4">
                  <p className="text-sm font-semibold text-foreground">
                    {pendingStyleType}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">
                    {descriptionForMeditationStyle(pendingStyleType)}
                  </p>
                </div>
              ) : null}
            </div>
            <div className="shrink-0 border-t border-border/60 bg-background pt-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    pushCreate({ path: "pending" });
                  }}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                  aria-label="Back to how you generate the script"
                >
                  <IconChevronLeft className="shrink-0 text-accent-link" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  disabled={!pendingStyleType}
                  onClick={confirmStyleTypePick}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                  aria-label="Continue to questions for this meditation type"
                >
                  <span>Questions</span>
                  <IconChevronRight className="text-accent-link" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {showStyleQuestions ? (
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
              <div className="space-y-7 pb-4">
                {intakeQuestionsForStyle(meditationStyle ?? "")
                  .slice(0, Math.min(3, styleQuestionsRevealed))
                  .map((q, i) => (
                    <StyleIntakeField
                      key={`${meditationStyle ?? "style"}-${i}`}
                      label={q}
                      value={styleQuestionAnswers[i]}
                      autoFocus={i === styleQuestionsRevealed - 1}
                      scrollOnEnter={i > 0}
                      onAdvance={() => {
                        setStyleQuestionsRevealed((r) => Math.max(r, i + 2));
                      }}
                      onChange={(v) => {
                        setStyleQuestionAnswers((prev) => {
                          const next = [...prev] as [
                            string,
                            string,
                            string,
                            string,
                          ];
                          next[i] = v;
                          return next;
                        });
                      }}
                    />
                  ))}
                {styleQuestionsRevealed >= 4 ? (
                  <StyleIntakeField
                    key={`${meditationStyle ?? "style"}-else`}
                    label={STYLE_ANYTHING_ELSE_PROMPT}
                    optional
                    value={styleQuestionAnswers[3]}
                    autoFocus
                    scrollOnEnter
                    onChange={(v) => {
                      setStyleQuestionAnswers((prev) => {
                        const next = [...prev] as [
                          string,
                          string,
                          string,
                          string,
                        ];
                        next[3] = v;
                        return next;
                      });
                    }}
                  />
                ) : null}
              </div>
            </div>
            <div className="shrink-0 border-t border-border/60 bg-background pt-4">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    pushCreate({ path: "style" });
                  }}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                  aria-label="Back to meditation type"
                >
                  <IconChevronLeft className="shrink-0 text-accent-link" />
                  <span>Type</span>
                </button>
                <button
                  type="button"
                  disabled={!styleQuestionsReady}
                  onClick={confirmStyleQuestions}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                  aria-label="Continue to audio and voice settings"
                >
                  <span>Audio & voice</span>
                  <IconChevronRight className="text-accent-link" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {showJournalPick ? (
          <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <JournalReflectPicker
              entries={journalPickerEntries}
              folders={journalPickerFolders}
              listReady={journalPickerListReady}
              selectedId={[...journalReflectSelectedIds][0] ?? null}
              onSelect={selectJournalReflectEntry}
              guidance={journalReflectGuidance}
              onGuidanceChange={setJournalReflectGuidance}
            />
            </div>
            <div className="shrink-0 border-t border-border/60 bg-background pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={goBackToChatStyle}
                  disabled={chatControlsDisabled}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                  aria-label="Back to chat style selection"
                >
                  <IconChevronLeft className="shrink-0 text-accent-link" />
                  <span>Chat style</span>
                </button>
                <button
                  type="button"
                  disabled={
                    chatLoading ||
                    chatControlsDisabled ||
                    journalReflectSelectedIds.size === 0
                  }
                  onClick={() => void confirmJournalReflectSelection()}
                  className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                  aria-label="Next: audio and voice settings"
                >
                  <span>Audio & voice</span>
                  <IconChevronRight className="text-accent-link" />
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {workspaceSectionStep === 1 && !showStyleTypePick && !showStyleQuestions && !showJournalPick ? (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <section className="flex w-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden p-4">
            <div
              ref={chatScrollRef}
              className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3"
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
              {messages.filter((m) => !m.muted).map((msg, i, visible) => {
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
                const next = visible[i + 1];
                const groupedWithNext =
                  !msg.audioReadyCta &&
                  !!next &&
                  next.kind !== "divider" &&
                  next.role === msg.role &&
                  (msg.role !== "assistant" ||
                    (msg.variant === "script") === (next.variant === "script"));
                const muted = msg.muted ? "opacity-50" : "";
                const isUser = msg.role === "user";
                const isLastVisible = i === visible.length - 1;
                const moreCoachBubblesComing =
                  chatLoading &&
                  isLastVisible &&
                  !isUser &&
                  !isScript &&
                  /\n\n/.test(msg.text) &&
                  coachChatBubbles(msg.text).length < 2;
                const assistantParts =
                  !isUser && !isScript ? coachChatBubbles(msg.text) : null;
                const parts =
                  assistantParts && assistantParts.length > 0
                    ? assistantParts
                    : [msg.text];
                return (
                  <div
                    key={`${msg.role}-${i}-${msg.variant ?? "u"}`}
                    className={`flex w-full min-w-0 flex-col ${
                      isUser ? "items-end" : "items-start"
                    } ${groupedWithNext ? "mb-1" : "mb-3"}`}
                  >
                    {parts.map((part, pi) => {
                      const lastPart = pi === parts.length - 1;
                      const showTail =
                        lastPart &&
                        !groupedWithNext &&
                        !isScript &&
                        !moreCoachBubblesComing;
                      const radius = isUser
                        ? showTail
                          ? "rounded-[1.25rem] rounded-br-sm"
                          : "rounded-[1.25rem]"
                        : showTail
                          ? "rounded-[1.25rem] rounded-bl-sm"
                          : "rounded-[1.25rem]";
                      const bubbleBase = `chat-bubble relative inline-block w-fit max-w-[calc(100%-16px)] px-3.5 py-2.5 ${radius}`;
                      const bubble = isUser
                        ? `${bubbleBase} bg-border/40 text-lg text-foreground ${
                            showTail ? "chat-bubble-tail-right" : ""
                          } ${muted}`
                        : isScript
                          ? `${bubbleBase} border border-gold/45 bg-gold/5 text-foreground ${muted}`
                          : `${bubbleBase} bg-accent-soft/80 text-lg text-foreground ${
                              showTail ? "chat-bubble-tail-left" : ""
                            } ${muted}`;
                      return (
                        <div
                          key={pi}
                          className={`flex w-full min-w-0 ${
                            isUser ? "justify-end" : "justify-start"
                          } ${lastPart ? "" : "mb-1"}`}
                        >
                          <div className={bubble}>
                            {isScript ? (
                              <>
                                <div className="mb-2 inline-flex items-center rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-link">
                                  Meditation script · ~5 min
                                </div>
                                <ChatMarkdown
                                  text={msg.text}
                                  className="font-serif text-base leading-relaxed text-foreground/95"
                                />
                              </>
                            ) : isUser &&
                              msg.journalSegments &&
                              msg.journalSegments.length > 0 ? (
                              <div className="text-lg leading-snug">
                                <p className="whitespace-pre-wrap">{msg.text}</p>
                                <JournalHandoffEntryCards
                                  segments={msg.journalSegments}
                                />
                              </div>
                            ) : (
                              <ChatMarkdown
                                text={part}
                                className="relative z-[2] text-lg leading-snug"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {msg.audioReadyCta ? (
                      <div className="mt-2 flex w-full justify-start">
                        <button
                          type="button"
                          onClick={goToAudioSettings}
                          className="flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                        >
                          <span>Proceed to audio settings</span>
                          <IconChevronRight className="text-accent-link" />
                        </button>
                      </div>
                    ) : null}
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
              {phase === "goalPick" ? (
                <div className="mt-3 space-y-3 rounded-xl border border-border bg-background px-3 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                    Your goals (from Ideate)
                  </p>
                  {!planGoalsReady ? (
                    <p className="text-sm text-muted">Loading goals…</p>
                  ) : !hasPlanGoals ? (
                    <p className="text-sm leading-relaxed text-muted">
                      Add a project in{" "}
                      <Link
                        href="/ideate"
                        className="cursor-pointer font-semibold text-accent-link underline-offset-2 hover:underline"
                      >
                        Ideate
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
                          className="cursor-pointer rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
                        >
                          Continue with selected
                        </button>
                      </div>
                    </>
                  ) : null}
                </div>
              ) : null}
              {showChatTyping ? <ChatTypingIndicator /> : null}
              <div ref={messagesEndRef} />
            </div>
            {phase === "journalPick" || phase === "goalPick" ? null : (
            <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-border pt-3">
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
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-lg outline-none ring-accent/30 focus:ring-2"
              />
              <DictationMicButton
                disabled={chatControlsDisabled || chatLoading || scriptLoading}
                onTranscript={(spoken) => {
                  setInput((prev) => appendSpokenText(prev, spoken));
                  chatInputRef.current?.focus();
                }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={chatControlsDisabled || chatLoading || scriptLoading}
                aria-label={chatLoading ? "Sending…" : "Send message"}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl accent-fill-gradient text-on-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
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
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
              aria-label="Back to chat style selection"
            >
              <IconChevronLeft className="shrink-0 text-accent-link" />
              <span>Chat style</span>
            </button>
            <button
              type="button"
              disabled={
                !coachAudioReady ||
                phase === "journalPick" ||
                phase === "goalPick"
              }
              onClick={goToAudioSettings}
              className="flex shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:pointer-events-none disabled:opacity-40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
              aria-label="Next: audio and voice settings"
            >
              <span>Audio & voice</span>
              <IconChevronRight className="text-accent-link" />
            </button>
          </div>
          </div>
        </div>
        ) : null}
        {workspaceSectionStep === 2 ? (
        <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto sm:gap-3">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto p-4">
                  <div className="flex h-full min-w-[5.75rem] w-full flex-1 flex-col gap-2">
                    <div className="shrink-0">
                      <MixerPresetChannel
                        factoryPresets={factoryMixes}
                        userPresets={userMixPresets}
                        selectedKey={selectedMixKey}
                        onSelect={onSelectMixPreset}
                        onSaveNew={saveNewMixPreset}
                        disabled={soundControlsDisabled}
                        loading={factoryMixesLoading}
                        showSave={mixDirty}
                        modified={mixDirty}
                        defaultSaveName={mixSaveDefaultName}
                      />
                    </div>
                    <div className="min-h-[10rem] flex-1">
                      <MixerVoiceChannel
                        voices={fishSpeakers}
                        value={speakerModelId}
                        onChange={setSpeakerModelId}
                        disabled={soundControlsDisabled}
                        fxOn={speakerFxPreviewOn}
                        onFxChange={setSpeakerFxPreviewOn}
                        fxDisabled={
                          soundControlsDisabled ||
                          !mediaBaseUrl ||
                          !speakerModelId
                        }
                        playing={playing.speaker}
                        onTogglePreview={() => void toggleRowPreview("speaker")}
                        playDisabled={
                          soundControlsDisabled ||
                          !mediaBaseUrl ||
                          !speakerModelId
                        }
                        showDisc={false}
                      />
                    </div>
                  </div>
                  <MixerChannel
                    label="Music"
                    category="music"
                    items={backgroundMusic}
                    value={backgroundMusicKey}
                    onChange={setBackgroundMusicKey}
                    gain={backgroundMusicGain}
                    onGainChange={setBackgroundMusicGain}
                    disabled={soundControlsDisabled}
                    faderDisabled={soundControlsDisabled || !backgroundMusicKey}
                    playing={playing.music}
                    onTogglePreview={() => void toggleRowPreview("music")}
                    playDisabled={soundControlsDisabled || !backgroundMusicKey}
                    playAriaLabel={playing.music ? "Pause music" : "Play music"}
                  />
                  <MixerChannel
                    label="Ambience"
                    category="ambience"
                    items={backgroundNature}
                    value={backgroundNatureKey}
                    onChange={setBackgroundNatureKey}
                    gain={backgroundNatureGain}
                    onGainChange={setBackgroundNatureGain}
                    disabled={soundControlsDisabled}
                    faderDisabled={soundControlsDisabled || !backgroundNatureKey}
                    playing={playing.nature}
                    onTogglePreview={() => void toggleRowPreview("nature")}
                    playDisabled={soundControlsDisabled || !backgroundNatureKey}
                    playAriaLabel={
                      playing.nature ? "Pause ambience" : "Play ambience"
                    }
                  />
                  <DrumsLockedWrap
                    locked={drumsLockedForMelodic}
                    className="flex h-full min-w-[5.75rem] flex-1 items-stretch"
                  >
                    <MixerChannel
                      label="Drums"
                      category="drums"
                      items={backgroundDrums}
                      value={backgroundDrumsKey}
                      onChange={setBackgroundDrumsKey}
                      gain={backgroundDrumsGain}
                      onGainChange={setBackgroundDrumsGain}
                      disabled={soundControlsDisabled || drumsLockedForMelodic}
                      faderDisabled={
                        soundControlsDisabled ||
                        drumsLockedForMelodic ||
                        !backgroundDrumsKey
                      }
                      playing={playing.drums}
                      onTogglePreview={() => void toggleRowPreview("drums")}
                      playDisabled={
                        soundControlsDisabled ||
                        drumsLockedForMelodic ||
                        !backgroundDrumsKey
                      }
                      playAriaLabel={
                        playing.drums ? "Pause drums" : "Play drums"
                      }
                    />
                  </DrumsLockedWrap>
                  <MixerChannel
                    label="Noise"
                    category="noise"
                    items={backgroundNoise}
                    value={backgroundNoiseKey}
                    onChange={setBackgroundNoiseKey}
                    gain={backgroundNoiseGain}
                    onGainChange={setBackgroundNoiseGain}
                    disabled={soundControlsDisabled}
                    faderDisabled={soundControlsDisabled || !backgroundNoiseKey}
                    playing={playing.noise}
                    onTogglePreview={() => void toggleRowPreview("noise")}
                    playDisabled={soundControlsDisabled || !backgroundNoiseKey}
                    playAriaLabel={playing.noise ? "Pause noise" : "Play noise"}
                  />
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5">
                  <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-muted">
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
          {audioError ? (
            <p
              className="shrink-0 max-w-full break-words py-2 text-center text-sm text-danger sm:text-right"
              role="alert"
            >
              {audioError}
            </p>
          ) : null}
          <div className="shrink-0 border-t border-border/60 bg-background pt-4">
            <div className="flex min-h-[3rem] w-full flex-nowrap items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => {
                if (devSkipToAudio) {
                  goBackToChatStyle();
                  return;
                }
                if (creationPath === "style") {
                  pushCreate({ path: "style", styleStep: "questions" });
                  return;
                }
                pushCreate({
                  path: creationPath === "pending" ? "freeflow" : creationPath,
                });
              }}
              className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
              aria-label={
                creationPath === "style"
                  ? "Back to questions"
                  : "Back to script and chat"
              }
            >
              <IconChevronLeft className="shrink-0 text-accent-link" />
              {creationPath === "style" ? "Questions" : "Script"}
            </button>
            <div className="ml-auto flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-2">
              <button
                type="button"
                onClick={() => void saveCurrentDraft()}
                disabled={draftSaving || soundControlsDisabled}
                className="shrink-0 cursor-pointer rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 dark:border-border dark:bg-surface dark:text-foreground dark:hover:bg-accent-soft/30"
              >
                {draftSaving ? "Saving…" : "Save draft"}
              </button>
              <button
                type="button"
                onClick={() => void generateMeditationAudioAndShow()}
                disabled={audioLoading}
                className={`accent-fill-gradient shrink-0 cursor-pointer whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:px-5 ${
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4">
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
