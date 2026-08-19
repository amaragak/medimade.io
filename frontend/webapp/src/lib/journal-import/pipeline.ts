import { markdownToJournalHtml } from "@/lib/journal-import/markdown-html";
import { handwrittenPersistMetadata } from "@/lib/journal-import/parsers/handwritten-photo";
import type { JournalImportDraft, JournalImportPreviewRow } from "@/lib/journal-import/types";
import {
  isJournalMoodId,
  type JournalMoodId,
} from "@/lib/journal-moods";
import {
  journalEntryHasMeaningfulContent,
  newJournalEntry,
  stripHtmlToText,
  type JournalEntry,
} from "@/lib/journal-storage";

function words(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  return inter / (A.size + B.size - inter);
}

const DUP_WINDOW_MS = 36 * 60 * 60 * 1000;

export function flagDuplicates(
  drafts: JournalImportDraft[],
  existing: JournalEntry[],
): JournalImportPreviewRow[] {
  const live = existing.filter(journalEntryHasMeaningfulContent);
  return drafts.map((d, i) => {
    const body = d.body.trim();
    const t = d.created_at ? new Date(d.created_at).getTime() : NaN;
    let likelyDuplicate = false;
    let duplicateHint: string | null = null;
    for (const e of live) {
      const et = new Date(e.createdAt).getTime();
      const closeTime =
        Number.isFinite(t) && Number.isFinite(et) && Math.abs(t - et) <= DUP_WINDOW_MS;
      const existingText = `${e.title}\n${stripHtmlToText(e.contentHtml)}`;
      const incoming = `${d.title ?? ""}\n${body}`;
      const overlap = jaccard(incoming, existingText);
      const sameTitle =
        d.title &&
        e.title.trim().toLowerCase() === d.title.trim().toLowerCase() &&
        closeTime;
      if ((closeTime && overlap >= 0.72) || overlap >= 0.9 || sameTitle) {
        likelyDuplicate = true;
        duplicateHint = e.title.trim() || "an existing entry";
        break;
      }
    }
    return {
      ...d,
      key: `imp_${i}_${d.source}`,
      include: !likelyDuplicate,
      likelyDuplicate,
      duplicateHint,
    };
  });
}

function moodFromMeta(meta: Record<string, unknown>): JournalMoodId | undefined {
  const m = meta.mood;
  if (isJournalMoodId(m)) return m;
  if (typeof m === "string" && isJournalMoodId(m.toLowerCase())) {
    return m.toLowerCase() as JournalMoodId;
  }
  return undefined;
}

function tagsFromMeta(meta: Record<string, unknown>, extra?: string[]): string[] {
  const fromMeta = Array.isArray(meta.tags)
    ? meta.tags.filter((t): t is string => typeof t === "string")
    : [];
  return [...new Set([...(extra ?? []), ...fromMeta])].slice(0, 16);
}

export function previewRowsToEntries(
  rows: JournalImportPreviewRow[],
  batchId: string,
): JournalEntry[] {
  const now = new Date().toISOString();
  return rows
    .filter((r) => r.include)
    .map((r) => {
      const created = r.created_at;
      if (!created) {
        throw new Error(
          `“${r.title || "An entry"}” still needs a date. Fix uncertain dates before saving.`,
        );
      }
      const tags = tagsFromMeta(r.source_metadata);
      const mood = moodFromMeta(r.source_metadata);
      const handwritten = r.source === "handwritten_photo";
      const photosHtml = handwritten
        ? r.media_refs
            .filter((s) => s.startsWith("data:image"))
            .map(
              (src) =>
                `<img src="${src.replace(/"/g, "")}" alt="Handwritten journal page" class="my-3 max-h-[28rem] max-w-full rounded-lg" />`,
            )
            .join("")
        : "";
      const names = Array.isArray(r.source_metadata.filenames)
        ? r.source_metadata.filenames.filter(
            (x): x is string => typeof x === "string",
          )
        : [];
      const mediaRefs = handwritten
        ? (names.length
            ? names
            : r.media_refs.map((_, i) => `handwritten-page-${i + 1}.jpg`)
          ).map((n) => n.slice(0, 200))
        : r.media_refs;
      return newJournalEntry({
        title: (r.title ?? "").trim(),
        contentHtml: markdownToJournalHtml(r.body) + photosHtml,
        createdAt: created,
        updatedAt: now,
        ...(tags.length ? { tags } : {}),
        ...(mood ? { mood } : {}),
        importSource: r.source,
        importBatchId: batchId,
        sourceMetadata: handwritten
          ? handwrittenPersistMetadata(r.source_metadata)
          : r.source_metadata,
        ...(mediaRefs.length ? { mediaRefs } : {}),
      });
    });
}

export function mergeImportedEntries(
  existing: JournalEntry[],
  imported: JournalEntry[],
): JournalEntry[] {
  const stubOnly =
    existing.length === 1 &&
    !journalEntryHasMeaningfulContent(existing[0]) &&
    existing[0].kind !== "gratitude";
  const base = stubOnly ? [] : existing;
  return [...imported, ...base];
}

export function importSummary(rows: JournalImportPreviewRow[]): {
  count: number;
  dateRange: string | null;
  mediaSkipped: number;
  duplicates: number;
  uncertainDates: number;
} {
  const included = rows.filter((r) => r.include);
  const dates = included
    .map((r) => r.created_at)
    .filter((x): x is string => Boolean(x))
    .map((x) => new Date(x).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  let dateRange: string | null = null;
  if (dates.length) {
    const a = new Date(dates[0]).toLocaleDateString("en-US", { dateStyle: "medium" });
    const b = new Date(dates[dates.length - 1]).toLocaleDateString("en-US", {
      dateStyle: "medium",
    });
    dateRange = a === b ? a : `${a} – ${b}`;
  }
  return {
    count: included.length,
    dateRange,
    mediaSkipped: included.filter(
      (r) => r.media_refs.length && r.source !== "handwritten_photo",
    ).length,
    duplicates: included.filter((r) => r.likelyDuplicate).length,
    uncertainDates: included.filter((r) => r.date_uncertain || !r.created_at).length,
  };
}
