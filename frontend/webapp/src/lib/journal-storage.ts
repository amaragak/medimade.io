export type JournalEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  contentHtml: string;
};

export type JournalStoreV2 = {
  version: 2;
  activeEntryId: string | null;
  entries: JournalEntry[];
};

const LEGACY_PLAIN_KEY = "mm_journal_entries_v1";
const STORE_KEY = "mm_journal_store_v2";

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
): string {
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

export function loadJournalStore(): JournalStoreV2 {
  if (typeof window === "undefined") {
    const e = newEntry();
    return { version: 2, activeEntryId: e.id, entries: [e] };
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
        };
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
      return store;
    }
  } catch {
    /* */
  }
  const e = newEntry();
  return { version: 2, activeEntryId: e.id, entries: [e] };
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

function normalizeEntry(e: JournalEntry): JournalEntry {
  return {
    ...e,
    title: typeof e.title === "string" ? e.title : deriveEntryTitle(e.contentHtml),
    contentHtml: e.contentHtml?.trim() ? e.contentHtml : "<p></p>",
  };
}

export function saveJournalStore(store: JournalStoreV2) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    /* */
  }
}

export function newJournalEntry(): JournalEntry {
  return newEntry();
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
export function journalEntryHasMeaningfulContent(e: JournalEntry): boolean {
  if (e.title.trim().length > 0) return true;
  return stripHtmlToText(e.contentHtml).trim().length > 0;
}

function maxJournalEntryUpdatedAt(entries: JournalEntry[]): number {
  if (!entries.length) return 0;
  return Math.max(...entries.map((entry) => new Date(entry.updatedAt).getTime()), 0);
}

/**
 * Prefer cloud copy when it is newer, or when local is a single empty stub and
 * cloud has data (same rules as the Journal page).
 */
export function shouldPreferRemoteJournalStore(
  remote: JournalStoreV2,
  localEntries: JournalEntry[],
): boolean {
  if (!remote.entries?.length) return false;
  const remoteMax = maxJournalEntryUpdatedAt(remote.entries);
  const localMax = maxJournalEntryUpdatedAt(localEntries);
  if (remoteMax > localMax) return true;
  if (localEntries.length === 1) {
    const e = localEntries[0];
    if (e.title.trim()) return false;
    const plain = stripHtmlToText(e.contentHtml).trim();
    if (plain.length === 0 && remote.entries.length > 0) return true;
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
