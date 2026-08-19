import { compressImageFileToJpegDataUrl } from "@/components/journal-image-extension";
import { exifCreatedAt } from "@/lib/journal-import/exif-date";
import { fileToOcrBlob, ocrPhotoFile, type OcrWord } from "@/lib/journal-import/ocr-browser";
import type { JournalImportDraft } from "@/lib/journal-import/types";

export type HandwrittenGroup = {
  files: File[];
};

function earliestIso(dates: Array<string | null>): string | null {
  const ok = dates
    .filter((d): d is string => Boolean(d))
    .map((d) => ({ d, t: new Date(d).getTime() }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  return ok[0]?.d ?? null;
}

export async function parseHandwrittenPhotoImport(
  groups: HandwrittenGroup[],
  onProgress?: (done: number, total: number) => void,
): Promise<JournalImportDraft[]> {
  const photos = groups.flatMap((g) => g.files);
  if (!photos.length) {
    throw new Error("Choose one or more photos of handwritten pages.");
  }

  const total = photos.length;
  let done = 0;
  const ocrByFile = new Map<File, Awaited<ReturnType<typeof ocrPhotoFile>>>();
  const exifByFile = new Map<File, string | null>();
  const storedByFile = new Map<File, string>();

  for (const file of photos) {
    ocrByFile.set(file, await ocrPhotoFile(file));
    exifByFile.set(file, await exifCreatedAt(file));
    const readable = await fileToOcrBlob(file);
    const forStore =
      readable instanceof File
        ? readable
        : new File([readable], file.name.replace(/\.hei[cf]$/i, ".jpg"), {
            type: "image/jpeg",
          });
    storedByFile.set(
      file,
      await compressImageFileToJpegDataUrl(forStore, 1280, 0.72),
    );
    done += 1;
    onProgress?.(done, total);
  }

  return groups.map((g) => {
    const parts: string[] = [];
    const words: OcrWord[] = [];
    let low = 0;
    const media: string[] = [];
    const names: string[] = [];
    const dates: Array<string | null> = [];
    let engine: string = "textract";

    for (const file of g.files) {
      const ocr = ocrByFile.get(file);
      const stored = storedByFile.get(file);
      if (ocr) {
        engine = ocr.engine;
        if (ocr.text.trim()) parts.push(ocr.text.trim());
        words.push(...ocr.words);
        low += ocr.lowConfidenceCount;
      }
      if (stored) media.push(stored);
      names.push(file.name);
      dates.push(exifByFile.get(file) ?? null);
    }

    const created_at = earliestIso(dates);
    return {
      title: null,
      body: parts.join("\n\n"),
      created_at,
      date_uncertain: !created_at,
      source: "handwritten_photo",
      source_metadata: {
        photo_count: g.files.length,
        low_confidence_word_count: low,
        ocr_engine: engine,
        filenames: names,
        ocr_spans: words.slice(0, 4000),
      },
      media_refs: media,
    };
  });
}

export function handwrittenPersistMetadata(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const filenames = Array.isArray(meta.filenames)
    ? meta.filenames.filter((x): x is string => typeof x === "string").slice(0, 32)
    : [];
  return {
    photo_count: meta.photo_count,
    low_confidence_word_count: meta.low_confidence_word_count,
    ocr_engine: meta.ocr_engine,
    ...(filenames.length ? { filenames } : {}),
  };
}
