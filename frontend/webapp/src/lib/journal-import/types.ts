export type JournalImportSource =
  | "day_one"
  | "markdown"
  | "csv"
  | "plaintext"
  | "pdf_annotations"
  | "handwritten_photo";

/** Format-agnostic draft every parser must emit. */
export type JournalImportDraft = {
  title: string | null;
  body: string;
  created_at: string | null;
  date_uncertain: boolean;
  source: JournalImportSource;
  source_metadata: Record<string, unknown>;
  media_refs: string[];
};

export type JournalImportPreviewRow = JournalImportDraft & {
  key: string;
  include: boolean;
  likelyDuplicate: boolean;
  duplicateHint: string | null;
};

export type CsvTable = {
  headers: string[];
  rows: string[][];
};

export type CsvColumnRole = "skip" | "title" | "body" | "date" | "mood" | "tags";

export type CsvColumnMapping = Record<number, CsvColumnRole>;
