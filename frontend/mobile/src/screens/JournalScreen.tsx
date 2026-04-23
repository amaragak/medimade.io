import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import {
  createNewJournalEntry,
  loadJournalStoreAsync,
  saveJournalStoreAsync,
  stripHtmlToText,
  type JournalEntry,
  type JournalStoreV2,
} from "../lib/journal-async-storage";
import { getMedimadeApiBase, transcribeJournalAudio } from "../lib/medimade-api";
import { colors } from "../theme/colors";

function htmlToPlain(html: string): string {
  return stripHtmlToText(html).replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function plainToHtml(plain: string): string {
  const paras = plain.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return "<p></p>";
  return paras
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export default function JournalScreen() {
  const insets = useSafeAreaInsets();
  const apiBase = getMedimadeApiBase();
  const [hydrated, setHydrated] = useState(false);
  const [store, setStore] = useState<JournalStoreV2 | null>(null);
  const [title, setTitle] = useState("");
  const [bodyPlain, setBodyPlain] = useState("");
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const activeEntry = useMemo(() => {
    if (!store?.activeEntryId) return null;
    return store.entries.find((e) => e.id === store.activeEntryId) ?? null;
  }, [store]);

  const reload = useCallback(async () => {
    const s = await loadJournalStoreAsync();
    setStore(s);
    const a = s.entries.find((e) => e.id === s.activeEntryId);
    if (a) {
      setTitle(a.title);
      setBodyPlain(htmlToPlain(a.contentHtml));
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const persist = useCallback(
    async (next: JournalStoreV2) => {
      setStore(next);
      await saveJournalStoreAsync(next);
    },
    [],
  );

  const flushActive = useCallback(async () => {
    if (!store?.activeEntryId) return;
    const id = store.activeEntryId;
    const html = plainToHtml(bodyPlain);
    const now = new Date().toISOString();
    const next: JournalStoreV2 = {
      ...store,
      entries: store.entries.map((e) =>
        e.id === id
          ? {
              ...e,
              title,
              contentHtml: html,
              updatedAt: now,
            }
          : e,
      ),
    };
    await persist(next);
  }, [store, title, bodyPlain, persist]);

  const selectEntry = useCallback(
    async (id: string) => {
      await flushActive();
      const s = await loadJournalStoreAsync();
      const next = { ...s, activeEntryId: id };
      const e = next.entries.find((x) => x.id === id);
      if (e) {
        setTitle(e.title);
        setBodyPlain(htmlToPlain(e.contentHtml));
      }
      await persist(next);
    },
    [flushActive, persist],
  );

  const newEntry = useCallback(async () => {
    await flushActive();
    const s = await loadJournalStoreAsync();
    const e = createNewJournalEntry();
    const next: JournalStoreV2 = {
      version: 2,
      activeEntryId: e.id,
      entries: [e, ...s.entries],
    };
    setTitle("");
    setBodyPlain("");
    await persist(next);
  }, [flushActive, persist]);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    if (!apiBase) {
      setVoiceError("Set EXPO_PUBLIC_MEDIMADE_API_URL for transcription.");
      return;
    }
    try {
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== "granted") {
        setVoiceError("Microphone permission denied.");
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      setRecording(recording);
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "Could not start recording");
    }
  }, [apiBase]);

  const stopAndTranscribe = useCallback(async () => {
    if (!recording || !apiBase) return;
    setVoiceBusy(true);
    setVoiceError(null);
    try {
      await recording.stopAndUnloadAsync();
      setRecording(null);
      const uri = recording.getURI();
      if (!uri) {
        setVoiceError("No recording file.");
        return;
      }
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const uriLower = uri.toLowerCase();
      const mime =
        uriLower.endsWith(".m4a") || uriLower.endsWith(".caf")
          ? "audio/m4a"
          : uriLower.endsWith(".webm")
            ? "audio/webm"
            : uriLower.endsWith(".mp4")
              ? "audio/mp4"
              : Platform.OS === "ios"
                ? "audio/m4a"
                : "audio/webm";
      const { text } = await transcribeJournalAudio({
        audioBase64: base64,
        mimeType: mime,
      });
      setBodyPlain((b) => (b.trim() ? `${b.trim()}\n\n${text}` : text));
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : "Transcription failed");
    } finally {
      setVoiceBusy(false);
    }
  }, [recording, apiBase]);

  if (!hydrated || !store) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <Text style={styles.h1}>Journal</Text>
        <Pressable onPress={() => void newEntry()} style={styles.newBtn}>
          <Text style={styles.newBtnText}>+ New</Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsInner}
      >
        {store.entries.map((e: JournalEntry) => {
          const active = e.id === store.activeEntryId;
          return (
            <Pressable
              key={e.id}
              onPress={() => void selectEntry(e.id)}
              style={[styles.tab, active && styles.tabActive]}
            >
              <Text
                numberOfLines={1}
                style={[styles.tabText, active && styles.tabTextActive]}
              >
                {(e.title || "Untitled").trim() || "Untitled"}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={() => void flushActive()}
          placeholder="Journal entry title"
          placeholderTextColor={colors.muted}
          style={styles.titleInput}
        />
        <View style={styles.bodyRow}>
          <Text style={styles.label}>Entry</Text>
          <View style={styles.micWrap}>
            {!recording ? (
              <Pressable
                onPress={() => void startRecording()}
                disabled={voiceBusy}
                style={({ pressed }) => [
                  styles.micBtn,
                  pressed && styles.micBtnPressed,
                  voiceBusy && styles.micBtnDisabled,
                ]}
              >
                <Ionicons
                  name="mic"
                  size={22}
                  color={voiceBusy ? colors.muted : colors.accent}
                />
              </Pressable>
            ) : (
              <Pressable
                onPress={() => void stopAndTranscribe()}
                disabled={voiceBusy}
                style={({ pressed }) => [
                  styles.micBtn,
                  styles.micStop,
                  pressed && styles.micBtnPressed,
                ]}
              >
                <Ionicons name="stop" size={22} color="#fffaf6" />
              </Pressable>
            )}
          </View>
        </View>
        {voiceBusy ? (
          <ActivityIndicator style={{ marginBottom: 8 }} color={colors.accent} />
        ) : null}
        {voiceError ? <Text style={styles.err}>{voiceError}</Text> : null}
        <TextInput
          value={bodyPlain}
          onChangeText={setBodyPlain}
          onBlur={() => void flushActive()}
          placeholder="Write here… Use the mic to dictate (Whisper)."
          placeholderTextColor={colors.muted}
          multiline
          textAlignVertical="top"
          style={styles.bodyInput}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  h1: {
    fontSize: 26,
    fontFamily: Platform.select({ ios: "Georgia", android: "serif" }),
    fontWeight: "600",
    color: colors.foreground,
  },
  newBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  newBtnText: { color: "#fffaf6", fontWeight: "700", fontSize: 14 },
  tabs: { maxHeight: 44, marginBottom: 8 },
  tabsInner: { paddingHorizontal: 12, gap: 8, flexDirection: "row" },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    maxWidth: 160,
  },
  tabActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  tabText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: colors.foreground },
  form: { flex: 1, paddingHorizontal: 16 },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.muted,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  titleInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    color: colors.foreground,
    backgroundColor: colors.card,
    marginBottom: 16,
  },
  bodyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  micWrap: { flexDirection: "row", alignItems: "center" },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.card,
  },
  micBtnPressed: { opacity: 0.85 },
  micBtnDisabled: { opacity: 0.45 },
  micStop: { backgroundColor: colors.accent, borderColor: colors.accent },
  bodyInput: {
    minHeight: 280,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    color: colors.foreground,
    backgroundColor: colors.card,
    marginBottom: 32,
  },
  err: { color: "#b91c1c", marginBottom: 8, fontSize: 13 },
});
