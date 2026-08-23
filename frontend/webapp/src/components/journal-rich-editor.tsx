"use client";

import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Image as ImageIcon, List, ListOrdered, Redo2, Undo2 } from "lucide-react";
import { formatJournalEntryDate } from "@/lib/journal-storage";
import {
  JournalVoiceClip,
  blobToDataUrl,
  insertJournalVoiceClipAtCursor,
} from "@/components/journal-voice-clip-extension";
import {
  JournalImage,
  compressImageFileToJpegDataUrl,
} from "@/components/journal-image-extension";
import { JournalTranscribeApiContext } from "@/components/journal-transcribe-api-context";

const editorClass =
  "min-h-[8rem] w-full px-4 py-3 text-base leading-relaxed text-foreground focus:outline-none " +
  "[&_.ProseMirror]:min-h-[8rem] [&_p]:my-2 [&_p.is-editor-empty:first-child::before]:text-muted/60 " +
  "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-medium [&_h2]:tracking-tight " +
  "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-display [&_h3]:text-base [&_h3]:font-medium " +
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:my-0.5 [&_strong]:font-semibold [&_em]:italic " +
  "[&_img]:my-3 [&_img]:max-h-[28rem] [&_img]:max-w-full [&_img]:rounded-lg";

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
  onDelete?: () => void;
  /** Extra classes for the overflow menu (e.g. hide on mobile when chrome is external). */
  entryMenuClassName?: string;
  /** Footer inside the card, below a divider (e.g. mood). */
  children?: ReactNode;
};

