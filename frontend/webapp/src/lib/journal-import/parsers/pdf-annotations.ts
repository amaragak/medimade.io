import { extractPdfAnnotationUnits } from "@/lib/journal-import/extract-pdf-annotations";
import { parseIsoOrNull } from "@/lib/journal-import/dates";
import type { JournalImportDraft } from "@/lib/journal-import/types";
import { datePdfJournalImport } from "@/lib/medimade-api";

export type PdfImportParseResult = {
  drafts: JournalImportDraft[];
  datesFound: boolean;
};

function ymdToIso(ymd: string | null): string | null {
  if (!ymd) return null;
  return parseIsoOrNull(`${ymd}T12:00:00Z`);
}

export async function parsePdfAnnotationImport(
  files: File[],
): Promise<PdfImportParseResult> {
  const units = await extractPdfAnnotationUnits(files);
  const dated = await datePdfJournalImport(units);
  if (dated.error && !dated.entries.length) {
    throw new Error(dated.error);
  }
  const drafts: JournalImportDraft[] = dated.entries.map((e) => {
    const created_at = ymdToIso(e.date);
    return {
      title: e.title.trim() || null,
      body: e.body,
      created_at,
      date_uncertain: !created_at,
      source: "pdf_annotations",
      source_metadata: {
        haiku_dated: dated.dates_found,
      },
      media_refs: [],
    };
  });
  if (!drafts.length) {
    throw new Error(
      dated.error ||
        "Nothing we could turn into journal pages from those annotations.",
    );
  }
  return {
    drafts,
    datesFound: dated.dates_found && drafts.every((d) => Boolean(d.created_at)),
  };
}

export function applyBulkDateToDrafts(
  drafts: JournalImportDraft[],
  iso: string,
): JournalImportDraft[] {
  return drafts.map((d) => ({
    ...d,
    created_at: iso,
    date_uncertain: false,
    source_metadata: {
      ...d.source_metadata,
      bulk_date: true,
    },
  }));
}
