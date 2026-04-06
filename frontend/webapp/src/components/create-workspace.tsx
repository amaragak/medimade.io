"use client";

import { useEffect, useRef, useState } from "react";
import { FISH_SPEAKERS } from "@/lib/fish-speakers";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  type MedimadeChatTurn,
  streamMedimadeChat,
  streamMeditationScript,
  generateMeditationAudio,
  getMedimadeMediaBaseUrl,
  listBackgroundAudio,
  listFishSpeakers,
  type FishSpeaker,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";
import {
  SPEAKER_SAMPLE_SPEED_MAX,
  SPEAKER_SAMPLE_SPEED_MIN,
  SPEAKER_SAMPLE_SPEED_STEP,
  snapSpeakerSampleSpeed,
  speakerPreviewSampleKey,
} from "@/lib/speaker-sample-speed";

function mediaFileUrl(base: string, key: string): string {
  const b = base.replace(/\/$/, "");
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${b}/${path}`;
}

const SPEAKER_SAMPLE_GAP_MS = 3000;

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

type Phase = "style" | "feeling" | "claude";

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

export function CreateWorkspace() {
  const [phase, setPhase] = useState<Phase>("style");
  const [meditationStyle, setMeditationStyle] = useState<string | null>(null);
  const [claudeThread, setClaudeThread] = useState<MedimadeChatTurn[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioModalUrl, setAudioModalUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [lastUsedScript, setLastUsedScript] = useState<string | null>(null);
  const [speechSpeed, setSpeechSpeed] = useState<number>(() =>
    snapSpeakerSampleSpeed(1),
  );
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
  const [backgroundNatureGain, setBackgroundNatureGain] = useState(80);
  const [backgroundMusicGain, setBackgroundMusicGain] = useState(70);
  const [backgroundDrumsGain, setBackgroundDrumsGain] = useState(55);
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
  const [fishSpeakers, setFishSpeakers] = useState<FishSpeaker[]>(
    FISH_SPEAKERS as unknown as FishSpeaker[],
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "What style of meditation should we build? Pick one below or describe your own in the box.",
      variant: "chat",
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [input, setInput] = useState("");
  const [speakerModelId, setSpeakerModelId] = useState<string>(() => {
    const emily = FISH_SPEAKERS.find((s) => s.name.toLowerCase() === "emily");
    return emily?.modelId ?? FISH_SPEAKERS[0].modelId;
  });

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

      const { audioUrl, scriptTextUsed } =
        await generateMeditationAudio({
          meditationStyle,
          transcript,
          scriptText: existingScript,
          reference_id: speakerModelId,
          speed: speechSpeed,
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

      if (!existingScript) {
        setMessages((m) => [
          ...m,
          { role: "assistant", text: scriptTextUsed, variant: "script" },
        ]);
      }

      setAudioModalUrl(audioUrl);
      // Ensure modal has access to the final script text used for synthesis.
      setLastUsedScript(scriptTextUsed);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Audio generation failed";
      setAudioError(msg);
    } finally {
      setAudioLoading(false);
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
    const sync = (
      el: HTMLAudioElement | null,
      key: string,
      gain: number,
    ) => {
      if (!el) return;
      el.loop = true;
      el.volume = Math.min(1, Math.max(0, gain / 100));
      if (base && key) {
        const next = mediaFileUrl(base, key);
        if (el.src !== next) {
          el.src = next;
          void el.load();
        }
      } else {
        el.removeAttribute("src");
        el.load();
      }
    };
    sync(previewNatureRef.current, backgroundNatureKey, backgroundNatureGain);
    sync(previewMusicRef.current, backgroundMusicKey, backgroundMusicGain);
    sync(previewDrumsRef.current, backgroundDrumsKey, backgroundDrumsGain);
  }, [
    mediaBaseUrl,
    backgroundNatureKey,
    backgroundMusicKey,
    backgroundDrumsKey,
    backgroundNatureGain,
    backgroundMusicGain,
    backgroundDrumsGain,
  ]);

  function clearSpeakerGapSchedule() {
    if (speakerGapTimeoutRef.current !== null) {
      clearTimeout(speakerGapTimeoutRef.current);
      speakerGapTimeoutRef.current = null;
    }
  }

  const anyTrackPlaying =
    playing.speaker || playing.nature || playing.music || playing.drums;

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
      const next = mediaFileUrl(
        mediaBaseUrl,
        speakerPreviewSampleKey(speakerModelId, speechSpeed),
      );
      if (el.src !== next) {
        el.src = next;
        void el.load();
      }
    } else {
      el.removeAttribute("src");
      el.load();
    }
  }, [mediaBaseUrl, speakerModelId, speechSpeed]);

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

      {/* Narrow: flex column — Script/chat first, Audio below (grid 1fr row was collapsing the chat). lg: two-column grid. */}
      <div className="flex min-h-0 flex-1 flex-col gap-8 lg:grid lg:h-full lg:min-h-0 lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
        <section className="flex min-h-[42vh] w-full min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:h-full lg:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold tracking-tight">
                Script
              </h2>
            </div>
            <button
              type="button"
              onClick={() => void generateScript()}
              disabled={scriptLoading}
              className="shrink-0 cursor-pointer rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-accent/50 hover:bg-accent-soft/35 disabled:cursor-not-allowed disabled:opacity-50"
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
              {messages.map((msg, i) => {
                const isScript =
                  msg.role === "assistant" && msg.variant === "script";
                return (
                  <div
                    key={`${msg.role}-${i}-${msg.variant ?? "u"}`}
                    className={
                      msg.role === "user"
                        ? "ml-6 rounded-xl bg-border/40 px-3 py-2 text-[15px] text-foreground"
                        : isScript
                          ? "rounded-xl border border-gold/45 bg-gold/5 px-3 py-2 text-foreground shadow-sm"
                          : "rounded-xl bg-accent-soft/80 px-3 py-2 text-[15px] text-foreground"
                    }
                  >
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
                );
              })}
              {phase === "style" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {meditationStyles.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => pickStyle(s)}
                      className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="mt-3 flex shrink-0 gap-2 border-t border-border pt-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void send()}
                aria-busy={chatLoading || scriptLoading}
                placeholder={
                  phase === "style"
                    ? "Or type a style (e.g. Yoga nidra)…"
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
                className="cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white dark:text-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                {chatLoading ? "…" : "Send"}
              </button>
            </div>
          </div>
        </section>

        <div className="flex w-full shrink-0 flex-col gap-6 pb-12 lg:min-h-0 lg:h-full lg:overflow-y-auto">
          <section className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <h2 className="text-base font-semibold tracking-tight">Audio</h2>
              <button
                type="button"
                onClick={() => void togglePlayAll()}
                disabled={!mediaBaseUrl}
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

            <div className="p-4">
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
                      stopAllAudioPreview();
                      setSpeakerModelId(e.target.value);
                    }}
                    className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm"
                  >
                    {fishSpeakers.map((s) => (
                      <option key={s.modelId} value={s.modelId}>
                        {s.name}
                      </option>
                    ))}
                  </select>
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
                      className="h-2 w-full accent-foreground"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("speaker")}
                    disabled={!mediaBaseUrl || !speakerModelId}
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
                      stopAllAudioPreview();
                    }}
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
                      disabled={!backgroundNatureKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("nature")}
                    disabled={!backgroundNatureKey}
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
                      stopAllAudioPreview();
                    }}
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
                      disabled={!backgroundMusicKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("music")}
                    disabled={!backgroundMusicKey}
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
                      stopAllAudioPreview();
                    }}
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
                      disabled={!backgroundDrumsKey}
                      className="h-2 w-full accent-foreground disabled:opacity-40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleRowPreview("drums")}
                    disabled={!backgroundDrumsKey}
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

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="cursor-pointer rounded-full border border-border px-5 py-3 text-sm font-medium text-muted hover:border-accent/40"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => void generateMeditationAudioAndShow()}
              disabled={audioLoading}
              className="flex-1 cursor-pointer rounded-full bg-accent py-3 text-sm font-semibold text-white dark:text-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              {audioLoading ? "Generating…" : "Generate meditation"}
            </button>
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
