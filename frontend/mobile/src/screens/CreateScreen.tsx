import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Card from "../components/ui/Card";
import ChatMarkdown from "../components/ChatMarkdown";
import ModalDropdown from "../components/ui/ModalDropdown";
import { colors } from "../theme/colors";
import {
  type MedimadeChatTurn,
  streamMedimadeChat,
  streamMeditationScript,
  generateMeditationAudio,
  listFishSpeakers,
  type FishSpeaker,
} from "../lib/medimade-api";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  variant?: "chat" | "script";
};

const soundPresets = ["Rain + soft pads", "Studio silence", "Forest dawn", "Ocean low"];
const meditationStyles = [
  "Body scan",
  "Visualization",
  "Breath-led",
  "Manifestation",
  "Affirmation loop",
  "Sleep",
  "Loving-kindness",
  "Anxiety relief",
] as const;

type Phase = "style" | "feeling" | "claude";

const MOBILE_CREATE_STEPS = [
  { key: "chat", label: "Chat" },
  { key: "audio", label: "Audio" },
  { key: "layout", label: "Layout" },
  { key: "export", label: "Export" },
] as const;

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

export default function CreateScreen() {
  const [phase, setPhase] = useState<Phase>("style");
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioModalUrl, setAudioModalUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "What style of meditation should we build? Pick one below or describe your own in the box.",
      variant: "chat",
    },
  ]);
  const chatScrollRef = useRef<ScrollView | null>(null);

  const [input, setInput] = useState("");

  useEffect(() => {
    chatScrollRef.current?.scrollToEnd({ animated: true });
  }, [messages.length]);

  /** Create flow step: Chat → Audio → Layout → Export */
  const [mobileCreateStep, setMobileCreateStep] = useState(0);

  const [sound, setSound] = useState(soundPresets[0]);
  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>([]);
  const [speakerModelId, setSpeakerModelId] = useState<string>("");

  useEffect(() => {
    void listFishSpeakers()
      .then((sp) => {
        if (!sp || sp.length === 0) return;
        setFishSpeakers(sp);
        const emily = sp.find((s) => s.name.toLowerCase() === "emily");
        setSpeakerModelId((current) => {
          if (sp.some((s) => s.modelId === current)) return current;
          return emily?.modelId ?? sp[0].modelId;
        });
      })
      .catch(() => {
        // Keep fallback constant speakers if endpoint isn't reachable.
      });
  }, []);

  const speakerOptions = useMemo(
    () =>
      fishSpeakers.map((s) => ({
        label: s.name,
        value: s.modelId,
      })),
    [fishSpeakers],
  );

  const soundOptions = useMemo(
    () => soundPresets.map((s) => ({ label: s, value: s })),
    [],
  );

  async function generateScript() {
    if (scriptLoading) return;
    const transcript = messages
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

  async function send() {
    const trimmed = input.trim();
    if (!trimmed || chatLoading || scriptLoading) return;

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

      const { audioUrl, scriptTextUsed } = await generateMeditationAudio({
        meditationStyle,
        transcript,
        scriptText: existingScript,
        reference_id: speakerModelId,
      });

      if (!existingScript) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: scriptTextUsed, variant: "script" },
        ]);
      }

      setAudioModalUrl(audioUrl);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Audio generation failed";
      setAudioError(msg);
    } finally {
      setAudioLoading(false);
    }
  }

  const placeholder =
    phase === "style"
      ? "Or type a style (e.g. Yoga nidra)…"
      : phase === "feeling"
        ? "Share how you feel today…"
        : "Reply to the guide…";

  const chatCardStyle = [styles.chatCard, styles.chatCardCompact];

  const titleBlock = (
    <View style={styles.titleBlock}>
      <Text style={styles.h1}>Create a meditation</Text>
      <Text style={styles.subtitle}>
        Chat with the guide, then use the steps to tune audio and export.
      </Text>
    </View>
  );

  const soundSpeakerPanel = (
    <>
      <Text style={styles.panelTitle}>Sound</Text>
      <ModalDropdown
        options={soundOptions}
        value={sound}
        onChange={(v) => setSound(v)}
      />
      <View style={styles.spacer} />
      <Text style={styles.panelTitle}>Speaker</Text>
      <ModalDropdown
        options={speakerOptions}
        value={speakerModelId}
        onChange={(v) => setSpeakerModelId(v)}
      />
    </>
  );

  const layoutPanel = (
    <>
      <Text style={styles.panelTitle}>Optional video</Text>
      <View style={styles.videoPlaceholder}>
        <Text style={styles.videoPlaceholderText}>
          Drop logo / short loop
        </Text>
        <Text style={styles.videoPlaceholderSub}>
          MP4 / MOV · mock UI
        </Text>
      </View>
      <View style={styles.spacer} />
      <Text style={styles.panelTitle}>Markers</Text>
      <View style={styles.markerList}>
        {[
          { label: "Opening chime", t: "0:00" },
          { label: "Pause · body settle", t: "2:30" },
          { label: "Section chime · visualization", t: "5:00" },
        ].map((m) => (
          <View key={m.t} style={styles.markerRow}>
            <Text style={styles.markerLabel}>{m.label}</Text>
            <Text style={styles.markerTime}>{m.t}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.secondaryBtn} onPress={() => {}}>
        <Text style={styles.secondaryBtnText}>+ Add marker</Text>
      </Pressable>
    </>
  );

  const exportPanel = (
    <>
      <Text style={styles.panelTitle}>Manifestation focus</Text>
      <TextInput
        multiline
        numberOfLines={3}
        placeholder="e.g. Walk on stage feeling grounded; hear the first phrase clearly…"
        placeholderTextColor={colors.muted}
        style={styles.textArea}
      />
      <View style={styles.bigSpacer} />
      <Pressable
        style={[styles.primaryBtn, audioLoading && { opacity: 0.55 }]}
        disabled={audioLoading}
        onPress={() => void generateMeditationAudioAndShow()}
      >
        <Text style={styles.primaryBtnText}>
          {audioLoading ? "Generating…" : "Generate meditation"}
        </Text>
      </Pressable>
      <Pressable style={styles.outlineBtn} onPress={() => {}}>
        <Text style={styles.outlineBtnText}>Save draft</Text>
      </Pressable>
    </>
  );

  function renderGuideChatCard() {
    return (
      <Card style={chatCardStyle}>
        <View style={styles.chatHeader}>
          <View style={styles.chatHeaderRow}>
            <View style={styles.chatHeaderTextBlock}>
              <Text style={styles.chatHeaderTitle}>Guide chat</Text>
              <Text style={styles.chatHeaderSubtitle}>
                Style → how you feel today → live coach chat
              </Text>
            </View>
            <Pressable
              onPress={() => void generateScript()}
              disabled={scriptLoading}
              style={({ pressed }) => [
                styles.scriptBtn,
                scriptLoading && { opacity: 0.5 },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={styles.scriptBtnText}>
                {scriptLoading ? "…" : "Generate script"}
              </Text>
            </Pressable>
          </View>
        </View>

        <ScrollView
          style={styles.chatMessages}
          contentContainerStyle={styles.chatMessagesInner}
          nestedScrollEnabled
          ref={chatScrollRef}
        >
          {messages.map((msg, idx) => {
            const isScript =
              msg.role === "assistant" && msg.variant === "script";
            return (
              <View
                // eslint-disable-next-line react/no-array-index-key
                key={`${msg.role}-${idx}-${msg.variant ?? "u"}`}
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

          {phase === "style" ? (
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
            multiline={false}
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
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={styles.compactRoot}>
          <View style={styles.stepperBar}>
            <View style={styles.stepperRow}>
              {MOBILE_CREATE_STEPS.map((step, index) => (
                <Pressable
                  key={step.key}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: mobileCreateStep === index }}
                  accessibilityLabel={step.label}
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

          {mobileCreateStep === 0 ? (
            <View style={styles.compactStep0}>
              {titleBlock}
              {renderGuideChatCard()}
            </View>
          ) : null}

          {mobileCreateStep === 1 ? (
            <ScrollView
              style={styles.compactStepScroll}
              contentContainerStyle={styles.compactStepScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.compactStepHeading}>Audio</Text>
              <Text style={styles.compactStepSub}>
                Background mix and narrator voice.
              </Text>
              <View style={styles.optionsInner}>{soundSpeakerPanel}</View>
            </ScrollView>
          ) : null}

          {mobileCreateStep === 2 ? (
            <ScrollView
              style={styles.compactStepScroll}
              contentContainerStyle={styles.compactStepScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.compactStepHeading}>Layout</Text>
              <Text style={styles.compactStepSub}>
                Video placeholder and session markers.
              </Text>
              <View style={styles.optionsInner}>{layoutPanel}</View>
            </ScrollView>
          ) : null}

          {mobileCreateStep === 3 ? (
            <ScrollView
              style={styles.compactStepScroll}
              contentContainerStyle={styles.compactStepScrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.compactStepHeading}>Export</Text>
              <Text style={styles.compactStepSub}>
                Focus notes and generate your meditation.
              </Text>
              <View style={styles.optionsInner}>{exportPanel}</View>
            </ScrollView>
          ) : null}
        </View>
      </KeyboardAvoidingView>

      {audioModalUrl ? (
        <View style={styles.audioModalOverlay}>
          <View style={styles.audioModalCard}>
            <View style={styles.audioModalTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.audioModalTitle}>Meditation audio</Text>
                <Text style={styles.audioModalSubtitle}>
                  Streaming from CloudFront (MP3)
                </Text>
              </View>
              <Pressable
                onPress={() => setAudioModalUrl(null)}
                style={styles.audioModalCloseBtn}
              >
                <Text style={styles.audioModalCloseText}>Close</Text>
              </Pressable>
            </View>

            {audioError ? (
              <Text style={styles.audioModalError}>{audioError}</Text>
            ) : null}

            <Pressable
              onPress={() => void Linking.openURL(audioModalUrl)}
              style={styles.audioModalPrimaryBtn}
            >
              <Text style={styles.audioModalPrimaryBtnText}>Play</Text>
            </Pressable>

            <Pressable
              onPress={() => void Linking.openURL(audioModalUrl)}
              style={styles.audioModalSecondaryBtn}
            >
              <Text style={styles.audioModalSecondaryBtnText}>
                Download
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1 },

  audioModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  audioModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: 16,
  },
  audioModalTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  audioModalTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.foreground,
  },
  audioModalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.muted,
  },
  audioModalCloseBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  audioModalCloseText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.foreground,
  },
  audioModalError: {
    marginTop: 10,
    fontSize: 12,
    color: colors.muted,
  },
  audioModalPrimaryBtn: {
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  audioModalPrimaryBtnText: {
    color: "#fff",
    fontWeight: "900",
  },
  audioModalSecondaryBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  audioModalSecondaryBtnText: {
    color: colors.foreground,
    fontWeight: "900",
  },

  titleBlock: { marginBottom: 12 },
  h1: { fontSize: 26, fontWeight: "700", color: colors.foreground },
  subtitle: { marginTop: 6, color: colors.muted, fontSize: 14 },

  split: { flex: 1 },

  chatWrap: { flex: 1.15 },
  chatCard: { backgroundColor: colors.card },
  chatCardCompact: {
    flex: 1,
    minHeight: 280,
    overflow: "hidden",
  },

  compactRoot: { flex: 1, minHeight: 0 },
  compactStep0: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  compactStepScroll: { flex: 1 },
  compactStepScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 30,
  },
  compactStepHeading: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.foreground,
  },
  compactStepSub: {
    marginTop: 6,
    marginBottom: 4,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 18,
  },

  stepperBar: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  stepperSegment: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  stepperSegmentActive: {
    borderBottomColor: colors.accent,
  },
  stepperIndex: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.muted,
  },
  stepperIndexActive: {
    color: colors.accent,
  },
  stepperLabel: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: "600",
    color: colors.muted,
    textAlign: "center",
  },
  stepperLabelActive: {
    color: colors.foreground,
    fontWeight: "800",
  },

  chatHeader: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  chatHeaderTextBlock: { flex: 1, minWidth: 0 },
  chatHeaderTitle: { fontSize: 14, fontWeight: "800", color: colors.foreground },
  chatHeaderSubtitle: { marginTop: 4, fontSize: 12, color: colors.muted },
  scriptBtn: {
    marginTop: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  scriptBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.foreground,
  },

  chatMessages: { flex: 1 },
  chatMessagesInner: { paddingHorizontal: 12, paddingVertical: 12, gap: 10 },

  bubble: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    maxWidth: "92%",
  },
  bubbleAssistant: {
    backgroundColor: colors.accentSoft,
    alignSelf: "flex-start",
  },
  bubbleScript: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(196, 154, 108, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(196, 154, 108, 0.45)",
  },
  bubbleUser: {
    backgroundColor: colors.border,
    marginLeft: "8%",
    alignSelf: "flex-start",
  },
  bubbleText: { color: colors.foreground, fontSize: 14, lineHeight: 18 },
  scriptBadge: {
    alignSelf: "flex-start",
    marginBottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(196, 154, 108, 0.45)",
    backgroundColor: "rgba(196, 154, 108, 0.18)",
  },
  scriptBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
    color: colors.gold,
    textTransform: "uppercase",
  },
  scriptBodyText: {
    color: colors.foreground,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Platform.select({
      ios: "Georgia",
      android: "serif",
      default: "serif",
    }),
    opacity: 0.96,
  },

  composer: {
    flexDirection: "row",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.foreground,
  },
  sendBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
  },
  sendBtnText: { color: "#fff", fontWeight: "700" },

  chipsRow: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  chipText: { color: colors.foreground, fontSize: 12, fontWeight: "700" },

  optionsWrap: { flex: 0.85 },
  optionsInner: { paddingTop: 10, paddingBottom: 24 },

  panelTitle: { fontSize: 12, fontWeight: "800", color: colors.foreground, marginBottom: 8, marginTop: 8 },
  spacer: { height: 14 },
  bigSpacer: { height: 18 },

  videoPlaceholder: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderStyle: "dashed",
    borderRadius: 16,
    height: 92,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  videoPlaceholderText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  videoPlaceholderSub: { marginTop: 4, color: colors.muted, fontSize: 11 },

  markerList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.card,
    padding: 12,
  },
  markerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  markerLabel: { color: colors.foreground, fontSize: 13, flex: 1 },
  markerTime: { color: colors.muted, fontSize: 13, width: 60, textAlign: "right" },

  secondaryBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: "dashed",
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  secondaryBtnText: { color: colors.muted, fontSize: 13, fontWeight: "800" },

  textArea: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 90,
    fontSize: 14,
    color: colors.foreground,
  },

  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },

  outlineBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: colors.card,
  },
  outlineBtnText: { color: colors.muted, fontWeight: "800" },
});

