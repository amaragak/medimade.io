import { parseCsvTableFromFile } from "@/lib/journal-import/parsers/csv";
import { parseDayOneImport } from "@/lib/journal-import/parsers/day-one";
import { parseMarkdownImport } from "@/lib/journal-import/parsers/markdown";
import { parsePdfAnnotationImport } from "@/lib/journal-import/parsers/pdf-annotations";
import type { CsvTable, JournalImportDraft, JournalImportSource } from "@/lib/journal-import/types";

export type ImportKind =
  | "day_one"
  | "markdown"
  | "csv"
  | "pdf_annotations"
  | "handwritten_photo";

export type ImportSourceOption = {
  id: ImportKind;
  label: string;
  hint: string;
  accept: string;
  multiple: boolean;
  directory?: boolean;
};

export const JOURNAL_IMPORT_SOURCES: ImportSourceOption[] = [
  {
    id: "markdown",
    label: "Markdown or text",
    hint: "One file, a folder, or a zip of .md / .txt pages.",
    accept: ".md,.markdown,.txt,.text,.zip",
    multiple: true,
    directory: true,
  },
  {
    id: "day_one",
    label: "Day One",
    hint: "A Day One JSON zip, or Journal.json.",
    accept: ".zip,.json",
    multiple: false,
  },
  {
    id: "csv",
    label: "CSV",
    hint: "A spreadsheet export. You’ll match columns next.",
    accept: ".csv,.txt",
    multiple: false,
  },
  {
    id: "pdf_annotations",
    label: "PDF annotations",
    hint: "Highlights and notes from PDFs. We’ll try to read dates; if we can’t, you can set one for the whole batch.",
    accept: ".pdf,application/pdf",
    multiple: true,
  },
  {
    id: "handwritten_photo",
    label: "Handwritten photos",
    hint: "Photos of pages. We’ll read the handwriting, then you check the words before anything is saved.",
    accept: "image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif",
    multiple: true,
  },
];

export async function runImportParser(
  kind: ImportKind,
  files: File[],
): Promise<{ drafts?: JournalImportDraft[]; csv?: CsvTable; pdfDatesMissing?: boolean }> {
  if (kind === "markdown") {
    return { drafts: await parseMarkdownImport(files) };
  }
  if (kind === "day_one") {
    return { drafts: await parseDayOneImport(files) };
  }
  if (kind === "csv") {
    if (!files[0]) throw new Error("Choose a CSV file.");
    return { csv: await parseCsvTableFromFile(files[0]) };
  }
  if (kind === "pdf_annotations") {
    const r = await parsePdfAnnotationImport(files);
    return { drafts: r.drafts, pdfDatesMissing: !r.datesFound };
  }
  throw new Error("Unknown import kind.");
}

export function sourceLabel(source: JournalImportSource): string {
  if (source === "day_one") return "Day One";
  if (source === "csv") return "CSV";
  if (source === "plaintext") return "Text";
  if (source === "pdf_annotations") return "PDF";
  if (source === "handwritten_photo") return "Handwritten";
  return "Markdown";
}
