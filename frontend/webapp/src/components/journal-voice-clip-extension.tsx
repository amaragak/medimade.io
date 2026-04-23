"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeJournalAudio } from "@/lib/medimade-api";
import { useJournalTranscribeApiBase } from "@/components/journal-transcribe-api-context";

export type JournalVoiceClipAttrs = {
  src: string;
  mimeType: string;
  /** TipTap HTML paragraphs kept inside the same block as the recording. */
  transcriptHtml?: string | null;
};

function encodeTranscriptForAttr(html: string): string {
  return encodeURIComponent(html);
}

function decodeTranscriptFromAttr(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function formatAudioClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Library-style controls: hidden `<audio>` + play / skip / accent seek (compact for inline clips). */
function JournalClipAudioStrip({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    seekingRef.current = false;
    setCurrent(0);
    setDuration(0);
    setPlaying(false);
    el.pause();
    el.load();
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => {
      if (!seekingRef.current) setCurrent(el.currentTime);
    };
    const syncDuration = () => {
      const d = el.duration;
      if (Number.isFinite(d) && d > 0) setDuration(d);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);

    el.addEventListener("timeupdate", onTime);
    el.addEventListener("durationchange", syncDuration);
    el.addEventListener("loadedmetadata", syncDuration);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("durationchange", syncDuration);
      el.removeEventListener("loadedmetadata", syncDuration);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
    };
  }, [src]);

  const max = Math.max(duration, 0.0001);

  function skipSeconds(delta: number) {
    const el = audioRef.current;
    if (!el) return;
    const end =
      Number.isFinite(el.duration) && el.duration > 0
        ? el.duration
        : Number.isFinite(duration) && duration > 0
          ? duration
          : max;
    const next = Math.min(end, Math.max(0, el.currentTime + delta));
    el.currentTime = next;
    setCurrent(next);
  }

  function togglePlayback() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  return (
    <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
      <audio ref={audioRef} src={src} preload="metadata" className="hidden" />
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => skipSeconds(-10)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-accent/40"
          aria-label="Back 10 seconds"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden
          >
            <path d="M11 18V6l-8.5 6L11 18zm11 0V6l-8.5 6L22 18z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={togglePlayback}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 dark:text-deep"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => skipSeconds(10)}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-accent/40"
          aria-label="Forward 10 seconds"
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="currentColor"
            aria-hidden
          >
            <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z" />
          </svg>
        </button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="w-8 shrink-0 tabular-nums text-[10px] text-muted">
            {formatAudioClock(current)}
          </span>
          <input
            type="range"
            className="h-1 min-w-0 flex-1 cursor-pointer accent-accent"
            min={0}
            max={max}
            step={0.05}
            value={Math.min(current, max)}
            aria-label="Seek"
            onMouseDown={() => {
              seekingRef.current = true;
            }}
            onMouseUp={() => {
              seekingRef.current = false;
            }}
            onMouseLeave={() => {
              seekingRef.current = false;
            }}
            onTouchStart={() => {
              seekingRef.current = true;
            }}
            onTouchEnd={() => {
              seekingRef.current = false;
            }}
            onChange={(e) => {
              const el = audioRef.current;
              const v = Number(e.target.value);
              if (el) el.currentTime = v;
              setCurrent(v);
            }}
          />
          <span className="w-8 shrink-0 text-right tabular-nums text-[10px] text-muted">
            {formatAudioClock(duration)}
          </span>
        </div>
      </div>
    </div>
  );
}

function plainTextToTipTapHtml(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const escape = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  const blocks = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return blocks.map((b) => `<p>${escape(b).replace(/\n/g, "<br />")}</p>`).join("");
}

export function dataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf(",");
  if (i === -1) return dataUrl;
  return dataUrl.slice(i + 1);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === "string") resolve(r.result);
      else reject(new Error("Could not read recording"));
    };
    r.onerror = () => reject(r.error ?? new Error("Could not read recording"));
    r.readAsDataURL(blob);
  });
}

/**
 * Insert a voice clip block at the cursor. If the cursor is not at the start of the
 * current text block, split first so the clip appears on the following line/block.
 */
export function insertJournalVoiceClipAtCursor(
  editor: Editor,
  attrs: JournalVoiceClipAttrs,
): void {
  const { $from } = editor.state.selection;
  const atBlockStart = $from.parentOffset === 0;
  const chain = editor.chain().focus();
  if (!atBlockStart) {
    chain.splitBlock();
  }
  chain
    .insertContent({
      type: "journalVoiceClip",
      attrs: { src: attrs.src, mimeType: attrs.mimeType },
    })
    .run();
}

