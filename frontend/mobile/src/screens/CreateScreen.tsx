import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import Card from "../components/ui/Card";
import ChatMarkdown from "../components/ChatMarkdown";
import ModalDropdown from "../components/ui/ModalDropdown";
import { colors } from "../theme/colors";
import {
  type BackgroundAudioItem,
  type FishSpeaker,
  type MedimadeChatTurn,
  type MeditationDraftStateV1,
  MEDITATION_DRAFT_STATE_VERSION,
  backgroundAudioStreamingKey,
  createMeditationAudioJob,
  getMeditationDraft,
  getMeditationAudioJobStatus,
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  listFishSpeakers,
  saveMeditationDraft,
  streamMedimadeChat,
  streamMeditationScript,
} from "../lib/medimade-api";
import { upsertPendingGeneration } from "../lib/pending-generations";
import type { RootTabParamList } from "../navigation/RootTabs";

type CreateNav = BottomTabNavigationProp<RootTabParamList, "Create">;
type CreateRoute = RouteProp<RootTabParamList, "Create">;

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
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
  "Story",
  "Reflection",
  "Sleep",
  "Loving-kindness",
  "Anxiety relief",
  "Movement meditation",
  "Open awareness",
] as const;

type Phase = "style" | "feeling" | "claude";

const OPENING_STYLE =
  "What style of meditation should we build? Pick one below or describe your own.";
const OPENING_JOURNAL = "What’s on your mind?";

const MOBILE_STEPS = [
  { key: "chat", label: "Chat" },
  { key: "mix", label: "Voice & mix" },
] as const;

const SPEECH_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const GAIN_STEPS = [0, 15, 25, 40, 55, 70, 85, 100] as const;

function snapSpeed(n: number): number {
  return SPEECH_SPEEDS.reduce((best, x) =>
    Math.abs(x - n) < Math.abs(best - n) ? x : best,
  );
}

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

function isMedimadeTurnLike(x: unknown): x is MedimadeChatTurn {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.role !== "user" && o.role !== "assistant") return false;
  return typeof o.content === "string";
}

function isChatMessageLike(x: unknown): x is ChatMessage {
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
  if (
    typeof o.backgroundNoiseKey !== "string" &&
    typeof (o as { backgroundDrumsKey?: unknown }).backgroundDrumsKey !==
      "string"
  ) {
    return false;
  }
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
  {
    const ng =
      typeof o.backgroundNoiseGain === "number"
        ? o.backgroundNoiseGain
        : typeof (o as { backgroundDrumsGain?: unknown }).backgroundDrumsGain ===
            "number"
          ? (o as { backgroundDrumsGain: number }).backgroundDrumsGain
          : NaN;
    if (!Number.isFinite(ng)) return false;
  }
  if (o.mobileCreateStep !== "chat" && o.mobileCreateStep !== "audio") {
    return false;
  }
  if (o.lastUsedScript != null && typeof o.lastUsedScript !== "string") {
    return false;
  }
  if (o.meditationStyle != null && typeof o.meditationStyle !== "string") {
    return false;
  }
  return true;
}

function bgOptions(items: BackgroundAudioItem[]): { label: string; value: string }[] {
  return [
    { label: "None", value: "" },
    ...items.map((b) => ({ label: b.name || b.key, value: b.key })),
  ];
}

