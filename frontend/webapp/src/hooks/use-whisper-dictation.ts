"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeJournalAudio } from "@/lib/medimade-api";

function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = typeof r.result === "string" ? r.result : "";
      const i = s.indexOf(",");
      resolve(i === -1 ? s : s.slice(i + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("Could not read recording"));
    r.readAsDataURL(blob);
  });
}

export function appendSpokenText(existing: string, spoken: string): string {
  const piece = spoken.trim();
  if (!piece) return existing;
  if (!existing) return piece;
  if (/\s$/.test(existing)) return `${existing}${piece}`;
  return `${existing} ${piece}`;
}

export function useWhisperDictation() {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const collectBlob = useCallback(async (): Promise<Blob | null> => {
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") {
      releaseStream();
      return null;
    }
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    recRef.current = null;
    releaseStream();
    const parts = chunksRef.current;
    chunksRef.current = [];
    if (!parts.length) return null;
    return new Blob(parts, { type: (parts[0] as Blob).type || "audio/webm" });
  }, [releaseStream]);

  useEffect(() => {
    return () => {
      if (recRef.current?.state === "recording") recRef.current.stop();
      recRef.current = null;
      chunksRef.current = [];
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (busy) return;
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickRecorderMime();
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.start(200);
      setRecording(true);
    } catch (e) {
      releaseStream();
      setError(e instanceof Error ? e.message : "Could not access microphone");
    }
  }, [busy, releaseStream]);

  const cancel = useCallback(async () => {
    setRecording(false);
    setError(null);
    await collectBlob();
  }, [collectBlob]);

  const stopAndTranscribe = useCallback(async (): Promise<string | null> => {
    if (busy) return null;
    setError(null);
    setBusy(true);
    setRecording(false);
    try {
      const blob = await collectBlob();
      if (!blob) {
        setError("No audio captured.");
        return null;
      }
      if (blob.size < 256) {
        setError("Recording too short.");
        return null;
      }
      const audioBase64 = await blobToBase64(blob);
      const { text } = await transcribeJournalAudio({
        audioBase64,
        mimeType: blob.type || "audio/webm",
      });
      const spoken = text.trim();
      if (!spoken) {
        setError("No speech detected.");
        return null;
      }
      return spoken;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transcription failed");
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, collectBlob]);

  return { recording, busy, error, start, cancel, stopAndTranscribe };
}
