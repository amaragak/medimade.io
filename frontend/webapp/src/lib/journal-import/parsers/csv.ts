import { parseIsoOrNull } from "@/lib/journal-import/dates";
import { parseCsvText } from "@/lib/journal-import/parse-csv";
import type {
  CsvColumnMapping,
  CsvTable,
  JournalImportDraft,
} from "@/lib/journal-import/types";
import { isJournalMoodId } from "@/lib/journal-moods";

export async function parseCsvTableFromFile(file: File): Promise<CsvTable> {
  const table = parseCsvText(await file.text());
  if (!table.headers.length) {
    throw new Error("That CSV doesn’t have a header row.");
  }
  if (!table.rows.length) {
    throw new Error("That CSV has headers but no rows.");
  }
  return table;
}

function cell(row: string[], i: number | undefined): string {
  if (i == null || i < 0) return "";
  return (row[i] ?? "").trim();
}

export function csvTableToDrafts(
  table: CsvTable,
  mapping: CsvColumnMapping,
): JournalImportDraft[] {
  const bodyIdx = Object.entries(mapping).find(([, r]) => r === "body");
  if (!bodyIdx) {
    throw new Error("Mark which column is the entry text before continuing.");
  }
  const bodyCol = Number(bodyIdx[0]);
  const titleCol = Number(
    Object.entries(mapping).find(([, r]) => r === "title")?.[0] ?? -1,
  );
  const dateCol = Number(
    Object.entries(mapping).find(([, r]) => r === "date")?.[0] ?? -1,
  );
  const moodCol = Number(
    Object.entries(mapping).find(([, r]) => r === "mood")?.[0] ?? -1,
  );
  const tagsCol = Number(
    Object.entries(mapping).find(([, r]) => r === "tags")?.[0] ?? -1,
  );

  const drafts: JournalImportDraft[] = [];
  table.rows.forEach((row, i) => {
    const body = cell(row, bodyCol);
    if (!body) return;
    const dateRaw = cell(row, dateCol);
    const created_at = parseIsoOrNull(dateRaw);
    const moodRaw = cell(row, moodCol).toLowerCase();
    const mood = isJournalMoodId(moodRaw) ? moodRaw : undefined;
    const tags = cell(row, tagsCol)
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean);
    drafts.push({
      title: cell(row, titleCol) || null,
      body,
      created_at,
      date_uncertain: dateCol >= 0 ? !created_at : true,
      source: "csv",
      source_metadata: {
        row: i + 2,
        mood: mood ?? (moodRaw || undefined),
        tags,
      },
      media_refs: [],
    });
  });
  if (!drafts.length) {
    throw new Error("None of the rows had text in the column you marked as the entry.");
  }
  return drafts;
}
