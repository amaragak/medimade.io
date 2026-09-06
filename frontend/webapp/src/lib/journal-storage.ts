import { isJournalMoodId } from "@/lib/journal-moods";

export type JournalEntryKind = "freeform" | "gratitude";

export type JournalGratitudeLines = [string, string, string];

export type JournalEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  contentHtml: string;
  /** Omitted on existing freeform entries. */
  kind?: JournalEntryKind;
  /** Three daily lines when `kind` is `gratitude`. */
  gratitude?: JournalGratitudeLines;
  /** Write-time mood chip (`calm` | `good` | `mixed` | `low` | `heavy`). */
  mood?: string;
  tags?: string[];
  /** Skip this entry on cloud PUT; kept on this device. */
  localOnly?: boolean;
  /** Set when this row came from the import pipeline. */
  importSource?:
    | "day_one"
    | "markdown"
    | "csv"
    | "plaintext"
    | "pdf_annotations"
    | "handwritten_photo";
  importBatchId?: string;
  sourceMetadata?: Record<string, unknown>;
  mediaRefs?: string[];
  /** Notebook this page lives in. Omitted = unfiled. */
  folderId?: string;
};

export type JournalFolder = {
  id: string;
  name: string;
};

export type JournalStoreV2 = {
  version: 2;
  activeEntryId: string | null;
  entries: JournalEntry[];
  folders?: JournalFolder[];
};

const LEGACY_PLAIN_KEY = "mm_journal_entries_v1";
const STORE_KEY = "mm_journal_store_v2";
/** Bump when demo copy changes so guests get a one-time reseed of missing demos. */
const DEMO_SEED_FLAG_KEY = "mm_journal_demo_seed_v1";

const DEMO_ENTRY_IDS = [
  "demo-journal-blank",
  "demo-journal-morning",
  "demo-journal-resistance",
  "demo-journal-gratitude",
] as const;

/** Stable id for `GET/PUT /journal/store` and `POST /journal/voice` (treat as a device secret). */
export const JOURNAL_OWNER_ID_KEY = "mm_journal_owner_id";

