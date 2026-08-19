"use client";

import { getMedimadeApiBase } from "@/lib/medimade-api";
import {
  appendSpokenText,
  useWhisperDictation,
} from "@/hooks/use-whisper-dictation";

export { appendSpokenText };

function IconMic({ className }: { className?: string }) {
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
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function IconStop({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="currentColor"
      aria-hidden
    >
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

type Props = {
  disabled?: boolean;
  onTranscript: (text: string) => void;
  /** `composer` matches the chat send button; `inset` sits on a textarea. */
  variant?: "composer" | "inset";
};

export function DictationMicButton({
  disabled = false,
  onTranscript,
  variant = "composer",
}: Props) {
  const apiReady = Boolean(getMedimadeApiBase());
  const { recording, busy, error, start, cancel, stopAndTranscribe } =
    useWhisperDictation();

  if (!apiReady) return null;

  const size =
    variant === "inset" ? "h-9 w-9" : "h-11 w-11";

  const onMicClick = async () => {
    if (disabled || busy) return;
    if (recording) {
      const text = await stopAndTranscribe();
      if (text) onTranscript(text);
      return;
    }
    await start();
  };

  return (
    <div className="relative flex shrink-0 items-center gap-1">
      {recording ? (
        <button
          type="button"
          onClick={() => void cancel()}
          aria-label="Cancel dictation"
          title="Cancel"
          className={`${size} flex cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-muted shadow-sm transition-colors hover:bg-accent-soft/40 hover:text-foreground`}
        >
          <span className="text-lg leading-none" aria-hidden>
            ×
          </span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void onMicClick()}
        disabled={disabled || busy}
        aria-label={
          busy
            ? "Transcribing…"
            : recording
              ? "Stop dictation"
              : "Dictate with microphone"
        }
        aria-pressed={recording}
        title={
          busy
            ? "Transcribing…"
            : recording
              ? "Stop and transcribe"
              : "Dictate"
        }
        className={`${size} flex cursor-pointer items-center justify-center rounded-full bg-accent text-on-accent shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${
          recording ? "animate-pulse" : ""
        }`}
      >
        {busy ? (
          <span className="text-sm font-medium" aria-hidden>
            …
          </span>
        ) : recording ? (
          <IconStop />
        ) : (
          <IconMic />
        )}
      </button>
      {error ? (
        <p
          className="absolute top-full right-0 z-10 mt-1 max-w-[14rem] text-right text-xs text-danger"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