function JournalVoiceClipView(props: NodeViewProps) {
  const { node, deleteNode, updateAttributes } = props;
  const transcribeApiBase = useJournalTranscribeApiBase();
  const src = node.attrs.src as string;
  const mimeType = (node.attrs.mimeType as string) || "audio/webm";
  const transcriptHtml = (node.attrs.transcriptHtml as string | null) ?? null;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const transcribeSeqRef = useRef(0);

  useEffect(() => {
    if (!transcribeApiBase || transcriptHtml) return;
    const seq = (transcribeSeqRef.current += 1);
    let cancelled = false;

    const run = async () => {
      setBusy(true);
      setErr(null);
      try {
        const audioBase64 = dataUrlToBase64(src);
        const { text } = await transcribeJournalAudio({
          audioBase64,
          mimeType,
        });
        const html = plainTextToTipTapHtml(text);
        if (cancelled || seq !== transcribeSeqRef.current) return;
        if (!html) {
          setErr("No text returned from audio.");
          return;
        }
        updateAttributes({ transcriptHtml: html });
      } catch (e) {
        if (!cancelled && seq === transcribeSeqRef.current) {
          setErr(e instanceof Error ? e.message : "Transcription failed");
        }
      } finally {
        if (!cancelled && seq === transcribeSeqRef.current) {
          setBusy(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [mimeType, src, transcribeApiBase, transcriptHtml, updateAttributes, retryNonce]);

  const onRetryTranscription = useCallback(() => {
    setErr(null);
    setRetryNonce((n) => n + 1);
  }, []);

  return (
    <NodeViewWrapper
      className="journal-voice-clip journal-voice-clip-card not-prose relative my-2 overflow-hidden rounded-xl border border-accent/20 shadow-sm dark:border-accent/25"
      data-journal-voice-clip="1"
    >
      <div className="flex items-center justify-between gap-2 border-b border-accent/10 bg-gradient-to-r from-accent-soft/40 to-transparent px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white shadow-sm dark:text-deep"
            aria-hidden
          >
            <IconWaveform className="size-3.5" />
          </span>
          <span className="truncate font-display text-xs font-medium tracking-tight text-foreground">
            Voice note
          </span>
        </div>
        <button
          type="button"
          onClick={() => deleteNode()}
          className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-muted transition-colors hover:bg-accent-soft/50 hover:text-foreground"
        >
          Remove
        </button>
      </div>

      <div className="px-2 py-1">
        <JournalClipAudioStrip src={src} />
        {busy && !transcriptHtml ? (
          <p className="mt-0.5 text-[10px] text-muted">Getting text from audio…</p>
        ) : null}
        {!transcribeApiBase && !transcriptHtml ? (
          <p className="mt-0.5 text-[10px] leading-snug text-muted">
            Set the API URL for automatic transcription.
          </p>
        ) : null}
        {err ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">{err}</p>
            {transcribeApiBase ? (
              <button
                type="button"
                onClick={onRetryTranscription}
                className="text-[11px] font-semibold text-accent underline-offset-2 hover:underline"
              >
                Retry
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {transcriptHtml ? (
        <div className="border-t border-accent/12 bg-accent-soft/20 px-2 py-1 dark:bg-accent-soft/10">
          <div className="border-l-2 border-accent/45 pl-2">
            <div className="mb-0.5 flex items-center gap-1">
              <IconTranscriptBadge className="size-3 shrink-0 text-accent" />
              <span className="font-display text-[10px] font-medium uppercase tracking-wide text-muted">
                Transcription
              </span>
            </div>
            <div
              className="journal-voice-clip-transcript text-xs leading-snug text-foreground/95 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_br]:block"
              // eslint-disable-next-line react/no-danger -- HTML built from escaped Whisper text in plainTextToTipTapHtml
              dangerouslySetInnerHTML={{ __html: transcriptHtml }}
            />
          </div>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

function IconWaveform({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 10v3" />
      <path d="M6 6v11" />
      <path d="M10 3v18" />
      <path d="M14 8v8" />
      <path d="M18 5v14" />
      <path d="M22 10v3" />
    </svg>
  );
}

function IconTranscriptBadge({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M8 13h8" />
      <path d="M8 17h6" />
    </svg>
  );
}

export const JournalVoiceClip = Node.create({
  name: "journalVoiceClip",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      mimeType: { default: "audio/webm" },
      transcriptHtml: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-journal-voice-clip="1"]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const src =
            element.getAttribute("data-src") ||
            element.querySelector("audio")?.getAttribute("src");
          if (!src) return false;
          const mime =
            element.getAttribute("data-mime") ||
            element.querySelector("audio")?.getAttribute("type") ||
            "audio/webm";
          const rawTranscript = element.getAttribute("data-transcript");
          const transcriptHtml = decodeTranscriptFromAttr(rawTranscript);
          return { src, mimeType: mime, transcriptHtml };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const src = node.attrs.src as string | null;
    const mimeType = (node.attrs.mimeType as string) || "audio/webm";
    const transcriptHtml = (node.attrs.transcriptHtml as string | null) ?? null;
    const transcriptAttr =
      transcriptHtml && transcriptHtml.trim()
        ? encodeTranscriptForAttr(transcriptHtml)
        : null;
    if (!src) {
      return [
        "div",
        mergeAttributes(
          { "data-journal-voice-clip": "1", class: "journal-voice-clip" },
          HTMLAttributes,
        ),
      ];
    }
    return [
      "div",
      mergeAttributes(
        {
          "data-journal-voice-clip": "1",
          "data-src": src,
          "data-mime": mimeType,
          ...(transcriptAttr ? { "data-transcript": transcriptAttr } : {}),
          class:
            "journal-voice-clip journal-voice-clip-card my-2 overflow-hidden rounded-xl border border-accent/20 not-prose shadow-sm",
        },
        HTMLAttributes,
      ),
      ["audio", { controls: "true", preload: "metadata", src, type: mimeType }],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(JournalVoiceClipView);
  },
});