export function getOrCreateJournalOwnerId(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    let id = window.localStorage.getItem(JOURNAL_OWNER_ID_KEY)?.trim();
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `o_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      window.localStorage.setItem(JOURNAL_OWNER_ID_KEY, id);
    }
    return id;
  } catch {
    return `ephemeral_${Date.now()}`;
  }
}

/** Fixed en-US medium date only (no time), for journal entry display. */
export function formatJournalEntryDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-US", { dateStyle: "medium" });
  } catch {
    return "—";
  }
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|br)\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeVoiceClipTranscriptAttr(raw: string | null): string | null {
  if (!raw?.trim()) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Appends plain-text markers for voice-clip transcripts stored in `data-transcript`. */
function expandVoiceClipTranscriptsForPlainText(html: string): string {
  if (typeof document === "undefined") {
    return html;
  }
  try {
    const wrap = document.createElement("div");
    wrap.innerHTML = html;
    wrap.querySelectorAll('[data-journal-voice-clip="1"]').forEach((el) => {
      const raw = el.getAttribute("data-transcript");
      const dec = decodeVoiceClipTranscriptAttr(raw);
      if (!dec?.trim()) return;
      const spoken = stripHtmlToText(dec).trim();
      if (!spoken) return;
      const note = document.createElement("p");
      note.textContent = `Voice transcription: ${spoken}`;
      el.appendChild(note);
    });
    return wrap.innerHTML;
  } catch {
    return html;
  }
}

export function deriveEntryTitle(html: string): string {
  const t = stripHtmlToText(html);
  if (!t) return "Untitled entry";
  return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}

/** sessionStorage key: handoff from Journal → Create (meditation from entries). */
export const JOURNAL_MEDITATION_PAYLOAD_KEY = "mm_journal_meditation_payload_v1";

/** Max plain-text length per entry in the Journal → Create payload (very large; avoids runaway storage). */
const JOURNAL_BODY_PLAIN_MAX = 500_000;

export type JournalMeditationPayloadV1 = {
  v: 1;
  at: string;
  segments: {
    entryId: string;
    title: string;
    bodyPlain: string;
    /** ISO date string for display on Create */
    createdAt?: string;
  }[];
};

export function parseJournalMeditationPayload(
  raw: string | null,
): JournalMeditationPayloadV1 | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const x = JSON.parse(raw) as unknown;
    if (!x || typeof x !== "object") return null;
    const o = x as Record<string, unknown>;
    if (o.v !== 1) return null;
    if (typeof o.at !== "string") return null;
    if (!Array.isArray(o.segments)) return null;
    const segments: JournalMeditationPayloadV1["segments"] = [];
    for (const s of o.segments) {
      if (!s || typeof s !== "object") continue;
      const r = s as Record<string, unknown>;
      if (typeof r.entryId !== "string") continue;
      if (typeof r.title !== "string") continue;
      if (typeof r.bodyPlain !== "string") continue;
      const createdAt =
        typeof r.createdAt === "string" ? r.createdAt : undefined;
      segments.push({
        entryId: r.entryId,
        title: r.title,
        bodyPlain: r.bodyPlain,
        ...(createdAt ? { createdAt } : {}),
      });
    }
    if (!segments.length) return null;
    return { v: 1, at: o.at, segments };
  } catch {
    return null;
  }
}

/**
 * Full journal body as plain text for handoff to Create / the chat API
 * (HTML stripped; long entries truncated only at a very high cap).
 */
export function journalEntryPlainForHandoff(html: string): string {
  const t = stripHtmlToText(expandVoiceClipTranscriptsForPlainText(html));
  if (t.length <= JOURNAL_BODY_PLAIN_MAX) return t;
  return `${t.slice(0, JOURNAL_BODY_PLAIN_MAX)}…`;
}

/** First user line when starting Create from Journal (shown in chat + sent to API). */
export const JOURNAL_CREATE_FIRST_MESSAGE =
  "Please create a meditation that reflects on these journal entries";

/**
 * Full user message sent to the guide (not shown verbatim in the UI bubble).
 * Each entry includes an explicit journal title line and full contents line so
 * the model always receives both, even when titles repeat or bodies are long.
 */
export function buildJournalHandoffApiContent(
  segments: JournalMeditationPayloadV1["segments"],
  guidance?: string,
): string {
  const guidanceNote = guidance?.trim() ?? "";
  const blocks = segments.map((s, i) => {
    const journalTitle = s.title.trim() || "Untitled entry";
    const journalContents = s.bodyPlain.trim() || "(empty entry)";
    return [
      `--- Journal entry ${i + 1} ---`,
      `Journal title: ${journalTitle}`,
      "Journal contents:",
      journalContents,
      `--- End journal entry ${i + 1} ---`,
    ].join("\n");
  });
  return [
    JOURNAL_CREATE_FIRST_MESSAGE,
    "",
    "The following blocks are the user’s saved journal entries. Use every title and the full contents when reflecting and shaping the meditation.",
    "",
    blocks.join("\n\n"),
    ...(guidanceNote
      ? [
          "",
          "--- Guide note for this entry ---",
          "The creator added this note about how to use the entry (not a change to meditation style):",
          guidanceNote,
          "--- End guide note ---",
        ]
      : []),
  ].join("\n");
}

/**
 * JSON payload string for Journal → Create handoff (survives navigation / Strict remount).
 */
let journalMeditationHandoffJsonArm: string | null = null;

export function armJournalMeditationHandoffJson(json: string): void {
  journalMeditationHandoffJsonArm = json;
}

export function peekJournalMeditationHandoffJson(): string | null {
  return journalMeditationHandoffJsonArm;
}

export function clearJournalMeditationHandoffJson(): void {
  journalMeditationHandoffJsonArm = null;
}

function newEntry(overrides?: Partial<JournalEntry>): JournalEntry {
  const now = new Date().toISOString();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `e_${now}_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: "",
    contentHtml: "<p></p>",
    ...overrides,
  };
}

