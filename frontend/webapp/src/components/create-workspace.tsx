"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FISH_SPEAKERS } from "@/lib/fish-speakers";
import { ChatMarkdown } from "@/components/chat-markdown";
import {
  type MedimadeChatTurn,
  streamMedimadeChat,
  streamMeditationScript,
  generateMeditationAudio,
  listBackgroundAudio,
  type BackgroundAudioItem,
} from "@/lib/medimade-api";

type ChatMessage = {
  role: "assistant" | "user";
  text: string;
  /** Distinct styling for generated meditation script vs coach replies. */
  variant?: "chat" | "script";
};

const FALLBACK_SOUNDS = [
  { key: "fallback/rain-soft-pads", name: "Rain + soft pads" },
  { key: "fallback/studio-silence", name: "Studio silence" },
  { key: "fallback/forest-dawn", name: "Forest dawn" },
  { key: "fallback/ocean-low", name: "Ocean low" },
];
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
  const isDev = process.env.NODE_ENV !== "production";
  const [speechSpeed, setSpeechSpeed] = useState<number>(1);
  const [backgroundSounds, setBackgroundSounds] =
    useState<BackgroundAudioItem[]>([]);
  const [backgroundSoundKey, setBackgroundSoundKey] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: "What style of meditation should we build? Pick one below or describe your own in the box.",
      variant: "chat",
    },
  ]);
  const [input, setInput] = useState("");
  const [speakerModelId, setSpeakerModelId] = useState<string>(() => {
    const emily = FISH_SPEAKERS.find((s) => s.name.toLowerCase() === "emily");
    return emily?.modelId ?? FISH_SPEAKERS[0].modelId;
  });

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
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: getStyleFollowupQuestion(trimmed),
        },
      ]);
    }, 400);
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
      const nextMessages: MedimadeChatTurn[] = [
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
          ...(isDev ? { speed: speechSpeed } : {}),
          backgroundSoundKey: backgroundSoundKey ?? undefined,
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
    (async () => {
      try {
        const items = await listBackgroundAudio();
        if (cancelled) return;
        if (items.length > 0) {
          setBackgroundSounds(items);
          setBackgroundSoundKey(items[0]?.key ?? null);
        } else {
          setBackgroundSounds(FALLBACK_SOUNDS as BackgroundAudioItem[]);
          setBackgroundSoundKey(FALLBACK_SOUNDS[0]?.key ?? null);
        }
      } catch {
        if (cancelled) return;
        setBackgroundSounds(FALLBACK_SOUNDS as BackgroundAudioItem[]);
        setBackgroundSoundKey(FALLBACK_SOUNDS[0]?.key ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-6 shrink-0">
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Create a meditation
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          The guide starts with your meditation style, then asks how you feel;
          after that you chat live with Claude Haiku to shape your sit. Panels on
          the right set audio, markers, and export options.
        </p>
      </div>

      {/* Height comes from layout: body h-dvh → main flex-1 → this grid fills space under the title. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-8 lg:h-full lg:min-h-0 lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
        <section className="row-start-1 flex min-h-0 h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:col-span-2 lg:row-start-1">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">Guide chat</h2>
              <p className="text-xs text-muted">
                Style → how you feel today → live coach chat
              </p>
            </div>
            <button
              type="button"
              onClick={() => void generateScript()}
              disabled={scriptLoading}
              className="shrink-0 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-accent/50 hover:bg-accent-soft/35 disabled:opacity-50"
            >
              {scriptLoading ? "…" : "Generate script"}
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {messages.map((msg, i) => {
                const isScript =
                  msg.role === "assistant" && msg.variant === "script";
                return (
                  <div
                    key={`${msg.role}-${i}-${msg.variant ?? "u"}`}
                    className={
                      msg.role === "user"
                        ? "ml-6 rounded-xl bg-border/40 px-3 py-2 text-sm text-foreground"
                        : isScript
                          ? "rounded-xl border border-gold/45 bg-gold/5 px-3 py-2 text-foreground shadow-sm"
                          : "rounded-xl bg-accent-soft/80 px-3 py-2 text-sm text-foreground"
                    }
                  >
                    {isScript ? (
                      <>
                        <div className="mb-2 inline-flex items-center rounded-full border border-gold/40 bg-gold/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold">
                          Meditation script · ~5 min
                        </div>
                        <ChatMarkdown
                          text={msg.text}
                          className="font-serif text-[13px] leading-relaxed text-foreground/95"
                        />
                      </>
                    ) : (
                      <ChatMarkdown
                        text={msg.text}
                        className="text-sm leading-snug"
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
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-accent/50 hover:bg-accent-soft/40"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-3 flex shrink-0 gap-2 border-t border-border pt-3">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void send()}
                disabled={chatLoading || scriptLoading}
                placeholder={
                  phase === "style"
                    ? "Or type a style (e.g. Yoga nidra)…"
                    : phase === "feeling"
                      ? "Share how you feel today…"
                      : "Reply to the guide…"
                }
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2 disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={chatLoading || scriptLoading}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white dark:text-deep disabled:opacity-60"
              >
                {chatLoading ? "…" : "Send"}
              </button>
            </div>
          </div>
        </section>

        <div className="row-start-2 flex min-h-0 flex-col gap-6 overflow-y-auto pb-12 lg:col-span-3 lg:row-start-1 lg:h-full lg:overflow-y-auto">
          <Panel title="Sound" subtitle="Bed and ambience">
            <select
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              value={backgroundSoundKey ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setBackgroundSoundKey(v === "" ? null : v);
              }}
            >
              <option value="">No background audio</option>
              {backgroundSounds.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </Panel>

          <div className="grid gap-6 sm:grid-cols-2">
            <Panel title="Speaker" subtitle="Fish Audio voice model">
              <select
                value={speakerModelId}
                onChange={(e) => setSpeakerModelId(e.target.value)}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              >
                {FISH_SPEAKERS.map((s) => (
                  <option key={s.modelId} value={s.modelId}>
                    {s.name}
                  </option>
                ))}
              </select>
              {isDev ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs font-semibold text-muted">
                      Speed
                    </label>
                    <span className="text-xs font-semibold text-foreground">
                      {speechSpeed.toFixed(2)}×
                    </span>
                  </div>
                  <input
                    aria-label="Speech speed"
                    type="range"
                    min={0.7}
                    max={1}
                    step={0.01}
                    value={speechSpeed}
                    onChange={(e) => setSpeechSpeed(Number(e.target.value))}
                    className="mt-2 h-2 w-full accent-foreground"
                  />
                </div>
              ) : null}
              <button
                type="button"
                className="mt-3 w-full rounded-xl border border-dashed border-gold/60 bg-gold/5 py-2 text-xs font-medium text-gold"
              >
                Voice cloning setup (Pro)
              </button>
            </Panel>

            <Panel title="Optional video" subtitle="Logo overlay on calm loop">
              <div className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted">
                Drop logo / short loop
                <span className="mt-1 text-[10px]">MP4 / MOV · mock UI</span>
              </div>
            </Panel>
          </div>

          <Panel
            title="Markers"
            subtitle="Chimes before sections · pauses for cadence"
          >
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

          <Panel title="Manifestation focus" subtitle="Specific goal for this sit">
            <textarea
              rows={3}
              placeholder="e.g. Walk on stage feeling grounded; hear the first phrase clearly…"
              className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
            />
          </Panel>

          <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Pro · Creators</p>
                <p className="text-xs text-muted">
                  WAV download, loudness-ready masters, YouTube channel packs
                </p>
              </div>
              <Link
                href="/pro"
                className="rounded-full bg-gold px-4 py-2 text-xs font-semibold text-deep"
              >
                View Pro
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void generateMeditationAudioAndShow()}
              disabled={audioLoading}
              className="flex-1 rounded-full bg-accent py-3 text-sm font-semibold text-white dark:text-deep disabled:opacity-60"
            >
              {audioLoading ? "Generating…" : "Generate meditation"}
            </button>
            <button
              type="button"
              className="rounded-full border border-border px-5 py-3 text-sm font-medium text-muted hover:border-accent/40"
            >
              Save draft
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
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground"
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
                className="rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground hover:border-accent/50"
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
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted">{subtitle}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}