export function JournalRichEditor({
  entryId,
  initialHtml,
  initialTitle,
  createdAt,
  transcribeApiBase,
  titlePlaceholder = "Title",
  placeholder = "Write freely…",
  onHtmlChange,
  onTitleChange,
  onDelete,
  entryMenuClassName,
  children,
}: Props) {
  const titleSeededForEntryRef = useRef<string | null>(null);
  const editorSeededForEntryRef = useRef<string | null>(null);
  const [entryTitle, setEntryTitle] = useState(initialTitle);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toolbarMoreOpen, setToolbarMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<BlobPart[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

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
      JournalImage,
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

  useEffect(() => {
    setMenuOpen(false);
    setToolbarMoreOpen(false);
  }, [entryId]);

  useEffect(() => {
    if (!voiceRecording) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") void cancelVoiceRecording();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [voiceRecording, cancelVoiceRecording]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  if (!editor) {
    return (
      <div className="min-h-[12rem] flex-1 animate-pulse rounded-2xl border border-border bg-card shadow-sm" />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex shrink-0 flex-col border-b border-border">
        <div className="flex items-start gap-2 px-4 pb-2 pt-3">
          <div className="min-w-0 flex-1">
            <time
              className="mb-1 block text-xs text-muted"
              dateTime={createdAt}
            >
              Created {formatJournalEntryDate(createdAt)}
            </time>
            <label className="block">
              <span className="sr-only">Title</span>
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
                className="w-full border-0 bg-transparent px-0 py-0.5 font-display text-2xl font-medium tracking-tight text-foreground outline-none ring-0 placeholder:text-muted/45"
              />
            </label>
          </div>
          {onDelete ? (
            <div
              ref={menuRef}
              className={`relative flex shrink-0 items-center gap-2 self-end ${entryMenuClassName ?? ""}`}
            >
              <span className="h-6 w-px bg-border" aria-hidden />
              <button
                type="button"
                aria-label="Entry actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-accent-soft/50 hover:text-foreground"
              >
                <IconMore />
              </button>
              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-20 mt-1 min-w-[9rem] rounded-xl border border-border bg-card py-1 shadow-lg"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="block w-full cursor-pointer px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft/40"
                  >
                    Delete entry
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {/* sm+: full toolbar (unchanged wrapping behavior) */}
        <div className="hidden flex-wrap items-center gap-1 border-t border-border px-3 py-2 sm:flex">
            {transcribeApiBase ? (
              <>
                <button
                  type="button"
                  title={
                    voiceRecording
                      ? "Stop and place clip"
                      : "Record voice"
                  }
                  aria-label={
                    voiceRecording
                      ? "Stop and place clip"
                      : "Record voice"
                  }
                  aria-pressed={voiceRecording}
                  disabled={voiceBusy}
                  onClick={() => {
                    if (voiceBusy) return;
                    if (voiceRecording) {
                      void finishRecordingIntoEditor();
                      return;
                    }
                    void startVoiceRecording();
                  }}
                  className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${
                    voiceRecording ? "animate-pulse" : ""
                  }`}
                >
                  <IconMic />
                </button>
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
            <label className="sr-only" htmlFor="journal-text-style">
              Text style
            </label>
            <select
              id="journal-text-style"
              aria-label="Text style"
              value={
                editor.isActive("heading", { level: 2 })
                  ? "header"
                  : editor.isActive("heading", { level: 3 })
                    ? "subheader"
                    : "body"
              }
              onChange={(e) => {
                const v = e.target.value;
                const chain = editor.chain().focus();
                if (v === "header") {
                  chain.setHeading({ level: 2 }).run();
                  return;
                }
                if (v === "subheader") {
                  chain.setHeading({ level: 3 }).run();
                  return;
                }
                chain.setParagraph().run();
              }}
              className="cursor-pointer rounded-lg border border-border bg-transparent py-1.5 pl-2 pr-6 text-xs font-semibold text-muted outline-none hover:bg-accent-soft/50 hover:text-foreground"
            >
              <option value="body">Body</option>
              <option value="header">Header</option>
              <option value="subheader">Subheader</option>
            </select>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolbarBtn
              label="Bullet list"
              active={editor.isActive("bulletList")}
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              <List aria-hidden className="size-4" strokeWidth={2} />
            </ToolbarBtn>
            <ToolbarBtn
              label="Numbered list"
              active={editor.isActive("orderedList")}
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              <ListOrdered aria-hidden className="size-4" strokeWidth={2} />
            </ToolbarBtn>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolbarBtn
              label="Photo"
              onClick={() => photoInputRef.current?.click()}
            >
              <ImageIcon aria-hidden className="size-4" strokeWidth={2} />
            </ToolbarBtn>
            <span className="mx-1 h-6 w-px bg-border" aria-hidden />
            <ToolbarBtn
              label="Undo"
              onClick={() => editor.chain().focus().undo().run()}
            >
              <Undo2 aria-hidden className="size-4" strokeWidth={2} />
            </ToolbarBtn>
            <ToolbarBtn
              label="Redo"
              onClick={() => editor.chain().focus().redo().run()}
            >
              <Redo2 aria-hidden className="size-4" strokeWidth={2} />
            </ToolbarBtn>
        </div>
        {/* Mobile: primary tools + expandable more row */}
        <div className="border-t border-border sm:hidden">
          <div className="flex flex-nowrap items-center gap-1 overflow-x-auto px-3 py-2">
            {transcribeApiBase ? (
              <>
                <button
                  type="button"
                  title={
                    voiceRecording
                      ? "Stop and place clip"
                      : "Record voice"
                  }
                  aria-label={
                    voiceRecording
                      ? "Stop and place clip"
                      : "Record voice"
                  }
                  aria-pressed={voiceRecording}
                  disabled={voiceBusy}
                  onClick={() => {
                    if (voiceBusy) return;
                    if (voiceRecording) {
                      void finishRecordingIntoEditor();
                      return;
                    }
                    void startVoiceRecording();
                  }}
                  className={`flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full accent-fill-gradient text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${
                    voiceRecording ? "animate-pulse" : ""
                  }`}
                >
                  <IconMic />
                </button>
                <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
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
            <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
            <ToolbarBtn
              label="More formatting"
              active={toolbarMoreOpen}
              onClick={() => setToolbarMoreOpen((v) => !v)}
            >
              <IconDotsHorizontal />
            </ToolbarBtn>
          </div>
          {toolbarMoreOpen ? (
            <div className="flex flex-nowrap items-center gap-1 overflow-x-auto border-t border-border px-3 py-2">
              <ToolbarBtn
                label="Heading 2"
                active={editor.isActive("heading", { level: 2 })}
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 2 }).run()
                }
              >
                <span className="font-semibold">H2</span>
              </ToolbarBtn>
              <ToolbarBtn
                label="Heading 3"
                active={editor.isActive("heading", { level: 3 })}
                onClick={() =>
                  editor.chain().focus().toggleHeading({ level: 3 }).run()
                }
              >
                <span className="font-semibold">H3</span>
              </ToolbarBtn>
              <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
              <ToolbarBtn
                label="Bullet list"
                active={editor.isActive("bulletList")}
                onClick={() => editor.chain().focus().toggleBulletList().run()}
              >
                <List aria-hidden className="size-4" strokeWidth={2} />
              </ToolbarBtn>
              <ToolbarBtn
                label="Numbered list"
                active={editor.isActive("orderedList")}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}
              >
                <ListOrdered aria-hidden className="size-4" strokeWidth={2} />
              </ToolbarBtn>
              <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
              <ToolbarBtn
                label="Photo"
                onClick={() => photoInputRef.current?.click()}
              >
                <ImageIcon aria-hidden className="size-4" strokeWidth={2} />
              </ToolbarBtn>
              <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
              <ToolbarBtn
                label="Undo"
                onClick={() => editor.chain().focus().undo().run()}
              >
                <Undo2 aria-hidden className="size-4" strokeWidth={2} />
              </ToolbarBtn>
              <ToolbarBtn
                label="Redo"
                onClick={() => editor.chain().focus().redo().run()}
              >
                <Redo2 aria-hidden className="size-4" strokeWidth={2} />
              </ToolbarBtn>
            </div>
          ) : null}
        </div>
        {voiceRecording || voiceError ? (
          <div className="border-t border-border px-4 py-2 text-xs">
            {voiceRecording ? (
              <span className="font-medium text-accent-link">
                Recording… tap the mic again to place the clip.
              </span>
            ) : null}
            {voiceError ? (
              <span className="text-danger">{voiceError}</span>
            ) : null}
          </div>
        ) : null}
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(ev) => {
            const file = ev.target.files?.[0];
            ev.target.value = "";
            if (!file) return;
            void compressImageFileToJpegDataUrl(file)
              .then((src) => {
                editor.chain().focus().setJournalImage({ src, alt: "" }).run();
              })
              .catch((e) => {
                setVoiceError(
                  e instanceof Error ? e.message : "Could not add that photo",
                );
              });
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <JournalTranscribeApiContext.Provider value={transcribeApiBase}>
          <EditorContent editor={editor} />
        </JournalTranscribeApiContext.Provider>
      </div>
      {children ? (
        <div className="shrink-0 border-t border-border px-4 py-3">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function IconMore({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

function IconDotsHorizontal({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="12" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="19" cy="12" r="1.75" />
    </svg>
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
      className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        disabled
          ? "cursor-not-allowed opacity-50"
          : active
            ? "cursor-pointer bg-selected text-on-selected"
            : "cursor-pointer text-muted hover:bg-accent-soft/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
