import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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
import Slider from "@react-native-community/slider";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import ChatMarkdown from "../components/ChatMarkdown";
import { colors } from "../theme/colors";
import { fonts } from "../theme/fonts";
import {
  SPEAKER_SAMPLE_SPEED_MAX,
  SPEAKER_SAMPLE_SPEED_MIN,
  SPEAKER_SAMPLE_SPEED_STEP,
  snapSpeakerSampleSpeed,
} from "../lib/speaker-sample-speed";
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
import { useCreateAudioPreview } from "../hooks/useCreateAudioPreview";

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

function CompactSelect(props: {
  value: string;
  options: { value: string; label: string }[];
  onSelect: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = props.options.find((o) => o.value === props.value)?.label;
  const display = current ?? props.placeholder ?? "Choose…";

  return (
    <>
      <Pressable
        onPress={() => !props.disabled && setOpen(true)}
        style={[
          styles.compactSelect,
          props.disabled && styles.compactSelectDisabled,
        ]}
        disabled={props.disabled}
      >
        <Text style={styles.compactSelectText} numberOfLines={1}>
          {display}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal
        visible={open}
        animationType="fade"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdropFill}
            onPress={() => setOpen(false)}
          />
          <View style={styles.modalSheet}>
            <FlatList
              data={props.options}
              keyExtractor={(item) => item.value || "__none__"}
              keyboardShouldPersistTaps="handled"
              style={styles.modalList}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.modalRow}
                  onPress={() => {
                    props.onSelect(item.value);
                    setOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.modalRowText,
                      item.value === props.value && styles.modalRowTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

function PreviewPlayButton(props: {
  playing: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={[
        styles.previewPlayBtn,
        props.disabled && { opacity: 0.45 },
      ]}
    >
      <Ionicons
        name={props.playing ? "pause" : "play"}
        size={22}
        color="#fff"
        style={props.playing ? undefined : { marginLeft: 3 }}
      />
    </Pressable>
  );
}

function LabeledSlider(props: {
  label: string;
  valueSuffix: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  onValueChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.sliderBlock}>
      <View style={styles.sliderLabelRow}>
        <Text style={styles.rowMutedCaps}>{props.label}</Text>
        <Text style={styles.sliderValue}>
          {props.valueSuffix}
        </Text>
      </View>
      <Slider
        value={props.value}
        minimumValue={props.minimumValue}
        maximumValue={props.maximumValue}
        step={props.step}
        onValueChange={props.onValueChange}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
        disabled={props.disabled}
      />
    </View>
  );
}

export default function CreateScreen() {
  const navigation = useNavigation<CreateNav>();
  const route = useRoute<CreateRoute>();
  const loadedDraftSkRef = useRef<string | null>(null);
  const skipNextSlideAnimationRef = useRef(false);
  const introTypingTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const [mobileCreateStep, setMobileCreateStep] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);
  const slideX = useRef(new Animated.Value(0)).current;

  const [journalMode, setJournalMode] = useState(true);
  const [phase, setPhase] = useState<Phase>("feeling");
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", text: "", variant: "chat" },
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
  const [speechSpeed, setSpeechSpeed] = useState(() =>
    snapSpeakerSampleSpeed(1),
  );

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
  const [mediaBaseUrl, setMediaBaseUrl] = useState<string | null>(null);

  const [draftSk, setDraftSk] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null);

  const chatScrollRef = useRef<ScrollView | null>(null);
  const isRedirectingRef = useRef(false);

  function clearIntroTyping() {
    if (introTypingTimerRef.current != null) {
      clearInterval(introTypingTimerRef.current);
      introTypingTimerRef.current = null;
    }
  }

  function startIntroTyping(messageIndex: number, fullText: string) {
    clearIntroTyping();
    let i = 0;
    introTypingTimerRef.current = setInterval(() => {
      i += 1;
      setMessages((prev) => {
        if (!prev[messageIndex] || prev[messageIndex].role !== "assistant") {
          return prev;
        }
        const next = [...prev];
        next[messageIndex] = {
          ...next[messageIndex],
          text: fullText.slice(0, i),
        };
        return next;
      });
      if (i >= fullText.length) {
        clearIntroTyping();
      }
    }, 14);
  }

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
        /* */
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const envMediaBase = getMedimadeMediaBaseUrl();
    void listBackgroundAudio()
      .then((data) => {
        if (cancelled) return;
        setBackgroundNature(data.nature);
        setBackgroundMusic(data.music);
        setBackgroundNoise(data.noise);
        const fromApi = data.baseUrl?.trim();
        setMediaBaseUrl(fromApi || envMediaBase || null);
      })
      .catch(() => {
        if (cancelled) return;
        setBackgroundNature([]);
        setBackgroundMusic([]);
        setBackgroundNoise([]);
        setMediaBaseUrl(envMediaBase || null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    playing,
    playAllActive,
    anyTrackPlaying,
    togglePlayAll,
    toggleRowPreview,
    pauseAllPreviews,
  } = useCreateAudioPreview({
    mediaBaseUrl,
    speakerModelId,
    speechSpeed,
    speakerFxPreviewOn,
    backgroundNatureKey,
    backgroundMusicKey,
    backgroundNoiseKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundNoiseGain,
  });

  useFocusEffect(
    useCallback(() => {
      return () => {
        void pauseAllPreviews();
      };
    }, [pauseAllPreviews]),
  );

  useEffect(() => {
    if (panelWidth <= 0) return;
    const skip = skipNextSlideAnimationRef.current;
    skipNextSlideAnimationRef.current = false;
    const target = mobileCreateStep === 0 ? 0 : -panelWidth;
    if (skip) {
      slideX.setValue(target);
      return;
    }
    Animated.timing(slideX, {
      toValue: target,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [mobileCreateStep, panelWidth, slideX]);

  useEffect(() => {
    if (chatLoading || scriptLoading) return;
    if (
      !(
        phase === "style" ||
        (journalMode && phase === "feeling" && !meditationStyle)
      )
    ) {
      return;
    }
    const idx = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.kind === "divider") continue;
        if (m.role === "assistant" && m.variant !== "script" && !m.muted) {
          return i;
        }
        break;
      }
      return -1;
    })();
    if (idx < 0) return;
    const opening =
      journalMode && phase === "feeling" && !meditationStyle
        ? OPENING_JOURNAL
        : OPENING_STYLE;
    const m = messages[idx];
    if (m.text === opening) {
      return;
    }
    if (
      m.text.trim().length === 0 ||
      m.text === OPENING_STYLE ||
      m.text === OPENING_JOURNAL
    ) {
      startIntroTyping(idx, opening);
    }
    return () => {
      clearIntroTyping();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- match web: only re-run when “which bubble” changes
  }, [
    phase,
    journalMode,
    meditationStyle,
    chatLoading,
    scriptLoading,
    messages.length,
  ]);

  function applyJournalMode(next: boolean) {
    clearIntroTyping();
    setJournalMode(next);
    setMeditationStyle(null);
    setClaudeThread([]);
    setInput("");
    setPhase(next ? "feeling" : "style");
    setMessages([{ role: "assistant", text: "", variant: "chat" }]);
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
    skipNextSlideAnimationRef.current = true;
    clearIntroTyping();
    setPhase(s.phase);
    setJournalMode(s.journalMode ?? false);
    setMeditationStyle(s.meditationStyle);
    setMessages(s.messages);
    setClaudeThread(s.claudeThread);
    setInput(s.input);
    setSpeechSpeed(snapSpeakerSampleSpeed(s.speechSpeed));
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

  const soundControlsDisabled = audioLoading;

  const scriptPanel = (
    <View style={styles.createPanelColumn}>
      <View style={styles.sectionCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Script</Text>
          <View style={styles.headerActions}>
            <View style={styles.journalInline}>
              <Switch
                value={journalMode}
                onValueChange={(v) => applyJournalMode(v)}
                trackColor={{ true: colors.accent, false: colors.border }}
              />
              <Text style={styles.journalInlineLabel}>Journal</Text>
            </View>
            {/* Preview script — hidden for now
            <Pressable
              onPress={() => void generateScript()}
              disabled={scriptLoading || audioLoading}
              style={[
                styles.previewScriptBtn,
                (scriptLoading || audioLoading) && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.previewScriptBtnText}>
                {scriptLoading ? "…" : "Preview script"}
              </Text>
            </Pressable>
            */}
          </View>
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
                        Meditation script · ~5 min
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
            editable={!chatLoading && !scriptLoading && !audioLoading}
            returnKeyType="send"
            onSubmitEditing={() => void send()}
          />
          <Pressable
            onPress={() => void send()}
            disabled={chatLoading || scriptLoading || audioLoading}
            style={[
              styles.sendBtn,
              (chatLoading || scriptLoading || audioLoading) && {
                opacity: 0.55,
              },
            ]}
          >
            {chatLoading ? (
              <Text style={styles.sendBtnGlyph}>…</Text>
            ) : (
              <Ionicons name="paper-plane" size={18} color="#fff" />
            )}
          </Pressable>
        </View>
      </View>

      <View style={styles.pillRowEnd}>
        <Pressable
          style={({ pressed }) => [styles.pillWhite, pressed && { opacity: 0.92 }]}
          onPress={() => setMobileCreateStep(1)}
        >
          <Text style={styles.pillWhiteText}>Audio & voice</Text>
          <Ionicons name="chevron-forward" size={20} color={colors.accent} />
        </Pressable>
      </View>
    </View>
  );

  const audioPanel = (
    <View style={styles.createPanelColumn}>
      <ScrollView
        style={styles.mixScroll}
        contentContainerStyle={styles.mixScrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, styles.sectionTitleFlex]}>
              Audio
            </Text>
            <Pressable
              onPress={() => void togglePlayAll()}
              disabled={soundControlsDisabled || !mediaBaseUrl}
              style={[
                styles.playAllBtn,
                (soundControlsDisabled || !mediaBaseUrl) && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.playAllBtnText}>
                {anyTrackPlaying || playAllActive ? "Pause all" : "Play all"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.audioBlock}>
            <Text style={styles.rowMutedCaps}>Speaker</Text>
            <View style={styles.audioSelectPlayRow}>
              <View style={styles.audioSelectGrow}>
                <CompactSelect
                  value={speakerModelId}
                  options={fishSpeakers.map((s) => ({
                    value: s.modelId,
                    label: s.name,
                  }))}
                  onSelect={setSpeakerModelId}
                  disabled={
                    soundControlsDisabled || fishSpeakers.length === 0
                  }
                  placeholder="Choose a voice"
                />
              </View>
              <PreviewPlayButton
                playing={playing.speaker}
                disabled={
                  soundControlsDisabled ||
                  !mediaBaseUrl ||
                  !speakerModelId
                }
                onPress={() => void toggleRowPreview("speaker")}
              />
            </View>
            <View style={styles.fxSpeedRow}>
              <View style={styles.fxCol}>
                <Text style={styles.fxCaps}>FX</Text>
                <Switch
                  value={speakerFxPreviewOn}
                  onValueChange={setSpeakerFxPreviewOn}
                  disabled={
                    soundControlsDisabled || !mediaBaseUrl || !speakerModelId
                  }
                  trackColor={{ true: colors.accent, false: colors.border }}
                />
              </View>
              <View style={styles.speedCol}>
                <LabeledSlider
                  label="Speed"
                  valueSuffix={`${speechSpeed.toFixed(2)}×`}
                  value={speechSpeed}
                  minimumValue={SPEAKER_SAMPLE_SPEED_MIN}
                  maximumValue={SPEAKER_SAMPLE_SPEED_MAX}
                  step={SPEAKER_SAMPLE_SPEED_STEP}
                  onValueChange={(n) =>
                    setSpeechSpeed(snapSpeakerSampleSpeed(n))
                  }
                  disabled={soundControlsDisabled}
                />
              </View>
            </View>
          </View>

          <View style={styles.audioBlock}>
            <Text style={styles.rowMutedCaps}>Music</Text>
            <View style={styles.audioSelectPlayRow}>
              <View style={styles.audioSelectGrow}>
                <CompactSelect
                  value={backgroundMusicKey}
                  options={[
                    { value: "", label: "None" },
                    ...backgroundMusic.map((s) => ({
                      value: s.key,
                      label: s.name,
                    })),
                  ]}
                  onSelect={setBackgroundMusicKey}
                  disabled={soundControlsDisabled}
                  placeholder="None"
                />
              </View>
              <PreviewPlayButton
                playing={playing.music}
                disabled={soundControlsDisabled || !backgroundMusicKey}
                onPress={() => void toggleRowPreview("music")}
              />
            </View>
            <LabeledSlider
              label="Level"
              valueSuffix={`${Math.round(backgroundMusicGain)}%`}
              value={backgroundMusicGain}
              minimumValue={0}
              maximumValue={100}
              step={1}
              onValueChange={setBackgroundMusicGain}
              disabled={soundControlsDisabled || !backgroundMusicKey}
            />
          </View>

          <View style={styles.audioBlock}>
            <Text style={styles.rowMutedCaps}>Nature</Text>
            <View style={styles.audioSelectPlayRow}>
              <View style={styles.audioSelectGrow}>
                <CompactSelect
                  value={backgroundNatureKey}
                  options={[
                    { value: "", label: "None" },
                    ...backgroundNature.map((s) => ({
                      value: s.key,
                      label: s.name,
                    })),
                  ]}
                  onSelect={setBackgroundNatureKey}
                  disabled={soundControlsDisabled}
                  placeholder="None"
                />
              </View>
              <PreviewPlayButton
                playing={playing.nature}
                disabled={soundControlsDisabled || !backgroundNatureKey}
                onPress={() => void toggleRowPreview("nature")}
              />
            </View>
            <LabeledSlider
              label="Level"
              valueSuffix={`${Math.round(backgroundNatureGain)}%`}
              value={backgroundNatureGain}
              minimumValue={0}
              maximumValue={100}
              step={1}
              onValueChange={setBackgroundNatureGain}
              disabled={soundControlsDisabled || !backgroundNatureKey}
            />
          </View>

          <View style={styles.audioBlock}>
            <Text style={styles.rowMutedCaps}>Noise</Text>
            <View style={styles.audioSelectPlayRow}>
              <View style={styles.audioSelectGrow}>
                <CompactSelect
                  value={backgroundNoiseKey}
                  options={[
                    { value: "", label: "None" },
                    ...backgroundNoise.map((s) => ({
                      value: s.key,
                      label: s.name,
                    })),
                  ]}
                  onSelect={setBackgroundNoiseKey}
                  disabled={soundControlsDisabled}
                  placeholder="None"
                />
              </View>
              <PreviewPlayButton
                playing={playing.noise}
                disabled={soundControlsDisabled || !backgroundNoiseKey}
                onPress={() => void toggleRowPreview("noise")}
              />
            </View>
            <LabeledSlider
              label="Level"
              valueSuffix={`${Math.round(backgroundNoiseGain)}%`}
              value={backgroundNoiseGain}
              minimumValue={0}
              maximumValue={100}
              step={1}
              onValueChange={setBackgroundNoiseGain}
              disabled={soundControlsDisabled || !backgroundNoiseKey}
            />
          </View>

          {audioError ? (
            <Text style={styles.errorInline}>{audioError}</Text>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.audioFooter}>
        <Pressable
          style={({ pressed }) => [styles.pillWhite, pressed && { opacity: 0.92 }]}
          onPress={() => setMobileCreateStep(0)}
        >
          <Ionicons name="chevron-back" size={20} color={colors.accent} />
          <Text style={styles.pillWhiteText}>Script</Text>
        </Pressable>
        <View style={styles.footerRight}>
          <Pressable
            style={[
              styles.pillWhite,
              draftSaving && { opacity: 0.55 },
            ]}
            disabled={draftSaving || soundControlsDisabled}
            onPress={() => void saveCurrentDraft()}
          >
            <Text style={styles.pillWhiteText}>
              {draftSaving ? "Saving…" : "Save draft"}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.generatePill,
              (audioLoading || !speakerModelId) && { opacity: 0.55 },
            ]}
            disabled={audioLoading || !speakerModelId}
            onPress={() => void generateMeditationAudioAndShow()}
          >
            {audioLoading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.generatePillText}>Generate meditation</Text>
            )}
          </Pressable>
        </View>
      </View>
      {draftMessage ? (
        <Text style={styles.draftNote}>{draftMessage}</Text>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.pageHeader}>
          <Text style={styles.h1}>Create a meditation</Text>
          <Text style={styles.subtitle}>
            Choose a style, share how you’re feeling, and chat with the guide to
            shape your script. Then pick a voice, mix beds, and generate audio.
          </Text>
        </View>

        {draftLoadError ? (
          <View style={styles.bannerErr}>
            <Text style={styles.bannerErrText}>{draftLoadError}</Text>
          </View>
        ) : null}

        <View
          style={styles.slideViewport}
          onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}
        >
          {panelWidth > 0 ? (
            <Animated.View
              style={[
                styles.slideInner,
                { width: panelWidth * 2, transform: [{ translateX: slideX }] },
              ]}
            >
              <View style={[styles.slidePage, { width: panelWidth }]}>
                {scriptPanel}
              </View>
              <View style={[styles.slidePage, { width: panelWidth }]}>
                {audioPanel}
              </View>
            </Animated.View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },
  pageHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  h1: {
    fontFamily: fonts.displayMedium,
    fontSize: 30,
    fontWeight: "500",
    color: colors.foreground,
    letterSpacing: -0.5,
  },
  subtitle: {
    marginTop: 8,
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.muted,
  },
  bannerErr: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(180,60,60,0.12)",
  },
  bannerErrText: {
    fontFamily: fonts.sans,
    color: "#b03030",
    fontSize: 13,
  },
  slideViewport: {
    flex: 1,
    overflow: "hidden",
  },
  slideInner: {
    flexDirection: "row",
    flex: 1,
  },
  slidePage: {
    flex: 1,
    minHeight: 0,
  },
  /** Full-bleed Create panels (script + audio) to screen edges (within safe area). */
  createPanelColumn: {
    flex: 1,
    minHeight: 0,
  },
  sectionCard: {
    flex: 1,
    minHeight: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sectionTitle: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 16,
    fontWeight: "600",
    color: colors.foreground,
    letterSpacing: -0.2,
  },
  sectionTitleFlex: {
    flex: 1,
    minWidth: 0,
  },
  playAllBtn: {
    borderRadius: 10,
    backgroundColor: colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  playAllBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  journalInline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  journalInlineLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.muted,
    fontWeight: "500",
  },
  previewScriptBtn: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  previewScriptBtnText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 12,
    fontWeight: "600",
    color: colors.foreground,
  },
  chatMessages: {
    flex: 1,
    maxHeight: 420,
    paddingTop: 12,
  },
  chatMessagesInner: {
    paddingBottom: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  bubble: {
    maxWidth: "92%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.userBubble,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.assistantBubble,
    borderWidth: 1,
    borderColor: colors.border,
  },
  bubbleScript: {
    alignSelf: "stretch",
    backgroundColor: colors.scriptBubbleBg,
    borderWidth: 1,
    borderColor: colors.scriptBubbleBorder,
  },
  bubbleText: {
    fontFamily: fonts.sans,
    fontSize: 15,
    lineHeight: 22,
    color: colors.foreground,
  },
  scriptBodyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 22,
    color: colors.foreground,
    opacity: 0.95,
  },
  scriptBadge: {
    marginBottom: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(196, 154, 108, 0.4)",
    backgroundColor: "rgba(196, 154, 108, 0.15)",
  },
  scriptBadgeText: {
    fontFamily: fonts.sansBold,
    fontSize: 10,
    fontWeight: "700",
    color: colors.gold,
    letterSpacing: 0.6,
  },
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
    backgroundColor: colors.background,
  },
  chipText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 13,
    fontWeight: "600",
    color: colors.foreground,
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.card,
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
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnGlyph: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },
  pillRowEnd: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  pillWhite: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.pillBorder,
    backgroundColor: colors.pillBg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  pillWhiteText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
    fontWeight: "600",
    color: colors.pillText,
  },
  mixScroll: { flex: 1 },
  mixScrollContent: { paddingBottom: 24 },
  audioBlock: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  rowMutedCaps: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.muted,
  },
  audioSelectPlayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  audioSelectGrow: {
    flex: 1,
    minWidth: 0,
  },
  compactSelect: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  compactSelectDisabled: {
    opacity: 0.55,
  },
  compactSelectText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.foreground,
  },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalBackdropFill: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    maxHeight: "72%",
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  modalList: {
    maxHeight: 360,
  },
  modalRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  modalRowText: {
    fontFamily: fonts.sans,
    fontSize: 16,
    color: colors.foreground,
  },
  modalRowTextSelected: {
    fontFamily: fonts.sansSemiBold,
    fontWeight: "600",
    color: colors.accent,
  },
  previewPlayBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  fxSpeedRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    marginTop: 8,
  },
  fxCol: {
    alignItems: "center",
    width: 48,
  },
  fxCaps: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 10,
    fontWeight: "600",
    color: colors.muted,
    marginBottom: 4,
  },
  speedCol: {
    flex: 1,
    minWidth: 0,
  },
  sliderBlock: { marginTop: 4 },
  sliderLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  sliderValue: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.muted,
  },
  audioFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: colors.background,
  },
  footerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  generatePill: {
    borderRadius: 999,
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 3,
    minWidth: 120,
    alignItems: "center",
  },
  generatePillText: {
    fontFamily: fonts.sansSemiBold,
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  draftNote: {
    fontFamily: fonts.sans,
    textAlign: "center",
    fontSize: 12,
    color: colors.muted,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  errorInline: {
    fontFamily: fonts.sans,
    marginTop: 8,
    paddingHorizontal: 14,
    color: "#b03030",
    fontSize: 13,
  },
});
