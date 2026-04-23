"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatJournalEntryDate } from "@/lib/journal-storage";
import {
  JournalVoiceClip,
  blobToDataUrl,
  insertJournalVoiceClipAtCursor,
} from "@/components/journal-voice-clip-extension";
import { JournalTranscribeApiContext } from "@/components/journal-transcribe-api-context";

const editorClass =
  "min-h-[min(52vh,24rem)] w-full px-4 py-3 text-sm leading-relaxed text-foreground focus:outline-none " +
  "[&_.ProseMirror]:min-h-[min(52vh,24rem)] [&_p]:my-2 [&_p.is-editor-empty:first-child::before]:text-muted/60 " +
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-medium [&_h2]:tracking-tight " +
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-medium " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic";

type Props = {
  entryId: string;
  initialHtml: string;
  initialTitle: string;
  createdAt: string;
  /** When set, shows a mic that records into the journal and enables clip transcription. */
  transcribeApiBase: string | null;
  titlePlaceholder?: string;
  placeholder?: string;
  onHtmlChange: (html: string) => void;
  onTitleChange: (title: string) => void;
};

export function JournalRichEditor({
  entryId,
  initialHtml,
  initialTitle,
  createdAt,
  transcribeApiBase,
  titlePlaceholder = "Journal Entry Title",
  placeholder = "Write freely…",
  onHtmlChange,
  onTitleChange,
}: Props) {
  const titleSeededForEntryRef = useRef<string | null>(null);
  const editorSeededForEntryRef = useRef<string | null>(null);
  const [entryTitle, setEntryTitle] = useState(initialTitle);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const stopMediaRecorderAndCollectBlob = useCallback(async (): Promise<Blob | null> => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") {
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
      return null;
    }
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    const parts = mediaChunksRef.current;
    mediaChunksRef.current = [];
    if (!parts.length) return null;
    return new Blob(parts, { type: (parts[0] as Blob).type || "audio/webm" });
  }, []);

  const startVoiceRecording = useCallback(async () => {
    setVoiceError(null);
    if (!transcribeApiBase || voiceBusy) return;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setVoiceError("Recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) mediaChunksRef.current.push(ev.data);
      };
      rec.start(200);
      setVoiceRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not access microphone";
      setVoiceError(msg);
    }
  }, [transcribeApiBase, voiceBusy]);

  const finishRecordingIntoEditor = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed || voiceBusy) return;
    setVoiceError(null);
    setVoiceBusy(true);
    setVoiceRecording(false);
    try {
      const blob = await stopMediaRecorderAndCollectBlob();
      if (!blob) {
        setVoiceError("No audio captured.");
        return;
      }
      if (blob.size < 256) {
        setVoiceError("Recording too short.");
        return;
      }
      const dataUrl = await blobToDataUrl(blob);
      insertJournalVoiceClipAtCursor(ed, {
        src: dataUrl,
        mimeType: blob.type || "audio/webm",
      });
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "Could not save recording");
    } finally {
      setVoiceBusy(false);
    }
  }, [stopMediaRecorderAndCollectBlob, voiceBusy]);

  const cancelVoiceRecording = useCallback(async () => {
    setVoiceRecording(false);
    await stopMediaRecorderAndCollectBlob();
    setVoiceError(null);
  }, [stopMediaRecorderAndCollectBlob]);

  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      JournalVoiceClip,
    ],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: editorClass,
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: ed }) => {
      editorRef.current = ed;
      onHtmlChange(ed.getHTML());
    },
    onCreate: ({ editor: ed }) => {
      editorRef.current = ed;
    },
  });

  useEffect(() => {
    if (titleSeededForEntryRef.current === entryId) return;
    titleSeededForEntryRef.current = entryId;
    setEntryTitle(initialTitle);
  }, [entryId, initialTitle]);

  useEffect(() => {
    if (!editor) return;
    if (editorSeededForEntryRef.current === entryId) return;
    editorSeededForEntryRef.current = entryId;
    editor.commands.setContent(initialHtml, { emitUpdate: false });
  }, [entryId, initialHtml, editor]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  useEffect(() => {
    return () => {
      void cancelVoiceRecording();
    };
  }, [entryId, cancelVoiceRecording]);

  if (!editor) {
    return (
      <div className="min-h-[min(52vh,24rem)] animate-pulse rounded-2xl border border-border bg-card shadow-sm" />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
          <label className="min-w-0 flex-1 sm:max-w-[min(100%,20rem)] lg:max-w-md">
            <span className="sr-only">{titlePlaceholder}</span>
            <input
              type="text"
              value={entryTitle}
              onChange={(ev) => {
                const v = ev.target.value;
                setEntryTitle(v);
                onTitleChange(v);
              }}
              placeholder={titlePlaceholder}
              autoComplete="off"
              className="w-full min-w-0 border-0 bg-transparent px-0 py-0.5 text-base font-semibold tracking-tight text-foreground outline-none ring-0 placeholder:text-muted/70"
            />
          </label>
          <div className="flex flex-wrap items-center gap-1 sm:justify-end">
            {transcribeApiBase ? (
              <>
                <ToolbarBtn
                  label={voiceRecording ? "Recording…" : "Record voice"}
                  active={voiceRecording}
                  disabled={voiceBusy}
                  onClick={async () => {
                    if (voiceBusy) return;
                    if (voiceRecording) return;
                    await startVoiceRecording();
                  }}
                >
                  <IconMic />
                </ToolbarBtn>
                <ToolbarBtn
                  label="Stop and place clip"
                  disabled={!voiceRecording || voiceBusy}
                  onClick={() => void finishRecordingIntoEditor()}
                >
                  Stop
                </ToolbarBtn>
                <ToolbarBtn
                  label="Cancel recording"
                  disabled={!voiceRecording || voiceBusy}
                  onClick={() => void cancelVoiceRecording()}
                >
                  Cancel
                </ToolbarBtn>
                <span className="mx-1 h-6 w-px bg-border" aria-hidden />
              </>
            ) : null}
            <ToolbarBtn
              label="Bold"
              active={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <span className="font-bold">B</span>
            </ToolbarBtn>
            <ToolbarBtn
              label="Italic"
              active={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <span className="italic">I</span>
            </ToolbarBtn>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolbarBtn
              label="Heading"
              active={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              H2
            </ToolbarBtn>
            <ToolbarBtn
              label="Subheading"
              active={editor.isActive("heading", { level: 3 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
            >
              H3
            </ToolbarBtn>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolbarBtn
              label="Bullet list"
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              • List
            </ToolbarBtn>
            <ToolbarBtn
              label="Numbered list"
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              1. List
            </ToolbarBtn>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolbarBtn
              label="Undo"
              onClick={() => editor.chain().focus().undo().run()}
            >
              Undo
            </ToolbarBtn>
            <ToolbarBtn
              label="Redo"
              onClick={() => editor.chain().focus().redo().run()}
            >
              Redo
            </ToolbarBtn>
          </div>
        </div>
        <div className="border-t border-border pt-2 text-xs text-muted">
          Created{" "}
          <time className="text-foreground/90" dateTime={createdAt}>
            {formatJournalEntryDate(createdAt)}
          </time>
          {voiceRecording ? (
            <span className="mt-1 block font-medium text-accent">
              Recording… place the cursor where you want the clip, then Stop.
            </span>
          ) : null}
          {voiceError ? (
            <span className="mt-1 block text-red-600 dark:text-red-400">
              {voiceError}
            </span>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <JournalTranscribeApiContext.Provider value={transcribeApiBase}>
          <EditorContent editor={editor} />
        </JournalTranscribeApiContext.Provider>
      </div>
    </div>
  );
}

function IconMic({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="16"
      height="16"
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

function ToolbarBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active ?? false}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : active
            ? "bg-accent text-white dark:text-deep"
            : "text-muted hover:bg-accent-soft/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
