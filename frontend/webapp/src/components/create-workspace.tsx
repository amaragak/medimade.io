"use client";

import { useState } from "react";
import Link from "next/link";
import { FISH_SPEAKERS } from "@/lib/fish-speakers";

const soundPresets = ["Rain + soft pads", "Studio silence", "Forest dawn", "Ocean low"];
const meditationStyles = [
  "Body scan",
  "Visualization",
  "Breath-led",
  "Manifestation",
  "Affirmation loop",
];
const voices = ["Warm alto", "Calm tenor", "Neutral guide", "Your clone (Pro)"];

type Phase = "style" | "mood";

export function CreateWorkspace() {
  const [phase, setPhase] = useState<Phase>("style");
  const [messages, setMessages] = useState<
    { role: "assistant" | "user"; text: string }[]
  >([
    {
      role: "assistant",
      text: "What style of meditation should we build? Pick one below or describe your own in the box.",
    },
  ]);
  const [input, setInput] = useState("");
  const [speakerModelId, setSpeakerModelId] = useState<string>(
    FISH_SPEAKERS[0].modelId,
  );

  function pickStyle(label: string) {
    const trimmed = label.trim();
    if (!trimmed) return;
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setPhase("mood");
    setInput("");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "How are you arriving today—and what do you want this meditation to hold space for?",
        },
      ]);
    }, 400);
  }

  function send() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (phase === "style") {
      pickStyle(trimmed);
      return;
    }
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setInput("");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: "Noted. Try a variation tomorrow to stay on your generation tier—we can remix length, voice, and intention while keeping your thread.",
        },
      ]);
    }, 500);
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
      <div className="mb-6 shrink-0">
        <h1 className="font-display text-3xl font-medium tracking-tight">
          Create a meditation
        </h1>
        <p className="mt-2 max-w-2xl text-muted">
          The guide starts with your meditation style, then mood and intention;
          panels on the right set audio, markers, and export options.
        </p>
      </div>

      {/* Height comes from layout: body h-dvh → main flex-1 → this grid fills space under the title. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] gap-8 lg:h-full lg:min-h-0 lg:grid-cols-5 lg:grid-rows-[minmax(0,1fr)] lg:gap-8">
        <section className="row-start-1 flex min-h-0 h-full min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:col-span-2 lg:row-start-1">
          <div className="shrink-0 border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Guide chat</h2>
            <p className="text-xs text-muted">
              Style first, then mood and day context
            </p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-4">
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
              {messages.map((msg, i) => (
                <div
                  key={`${msg.role}-${i}`}
                  className={`rounded-xl px-3 py-2 text-sm ${
                    msg.role === "assistant"
                      ? "bg-accent-soft/80 text-foreground"
                      : "ml-6 bg-border/40 text-foreground"
                  }`}
                >
                  {msg.text}
                </div>
              ))}
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
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={
                  phase === "style"
                    ? "Or type a style (e.g. Yoga nidra)…"
                    : "e.g. Nervous before a showcase—want calm confidence…"
                }
                className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/30 focus:ring-2"
              />
              <button
                type="button"
                onClick={send}
                className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white dark:text-deep"
              >
                Send
              </button>
            </div>
          </div>
        </section>

        <div className="row-start-2 flex min-h-0 flex-col gap-6 overflow-y-auto pb-12 lg:col-span-3 lg:row-start-1 lg:h-full lg:overflow-y-auto">
          <Panel title="Sound" subtitle="Bed and ambience">
            <select className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm">
              {soundPresets.map((s) => (
                <option key={s}>{s}</option>
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
              className="flex-1 rounded-full bg-accent py-3 text-sm font-semibold text-white dark:text-deep"
            >
              Generate meditation (mock)
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