function daysAgoIso(days: number, hour = 9): string {
  const d = new Date();
  d.setHours(hour, 15, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** Sample pages for guests — never synced to the cloud. */
export function buildDemoJournalStore(): JournalStoreV2 {
  const morning = newEntry({
    id: "demo-journal-morning",
    createdAt: daysAgoIso(1, 8),
    updatedAt: daysAgoIso(1, 8),
    title: "A quieter morning",
    mood: "calm",
    localOnly: true,
    sourceMetadata: { demo: true },
    contentHtml:
      "<p>Woke without reaching for my phone. Made tea and sat by the window for ten minutes.</p><p>Noticed how loud my usual rush feels once I stop it — and how little of it was actually urgent.</p>",
  });
  const resistance = newEntry({
    id: "demo-journal-resistance",
    createdAt: daysAgoIso(3, 21),
    updatedAt: daysAgoIso(3, 21),
    title: "What I keep putting off",
    mood: "mixed",
    localOnly: true,
    sourceMetadata: { demo: true },
    contentHtml:
      "<p>The project I care about keeps sliding to “tomorrow.” When I look closer, it isn’t laziness — it’s fear of doing it imperfectly.</p><p>Tomorrow I’ll open the doc for fifteen minutes only. No finishing required.</p>",
  });
  const gratitude = newEntry({
    id: "demo-journal-gratitude",
    createdAt: daysAgoIso(5, 7),
    updatedAt: daysAgoIso(5, 7),
    kind: "gratitude",
    title: "Three things",
    mood: "good",
    localOnly: true,
    sourceMetadata: { demo: true },
    gratitude: [
      "A walk without headphones",
      "A message from someone who remembered",
      "Hot water and a clean mug",
    ],
    contentHtml:
      "<p>A walk without headphones</p><p>A message from someone who remembered</p><p>Hot water and a clean mug</p>",
  });
  const blank = newEntry({
    id: "demo-journal-blank",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: "",
    localOnly: true,
    sourceMetadata: { demo: true },
    contentHtml: "<p></p>",
  });
  return {
    version: 2,
    activeEntryId: blank.id,
    entries: [blank, morning, resistance, gratitude],
  };
}

export function isDemoJournalEntry(e: JournalEntry): boolean {
  return e.sourceMetadata?.demo === true;
}

export function isDemoOnlyStore(store: JournalStoreV2): boolean {
  return (
    store.entries.length > 0 &&
    store.entries.every((e) => isDemoJournalEntry(e))
  );
}

/** Drop seeded guest samples — never treat them as personal or cloud data. */
export function withoutDemoJournalEntries(store: JournalStoreV2): JournalStoreV2 {
  const entries = store.entries.filter((e) => !isDemoJournalEntry(e));
  const activeEntryId =
    store.activeEntryId && entries.some((e) => e.id === store.activeEntryId)
      ? store.activeEntryId
      : (entries[0]?.id ?? null);
  return {
    version: 2,
    activeEntryId,
    entries,
    ...(store.folders?.length ? { folders: store.folders } : {}),
  };
}

export function emptyJournalStore(): JournalStoreV2 {
  return { version: 2, activeEntryId: null, entries: [] };
}

function demoSeedFlagSet(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(DEMO_SEED_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

function markDemoSeedFlag(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEMO_SEED_FLAG_KEY, "1");
  } catch {
    /* */
  }
}

/**
 * For guests: ensure demo sample pages exist when the device journal has no
 * real writing yet. Safe to call repeatedly. Never overwrites meaningful
 * personal entries.
 */
export function ensureGuestDemoJournalSeeded(
  existing?: JournalStoreV2 | null,
): JournalStoreV2 {
  const current =
    existing ??
    (typeof window !== "undefined" ? loadJournalStoreRaw() : buildDemoJournalStore());
  const personalMeaningful = current.entries.filter(
    (e) =>
      !isDemoJournalEntry(e) && journalEntryHasMeaningfulContent(e),
  );
  if (personalMeaningful.length > 0) {
    markDemoSeedFlag();
    return current;
  }

  const hasAllDemos = DEMO_ENTRY_IDS.every((id) =>
    current.entries.some((e) => e.id === id),
  );
  if (hasAllDemos && isDemoOnlyStore(current)) {
    markDemoSeedFlag();
    return current;
  }

  // Empty stub or missing demos with no personal writing → full demo set.
  const demo = buildDemoJournalStore();
  if (typeof window !== "undefined") {
    saveJournalStore(demo);
    markDemoSeedFlag();
  }
  return demo;
}

/**
 * Read localStorage only — no demo seeding. Use for signed-in cloud cache
 * and guest reads that must not rewrite the store.
 */
export function loadJournalStoreRaw(): JournalStoreV2 {
  if (typeof window === "undefined") {
    return emptyJournalStore();
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as unknown;
      if (isStoreV2(data) && data.entries.length > 0) {
        return {
          version: 2,
          activeEntryId:
            data.activeEntryId &&
            data.entries.some((e) => e.id === data.activeEntryId)
              ? data.activeEntryId
              : data.entries[0].id,
          entries: data.entries.map(normalizeEntry),
          ...(normalizeFolders(data.folders)
            ? { folders: normalizeFolders(data.folders) }
            : {}),
        };
      }
    }
    const legacy = window.localStorage.getItem(LEGACY_PLAIN_KEY);
    if (legacy && typeof legacy === "string" && legacy.trim()) {
      const e = newEntry({
        contentHtml: `<p>${escapeLegacyPlain(legacy)}</p>`,
        title: deriveEntryTitle(`<p>${escapeLegacyPlain(legacy)}</p>`),
      });
      return { version: 2, activeEntryId: e.id, entries: [e] };
    }
  } catch {
    /* */
  }
  return emptyJournalStore();
}

/**
 * Guest device journal: seeds demo samples when empty.
 * Signed-in flows must use `loadJournalStoreRaw` + cloud GET instead.
 */
export function loadJournalStore(): JournalStoreV2 {
  if (typeof window === "undefined") {
    return buildDemoJournalStore();
  }
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as unknown;
      if (isStoreV2(data) && data.entries.length > 0) {
        const normalized: JournalStoreV2 = {
          version: 2,
          activeEntryId:
            data.activeEntryId &&
            data.entries.some((e) => e.id === data.activeEntryId)
              ? data.activeEntryId
              : data.entries[0].id,
          entries: data.entries.map(normalizeEntry),
          ...(normalizeFolders(data.folders)
            ? { folders: normalizeFolders(data.folders) }
            : {}),
        };
        const meaningful = normalized.entries.filter(
          journalEntryHasMeaningfulContent,
        );
        if (meaningful.length === 0) {
          return ensureGuestDemoJournalSeeded(normalized);
        }
        // Guests who never received demos (flag unset) and have no writing yet
        // were handled above; if they only have blanks, still seed.
        if (!demoSeedFlagSet()) {
          const personal = normalized.entries.filter(
            (e) => !isDemoJournalEntry(e),
          );
          if (
            personal.length === 0 ||
            !personal.some(journalEntryHasMeaningfulContent)
          ) {
            return ensureGuestDemoJournalSeeded(normalized);
          }
          markDemoSeedFlag();
        }
        return normalized;
      }
    }
    const legacy = window.localStorage.getItem(LEGACY_PLAIN_KEY);
    if (legacy && typeof legacy === "string" && legacy.trim()) {
      const e = newEntry({
        contentHtml: `<p>${escapeLegacyPlain(legacy)}</p>`,
        title: deriveEntryTitle(`<p>${escapeLegacyPlain(legacy)}</p>`),
      });
      const store: JournalStoreV2 = {
        version: 2,
        activeEntryId: e.id,
        entries: [e],
      };
      saveJournalStore(store);
      markDemoSeedFlag();
      return store;
    }
  } catch {
    /* */
  }
  return ensureGuestDemoJournalSeeded(emptyJournalStore());
}

