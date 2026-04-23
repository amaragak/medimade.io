import AsyncStorage from "@react-native-async-storage/async-storage";

/** Same key as webapp so data shape matches (different runtime storage). */
const STORE_KEY = "mm_journal_store_v2";

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

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|h[1-6]|li|br)\s*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function newEntry(overrides?: Partial<JournalEntry>): JournalEntry {
  const now = new Date().toISOString();
  const id = `e_${now}_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    createdAt: now,
    updatedAt: now,
    title: "",
    contentHtml: "<p></p>",
    ...overrides,
  };
}

function normalizeEntry(e: JournalEntry): JournalEntry {
  return {
    ...e,
    title: typeof e.title === "string" ? e.title : "",
    contentHtml: e.contentHtml?.trim() ? e.contentHtml : "<p></p>",
  };
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

function isStoreV2(x: unknown): x is JournalStoreV2 {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== 2) return false;
  if (!Array.isArray(o.entries)) return false;
  return o.entries.every(isEntry);
}

export async function loadJournalStoreAsync(): Promise<JournalStoreV2> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
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
  } catch {
    /* ignore */
  }
  const e = newEntry();
  return { version: 2, activeEntryId: e.id, entries: [e] };
}

export async function saveJournalStoreAsync(
  store: JournalStoreV2,
): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function createNewJournalEntry(): JournalEntry {
  return newEntry();
}