export default function CreateScreen() {
  const navigation = useNavigation<CreateNav>();
  const route = useRoute<CreateRoute>();
  const loadedDraftSkRef = useRef<string | null>(null);

  const [mobileCreateStep, setMobileCreateStep] = useState(0);
  const [journalMode, setJournalMode] = useState(true);
  const [phase, setPhase] = useState<Phase>("feeling");
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: OPENING_JOURNAL, variant: "chat" },
  ]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lastUsedScript, setLastUsedScript] = useState<string | null>(null);

  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>([]);
  const [speakerModelId, setSpeakerModelId] = useState("");
  const [speakerFxPreviewOn, setSpeakerFxPreviewOn] = useState(true);
  const [speechSpeed, setSpeechSpeed] = useState(1);

  const [backgroundNature, setBackgroundNature] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundMusic, setBackgroundMusic] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundNoise, setBackgroundNoise] = useState<BackgroundAudioItem[]>(
    [],
  );
  const [backgroundNatureKey, setBackgroundNatureKey] = useState("");
  const [backgroundMusicKey, setBackgroundMusicKey] = useState("");
  const [backgroundNoiseKey, setBackgroundNoiseKey] = useState("");
  const [backgroundNatureGain, setBackgroundNatureGain] = useState(25);
  const [backgroundMusicGain, setBackgroundMusicGain] = useState(50);
  const [backgroundNoiseGain, setBackgroundNoiseGain] = useState(10);

  const [draftSk, setDraftSk] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);

  const chatScrollRef = useRef<ScrollView | null>(null);

  const isRedirectingRef = useRef(false);

  useEffect(() => {
    void listFishSpeakers()
      .then((sp) => {
        setFishSpeakers(sp);
        const emily = sp.find((s) => s.name.toLowerCase() === "emily");
        setSpeakerModelId((cur) => {
          if (cur && sp.some((s) => s.modelId === cur)) return cur;
          return emily?.modelId ?? sp[0]?.modelId ?? "";
        });
      })
      .catch(() => {
        /* keep empty */
      });
  }, []);

  useEffect(() => {
    const envMedia = getMedimadeMediaBaseUrl();
    void listBackgroundAudio()
      .then((data) => {
        setBackgroundNature(data.nature);
        setBackgroundMusic(data.music);
        setBackgroundNoise(data.noise);
        if (!envMedia && !data.baseUrl) {
          /* lists still usable if keys are full URLs — usually not */
        }
      })
      .catch(() => {
        setBackgroundNature([]);
        setBackgroundMusic([]);
        setBackgroundNoise([]);
      });
  }, []);

  const speakerOptions = useMemo(
    () => fishSpeakers.map((s) => ({ label: s.name, value: s.modelId })),
    [fishSpeakers],
  );

  function applyJournalMode(next: boolean) {
    setJournalMode(next);
    setMeditationStyle(null);
    setClaudeThread([]);
    setInput("");
    setPhase(next ? "feeling" : "style");
    setMessages([
      {
        role: "assistant",
        text: next ? OPENING_JOURNAL : OPENING_STYLE,
        variant: "chat",
      },
    ]);
  }

  function buildDraftState(): MeditationDraftStateV1 {
    return {
      v: MEDITATION_DRAFT_STATE_VERSION,
      phase,
      journalMode,
      meditationStyle,
      messages,
      claudeThread,
      input,
      speechSpeed,
      speakerModelId,
      speakerFxPreviewOn,
      backgroundNatureKey: backgroundAudioStreamingKey(backgroundNatureKey),
      backgroundMusicKey: backgroundAudioStreamingKey(backgroundMusicKey),
      backgroundNoiseKey: backgroundAudioStreamingKey(backgroundNoiseKey),
      backgroundNatureGain,
      backgroundMusicGain,
      backgroundNoiseGain,
      mobileCreateStep: mobileCreateStep === 0 ? "chat" : "audio",
      lastUsedScript,
    };
  }

  async function saveCurrentDraft() {
    if (draftSaving) return;
    setDraftSaving(true);
    setDraftMessage(null);
    try {
      const out = await saveMeditationDraft({
        sk: draftSk,
        meditationStyle,
        draftState: buildDraftState(),
      });
      setDraftSk(out.sk);
      setDraftMessage("Saved. Open Library → Drafts to continue later.");
    } catch (e) {
      setDraftMessage(
        e instanceof Error ? e.message : "Could not save draft",
      );
    } finally {
      setDraftSaving(false);
    }
  }

  const hydrateFromDraft = useCallback((s: MeditationDraftStateV1) => {
    setPhase(s.phase);
    setJournalMode(s.journalMode ?? false);
    setMeditationStyle(s.meditationStyle);
    setMessages(s.messages);
    setClaudeThread(s.claudeThread);
    setInput(s.input);
    setSpeechSpeed(snapSpeed(s.speechSpeed));
    setSpeakerModelId(s.speakerModelId);
    if (typeof s.speakerFxPreviewOn === "boolean") {
      setSpeakerFxPreviewOn(s.speakerFxPreviewOn);
    }
    setBackgroundNatureKey(backgroundAudioStreamingKey(s.backgroundNatureKey));
    setBackgroundMusicKey(backgroundAudioStreamingKey(s.backgroundMusicKey));
    const noiseRaw =
      (s as { backgroundNoiseKey?: string }).backgroundNoiseKey ??
      (s as { backgroundDrumsKey?: string }).backgroundDrumsKey ??
      "";
    setBackgroundNoiseKey(backgroundAudioStreamingKey(noiseRaw));
    setBackgroundNatureGain(s.backgroundNatureGain);
    setBackgroundMusicGain(s.backgroundMusicGain);
    setBackgroundNoiseGain(
      (s as { backgroundNoiseGain?: number }).backgroundNoiseGain ??
        (s as { backgroundDrumsGain?: number }).backgroundDrumsGain ??
        10,
    );
    setMobileCreateStep(s.mobileCreateStep === "audio" ? 1 : 0);
    setLastUsedScript(s.lastUsedScript);
  }, []);

  const tryLoadDraft = useCallback(
    async (sk: string) => {
      const t = sk.trim();
      if (!t) return;
      setDraftLoadError(null);
      try {
        const row = await getMeditationDraft(t);
        if (!isDraftStateV1(row.draftState)) {
          setDraftLoadError("Draft format not recognized.");
          return;
        }
        hydrateFromDraft(row.draftState);
        setDraftSk(row.sk);
        loadedDraftSkRef.current = t;
      } catch (e) {
        setDraftLoadError(
          e instanceof Error ? e.message : "Could not load draft",
        );
      }
    },
    [hydrateFromDraft],
  );

  useFocusEffect(
    useCallback(() => {
      const sk = route.params?.draftSk?.trim();
      if (sk && sk !== loadedDraftSkRef.current) {
        void tryLoadDraft(sk);
      }
    }, [route.params?.draftSk, tryLoadDraft]),
  );

  async function generateScript() {
    if (scriptLoading) return;
    const transcript = messages
      .filter((m) => !m.muted && m.kind !== "divider" && m.variant !== "script")
      .map((m) => `${m.role === "user" ? "User" : "Guide"}: ${m.text}`)
      .join("\n\n");
    setScriptLoading(true);
    try {
      let acc = "";
      let started = false;
      await streamMeditationScript(
        {
          meditationStyle,
          transcript,
          journalMode: journalMode === true,
        },
        (d) => {
          acc += d;
          if (!started) {
            started = true;
            setMessages((m) => [
              ...m,
              { role: "assistant", text: acc, variant: "script" },
            ]);
          } else {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last?.role !== "assistant" || last.variant !== "script") {
                return m;
              }
              next[next.length - 1] = {
                role: "assistant",
                text: acc,
                variant: "script",
              };
              return next;
            });
          }
        },
      );
      setLastUsedScript(acc.trim() || null);
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
    let started = false;

    setClaudeThread(history);
    setChatLoading(true);

    void streamMedimadeChat(
      {
        meditationStyle: style,
        messages: history,
        journalMode: journalMode === true,
      },
      (d) => {
        acc += d;
        if (!started) {
          started = true;
          setMessages((m) => [...m, { role: "assistant", text: acc }]);
        } else {
          setMessages((m) => {
            const next = [...m];
            const last = next[next.length - 1];
            if (last?.role !== "assistant") return m;
            next[next.length - 1] = { role: "assistant", text: acc };
            return next;
          });
        }
      },
    )
      .then((text) => {
        setClaudeThread([...history, { role: "assistant", content: text }]);
      })
      .catch((e) => {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [...m, { role: "assistant", text: `Sorry — ${msg}` }]);
      })
      .finally(() => {
        setChatLoading(false);
      });
  }

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || chatLoading || scriptLoading) return;

    if (journalMode && phase === "feeling" && !meditationStyle) {
      const styleHint = "General";
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
        let started = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: styleHint,
            messages: history,
            journalMode: true,
          },
          (d) => {
            acc += d;
            if (!started) {
              started = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
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
      setMeditationStyle(trimmed);
      setPhase("claude");
      const style = trimmed;
      const history: MedimadeChatTurn[] = [{ role: "user", content: trimmed }];
      setMessages((m) => [...m, { role: "user", text: trimmed }]);
      setInput("");
      setChatLoading(true);
      try {
        let acc = "";
        let started = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: style,
            messages: history,
            journalMode: journalMode === true,
          },
          (d) => {
            acc += d;
            if (!started) {
              started = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
            }
          },
        );
        setClaudeThread([...history, { role: "assistant", content: text }]);
        setPhase("claude");
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not reach the guide.";
        setMessages((m) => [
          ...m,
          { role: "assistant", text: `Sorry — ${msg}` },
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
        let started = false;
        const text = await streamMedimadeChat(
          {
            meditationStyle: style,
            messages: nextMessages,
            journalMode: journalMode === true,
          },
          (d) => {
            acc += d;
            if (!started) {
              started = true;
              setMessages((m) => [...m, { role: "assistant", text: acc }]);
            } else {
              setMessages((m) => {
                const next = [...m];
                const last = next[next.length - 1];
                if (last?.role !== "assistant") return m;
                next[next.length - 1] = { role: "assistant", text: acc };
                return next;
              });
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
          { role: "assistant", text: `Sorry — ${msg}` },
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
      let started = false;
      const text = await streamMedimadeChat(
        {
          meditationStyle: style,
          messages: history,
          journalMode: journalMode === true,
        },
        (d) => {
          acc += d;
          if (!started) {
            started = true;
            setMessages((m) => [...m, { role: "assistant", text: acc }]);
          } else {
            setMessages((m) => {
              const next = [...m];
              const last = next[next.length - 1];
              if (last?.role !== "assistant") return m;
              next[next.length - 1] = { role: "assistant", text: acc };
              return next;
            });
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
    }
  }

  async function generateMeditationAudioAndShow() {
    if (audioLoading || !speakerModelId) return;
    setAudioError(null);
    isRedirectingRef.current = false;
    setAudioLoading(true);
    try {
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
        journalMode: journalMode === true,
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
          "Timed out waiting for details. Check Library — the job may still be running.",
        );
      }

      const speakerName =
        fishSpeakers.find((s) => s.modelId === speakerModelId)?.name ?? null;

      await upsertPendingGeneration({
        jobId,
        createdAt: new Date().toISOString(),
        title: metaTitle,
        description: metaDesc,
        meditationStyle,
        speakerName,
        speakerModelId,
        status: "running",
      });

      isRedirectingRef.current = true;
      navigation.navigate("Library");
      setAudioLoading(false);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Audio generation failed";
      setAudioError(msg);
    } finally {
      if (!isRedirectingRef.current) {
        setAudioLoading(false);
      }
    }
  }

  const placeholder =
    journalMode && phase === "feeling" && !meditationStyle
      ? "Share what’s on your mind…"
      : phase === "style"
        ? "Or type a style…"
        : phase === "feeling"
          ? "Share how you feel today…"
          : "Reply to the guide…";

  function renderGainChips(
    value: number,
    onChange: (n: number) => void,
  ) {
    return (
      <View style={styles.chipRow}>
        {GAIN_STEPS.map((g) => (
          <Pressable
            key={g}
            onPress={() => onChange(g)}
            style={[
              styles.miniChip,
              value === g && styles.miniChipOn,
            ]}
          >
            <Text
              style={[
                styles.miniChipText,
                value === g && styles.miniChipTextOn,
              ]}
            >
              {g}
            </Text>
          </Pressable>
        ))}
      </View>
    );
  }

  const mixPanel = (
    <ScrollView
      style={styles.mixScroll}
      contentContainerStyle={styles.mixScrollContent}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.mixHeading}>Narrator</Text>
      <ModalDropdown
        label="Speaker voice"
        options={speakerOptions}
        value={speakerModelId || null}
        onChange={(v) => setSpeakerModelId(v)}
        placeholder="Choose speaker…"
      />
      <View style={styles.rowBetween}>
        <Text style={styles.fieldLabel}>Voice warmth (FX)</Text>
        <Switch
          value={speakerFxPreviewOn}
          onValueChange={setSpeakerFxPreviewOn}
          trackColor={{ true: colors.accent, false: colors.border }}
        />
      </View>

      <Text style={[styles.fieldLabel, styles.gapTop]}>Speech speed</Text>
      <View style={styles.chipRow}>
        {SPEECH_SPEEDS.map((sp) => (
          <Pressable
            key={sp}
            onPress={() => setSpeechSpeed(sp)}
            style={[
              styles.miniChip,
              speechSpeed === sp && styles.miniChipOn,
            ]}
          >
            <Text
              style={[
                styles.miniChipText,
                speechSpeed === sp && styles.miniChipTextOn,
              ]}
            >
              {sp}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.mixHeading}>Background beds</Text>
      <Text style={styles.mixHint}>
        Optional layers mixed like the web app (gain 0–100 each).
      </Text>

      <ModalDropdown
        label="Nature"
        options={bgOptions(backgroundNature)}
        value={backgroundNatureKey || null}
        onChange={(v) => setBackgroundNatureKey(v)}
      />
      <Text style={styles.fieldLabel}>Nature level</Text>
      {renderGainChips(backgroundNatureGain, setBackgroundNatureGain)}

      <ModalDropdown
        label="Music"
        options={bgOptions(backgroundMusic)}
        value={backgroundMusicKey || null}
        onChange={(v) => setBackgroundMusicKey(v)}
      />
      <Text style={styles.fieldLabel}>Music level</Text>
      {renderGainChips(backgroundMusicGain, setBackgroundMusicGain)}

      <ModalDropdown
        label="Noise texture"
        options={bgOptions(backgroundNoise)}
        value={backgroundNoiseKey || null}
        onChange={(v) => setBackgroundNoiseKey(v)}
      />
      <Text style={styles.fieldLabel}>Noise level</Text>
      {renderGainChips(backgroundNoiseGain, setBackgroundNoiseGain)}

      {audioError ? (
        <Text style={styles.errorInline}>{audioError}</Text>
      ) : null}

      <Pressable
        style={[styles.primaryBtn, audioLoading && { opacity: 0.55 }]}
        disabled={audioLoading || !speakerModelId}
        onPress={() => void generateMeditationAudioAndShow()}
      >
        {audioLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryBtnText}>Generate meditation</Text>
        )}
      </Pressable>

      <Pressable
        style={[styles.outlineBtn, draftSaving && { opacity: 0.55 }]}
        disabled={draftSaving}
        onPress={() => void saveCurrentDraft()}
      >
        <Text style={styles.outlineBtnText}>
          {draftSaving ? "Saving…" : "Save draft to Library"}
        </Text>
      </Pressable>

      {draftMessage ? (
        <Text style={styles.draftNote}>{draftMessage}</Text>
      ) : null}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.stepperBar}>
          <View style={styles.stepperRow}>
            {MOBILE_STEPS.map((step, index) => (
              <Pressable
                key={step.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: mobileCreateStep === index }}
                onPress={() => setMobileCreateStep(index)}
                style={({ pressed }) => [
                  styles.stepperSegment,
                  mobileCreateStep === index && styles.stepperSegmentActive,
                  pressed && { opacity: 0.92 },
                ]}
              >
                <Text
                  style={[
                    styles.stepperIndex,
                    mobileCreateStep === index && styles.stepperIndexActive,
                  ]}
                >
                  {index + 1}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[
                    styles.stepperLabel,
                    mobileCreateStep === index && styles.stepperLabelActive,
                  ]}
                >
                  {step.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {draftLoadError ? (
          <View style={styles.bannerErr}>
            <Text style={styles.bannerErrText}>{draftLoadError}</Text>
          </View>
        ) : null}

        {mobileCreateStep === 0 ? (
          <View style={styles.chatColumn}>
            <View style={styles.titleBlock}>
              <Text style={styles.h1}>Create</Text>
              <Text style={styles.subtitle}>
                Shape your session with the guide, then mix voice and beds.
              </Text>
              <View style={styles.journalRow}>
                <Text style={styles.journalLabel}>Start from mood</Text>
                <Switch
                  value={journalMode}
                  onValueChange={(v) => applyJournalMode(v)}
                  trackColor={{ true: colors.accent, false: colors.border }}
                />
              </View>
            </View>

            <Card style={styles.chatCard}>
              <View style={styles.chatHeaderRow}>
                <Text style={styles.chatHeaderTitle}>Guide</Text>
                <Pressable
                  onPress={() => void generateScript()}
                  disabled={scriptLoading}
                  style={[
                    styles.scriptBtn,
                    scriptLoading && { opacity: 0.5 },
                  ]}
                >
                  <Text style={styles.scriptBtnText}>
                    {scriptLoading ? "…" : "Preview script"}
                  </Text>
                </Pressable>
              </View>

              <ScrollView
                style={styles.chatMessages}
                contentContainerStyle={styles.chatMessagesInner}
                nestedScrollEnabled
                ref={chatScrollRef}
                onContentSizeChange={() =>
                  chatScrollRef.current?.scrollToEnd({ animated: true })
                }
              >
                {messages.map((msg, idx) => {
                  const isScript =
                    msg.role === "assistant" && msg.variant === "script";
                  if (msg.muted) return null;
                  return (
                    <View
                      key={`${msg.role}-${idx}-${msg.variant ?? "c"}`}
                      style={[
                        styles.bubble,
                        msg.role === "user"
                          ? styles.bubbleUser
                          : isScript
                            ? styles.bubbleScript
                            : styles.bubbleAssistant,
                      ]}
                    >
                      {isScript ? (
                        <>
                          <View style={styles.scriptBadge}>
                            <Text style={styles.scriptBadgeText}>
                              Meditation script
                            </Text>
                          </View>
                          <ChatMarkdown
                            text={msg.text}
                            textStyle={styles.scriptBodyText}
                          />
                        </>
                      ) : (
                        <ChatMarkdown
                          text={msg.text}
                          textStyle={styles.bubbleText}
                        />
                      )}
                    </View>
                  );
                })}

                {!journalMode && phase === "style" ? (
                  <View style={styles.chipsRow}>
                    {meditationStyles.map((s) => (
                      <Pressable
                        key={s}
                        onPress={() => pickStyle(s)}
                        style={({ pressed }) => [
                          styles.chip,
                          pressed && { opacity: 0.9 },
                        ]}
                      >
                        <Text style={styles.chipText}>{s}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </ScrollView>

              <View style={styles.composer}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  placeholder={placeholder}
                  placeholderTextColor={colors.muted}
                  style={styles.input}
                  editable={!chatLoading && !scriptLoading}
                  returnKeyType="send"
                  onSubmitEditing={() => void send()}
                />
                <Pressable
                  onPress={() => void send()}
                  disabled={chatLoading || scriptLoading}
                  style={[
                    styles.sendBtn,
                    (chatLoading || scriptLoading) && { opacity: 0.55 },
                  ]}
                >
                  <Text style={styles.sendBtnText}>
                    {chatLoading ? "…" : "Send"}
                  </Text>
                </Pressable>
              </View>
            </Card>

            <Pressable
              style={styles.nextStepHint}
              onPress={() => setMobileCreateStep(1)}
            >
              <Text style={styles.nextStepHintText}>
                Next: Voice & mix
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.accent} />
            </Pressable>
          </View>
        ) : (
          mixPanel
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  stepperBar: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.card,
  },
  stepperRow: { flexDirection: "row", gap: 8 },
  stepperSegment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  stepperSegmentActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  stepperIndex: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.muted,
  },
  stepperIndexActive: { color: colors.accent },
  stepperLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.muted,
    flexShrink: 1,
  },
  stepperLabelActive: { color: colors.foreground },
  bannerErr: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(180,60,60,0.12)",
  },
  bannerErrText: { color: "#b03030", fontSize: 13 },
  chatColumn: { flex: 1, paddingHorizontal: 16, paddingTop: 8 },
  titleBlock: { marginBottom: 10 },
  h1: { fontSize: 26, fontWeight: "700", color: colors.foreground },
  subtitle: { marginTop: 6, color: colors.muted, fontSize: 14, lineHeight: 20 },
  journalRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  journalLabel: { fontSize: 14, fontWeight: "700", color: colors.foreground },
  chatCard: {
    flex: 1,
    minHeight: 320,
    padding: 12,
    marginBottom: 8,
  },
  chatHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  chatHeaderTitle: { fontSize: 15, fontWeight: "900", color: colors.foreground },
  scriptBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  scriptBtnText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  chatMessages: { flex: 1, maxHeight: 420 },
  chatMessagesInner: { paddingBottom: 8, gap: 10 },
  bubble: {
    maxWidth: "92%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleScript: {
    alignSelf: "stretch",
    backgroundColor: "rgba(200, 170, 90, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(200, 170, 90, 0.45)",
  },
  bubbleText: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
  scriptBodyText: { color: colors.foreground, fontSize: 15, lineHeight: 22 },
  scriptBadge: {
    marginBottom: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.06)",
  },
  scriptBadgeText: { fontSize: 11, fontWeight: "800", color: colors.muted },
  chipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipText: { fontSize: 13, fontWeight: "700", color: colors.foreground },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 88,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    color: colors.foreground,
    backgroundColor: colors.background,
  },
  sendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  sendBtnText: { color: "#fff", fontWeight: "900" },
  nextStepHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
  },
  nextStepHintText: { fontSize: 15, fontWeight: "800", color: colors.accent },
  mixScroll: { flex: 1 },
  mixScrollContent: { padding: 16, paddingBottom: 40, gap: 4 },
  mixHeading: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: "900",
    color: colors.foreground,
  },
  mixHint: { fontSize: 13, color: colors.muted, marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: colors.muted, marginTop: 6 },
  gapTop: { marginTop: 12 },
  rowBetween: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  miniChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  miniChipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  miniChipText: { fontSize: 12, fontWeight: "800", color: colors.muted },
  miniChipTextOn: { color: colors.foreground },
  primaryBtn: {
    marginTop: 20,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: { color: "#fff", fontWeight: "900", fontSize: 16 },
  outlineBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: colors.background,
  },
  outlineBtnText: { color: colors.foreground, fontWeight: "900" },
  draftNote: { marginTop: 10, fontSize: 13, color: colors.muted },
  errorInline: { marginTop: 10, color: "#b03030", fontSize: 13 },
});