function escapeLegacyPlain(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "</p><p>");
}

function isStoreV2(x: unknown): x is JournalStoreV2 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 2) return false;
  if (!Array.isArray(o.entries)) return false;
  return o.entries.every(isEntry);
}

function isEntry(x: unknown): x is JournalEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.createdAt === "string" &&
    typeof o.updatedAt === "string" &&
    typeof o.title === "string" &&
    typeof o.contentHtml === "string"
  );
}

function normalizeFolders(raw: unknown): JournalFolder[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: JournalFolder[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.id !== "string" || !o.id.trim()) continue;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 40) : "";
    if (!name || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({ id: o.id.trim().slice(0, 80), name });
    if (out.length >= 40) break;
  }
  return out.length ? out : undefined;
}

function normalizeTags(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const tags = raw
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().replace(/^#/, "").slice(0, 32))
    .filter(Boolean)
    .slice(0, 16);
  return tags.length ? [...new Set(tags)] : undefined;
}

function normalizeEntry(e: JournalEntry): JournalEntry {
  const kind = e.kind === "gratitude" ? "gratitude" : undefined;
  const gratitude = kind
    ? normalizeGratitudeLines(e.gratitude)
    : undefined;
  const mood = isJournalMoodId(e.mood) ? e.mood : undefined;
  const tags = normalizeTags(e.tags);
  const localOnly = e.localOnly === true ? true : undefined;
  const mediaRefs = Array.isArray(e.mediaRefs)
    ? e.mediaRefs.filter((x): x is string => typeof x === "string").slice(0, 64)
    : undefined;
  const folderId =
    typeof e.folderId === "string" && e.folderId.trim()
      ? e.folderId.trim().slice(0, 80)
      : undefined;
  const importSource =
    e.importSource === "day_one" ||
    e.importSource === "markdown" ||
    e.importSource === "csv" ||
    e.importSource === "plaintext" ||
    e.importSource === "pdf_annotations" ||
    e.importSource === "handwritten_photo"
      ? e.importSource
      : undefined;
  const importBatchId =
    typeof e.importBatchId === "string" && e.importBatchId.trim()
      ? e.importBatchId.trim()
      : undefined;
  const sourceMetadata =
    e.sourceMetadata && typeof e.sourceMetadata === "object" && !Array.isArray(e.sourceMetadata)
      ? (e.sourceMetadata as Record<string, unknown>)
      : undefined;
  return {
    ...e,
    title: typeof e.title === "string" ? e.title : deriveEntryTitle(e.contentHtml),
    contentHtml: e.contentHtml?.trim() ? e.contentHtml : "<p></p>",
    ...(kind ? { kind, gratitude } : { kind: undefined, gratitude: undefined }),
    ...(mood ? { mood } : { mood: undefined }),
    ...(tags ? { tags } : { tags: undefined }),
    ...(localOnly ? { localOnly: true } : { localOnly: undefined }),
    ...(importSource ? { importSource } : { importSource: undefined }),
    ...(importBatchId ? { importBatchId } : { importBatchId: undefined }),
    ...(sourceMetadata ? { sourceMetadata } : { sourceMetadata: undefined }),
    ...(mediaRefs?.length ? { mediaRefs } : { mediaRefs: undefined }),
    ...(folderId ? { folderId } : { folderId: undefined }),
  };
}

/**
 * Apply cloud store as source of truth. Does not re-attach guest demos or
 * other local-only rows (offline/local-first can return later).
 */
export function mergeRemoteJournalKeepingLocalOnly(
  remote: JournalStoreV2,
  _localEntries: JournalEntry[],
): JournalStoreV2 {
  return {
    version: 2,
    activeEntryId: remote.activeEntryId,
    entries: remote.entries.map(normalizeEntry),
    ...(remote.folders?.length ? { folders: remote.folders } : {}),
  };
}

export function entriesForCloudPut(entries: JournalEntry[]): JournalEntry[] {
  return entries.filter((e) => !e.localOnly && !isDemoJournalEntry(e));
}

/** Consecutive local calendar days with a meaningful entry, ending today or yesterday. */
export function journalWritingStreakDays(
  entries: JournalEntry[],
  now = new Date(),
): number {
  const days = new Set(
    entries
      .filter(journalEntryHasMeaningfulContent)
      .map((e) => localDateKeyFromIso(e.createdAt)),
  );
  if (!days.size) return 0;
  const start = localDateKey(now);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const yesterday = localDateKey(y);
  let cursor = days.has(start) ? now : days.has(yesterday) ? y : null;
  if (!cursor) return 0;
  let n = 0;
  const d = new Date(cursor);
  while (days.has(localDateKey(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function saveJournalStore(store: JournalStoreV2) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* */
  }
}

export function newJournalEntry(overrides?: Partial<JournalEntry>): JournalEntry {
  return newEntry(overrides);
}

export function newJournalFolder(name: string): JournalFolder | null {
  const n = name.trim().slice(0, 40);
  if (!n) return null;
  const now = new Date().toISOString();
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `f_${crypto.randomUUID()}`
      : `f_${now}_${Math.random().toString(36).slice(2, 9)}`;
  return { id, name: n };
}

/** Calendar month key for grouping (YYYY-MM). */
export function monthKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "1970-01";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthHeading(yyyyMm: string): string {
  const [ys, ms] = yyyyMm.split("-");
  const y = Number(ys);
  const m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyyMm;
  return new Date(y, m - 1, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export type JournalSidebarGroup = {
  id: string;
  label: string;
  entries: JournalEntry[];
};

const MS_DAY = 86_400_000;

/** True if the entry has a non-empty title or body (after stripping HTML). */
export function isGratitudeEntry(e: JournalEntry): boolean {
  return e.kind === "gratitude";
}

export function emptyGratitudeLines(): JournalGratitudeLines {
  return ["", "", ""];
}

export function localDateKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function localDateKeyFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return localDateKey();
  return localDateKey(d);
}

function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function gratitudeLinesToHtml(lines: JournalGratitudeLines): string {
  const paras = lines
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `<p>${escapeHtmlText(s)}</p>`);
  return paras.length ? paras.join("") : "<p></p>";
}

export function normalizeGratitudeLines(raw: unknown): JournalGratitudeLines {
  const a = Array.isArray(raw) ? raw : [];
  return [
    typeof a[0] === "string" ? a[0] : "",
    typeof a[1] === "string" ? a[1] : "",
    typeof a[2] === "string" ? a[2] : "",
  ];
}

export function gratitudeTitleForDate(d: Date): string {
  return `Gratitude · ${d.toLocaleDateString("en-US", { dateStyle: "medium" })}`;
}

export function newGratitudeJournalEntry(now = new Date()): JournalEntry {
  const lines = emptyGratitudeLines();
  return newEntry({
    kind: "gratitude",
    gratitude: lines,
    title: gratitudeTitleForDate(now),
    contentHtml: gratitudeLinesToHtml(lines),
  });
}

export function findGratitudeEntryForLocalDate(
  entries: JournalEntry[],
  dateKey: string,
): JournalEntry | undefined {
  return entries.find(
    (e) => isGratitudeEntry(e) && localDateKeyFromIso(e.createdAt) === dateKey,
  );
}

export function journalEntryHasMeaningfulContent(e: JournalEntry): boolean {
  if (isGratitudeEntry(e)) {
    return (e.gratitude ?? []).some((s) => s.trim().length > 0)
      || stripHtmlToText(e.contentHtml).trim().length > 0;
  }
  if (e.title.trim().length > 0) return true;
  if (/<img\b/i.test(e.contentHtml)) return true;
  return stripHtmlToText(e.contentHtml).trim().length > 0;
}

function maxJournalEntryUpdatedAt(entries: JournalEntry[]): number {
  if (!entries.length) return 0;
  return Math.max(...entries.map((entry) => new Date(entry.updatedAt).getTime()), 0);
}

/**
 * Prefer cloud when it has entries. Guest demos / empty stubs never beat remote.
 * Signed-in JournalView always applies remote; this remains for other callers.
 */
export function shouldPreferRemoteJournalStore(
  remote: JournalStoreV2,
  localEntries: JournalEntry[],
): boolean {
  if (!remote.entries?.length) return false;
  const localPersonal = localEntries.filter((e) => !isDemoJournalEntry(e));
  if (localPersonal.length === 0) return true;
  if (isDemoOnlyStore({ version: 2, activeEntryId: null, entries: localEntries })) {
    return true;
  }
  const remoteMax = maxJournalEntryUpdatedAt(remote.entries);
  const localMax = maxJournalEntryUpdatedAt(localPersonal);
  if (remoteMax >= localMax) return true;
  const localMeaningful = localPersonal.filter(journalEntryHasMeaningfulContent);
  if (
    localMeaningful.length === 0 &&
    remote.entries.some(journalEntryHasMeaningfulContent)
  ) {
    return true;
  }
  return false;
}

export function groupJournalEntriesForSidebar(
  entries: JournalEntry[],
  now = new Date(),
): JournalSidebarGroup[] {
  const t = now.getTime();
  const sorted = [...entries].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  const lastWeek: JournalEntry[] = [];
  const lastMonth: JournalEntry[] = [];
  const olderByMonth = new Map<string, JournalEntry[]>();

  for (const e of sorted) {
    const age = t - new Date(e.updatedAt).getTime();
    if (age <= 7 * MS_DAY) {
      lastWeek.push(e);
    } else if (age <= 30 * MS_DAY) {
      lastMonth.push(e);
    } else {
      const mk = monthKeyFromIso(e.updatedAt);
      const arr = olderByMonth.get(mk) ?? [];
      arr.push(e);
      olderByMonth.set(mk, arr);
    }
  }

  const groups: JournalSidebarGroup[] = [];
  if (lastWeek.length) {
    groups.push({ id: "last-week", label: "Last week", entries: lastWeek });
  }
  if (lastMonth.length) {
    groups.push({ id: "last-month", label: "Last month", entries: lastMonth });
  }

  const monthKeys = Array.from(olderByMonth.keys()).sort((a, b) =>
    b.localeCompare(a),
  );
  for (const mk of monthKeys) {
    const list = olderByMonth.get(mk) ?? [];
    if (!list.length) continue;
    list.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    groups.push({
      id: `month-${mk}`,
      label: formatMonthHeading(mk),
      entries: list,
    });
  }

  return groups;
}
