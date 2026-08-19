import { parseIsoOrNull } from "@/lib/journal-import/dates";

function fromExifValue(raw: unknown): string | null {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString();
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const colonDate = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (colonDate) {
    const d = new Date(
      Number(colonDate[1]),
      Number(colonDate[2]) - 1,
      Number(colonDate[3]),
      Number(colonDate[4]),
      Number(colonDate[5]),
      Number(colonDate[6]),
    );
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return parseIsoOrNull(s.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
}

/** Capture time from EXIF only — never file mtime or import day. */
export async function exifCreatedAt(file: File): Promise<string | null> {
  try {
    const { parse } = await import("exifr");
    const data = (await parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "DateTime"],
      reviveValues: true,
    })) as Record<string, unknown> | undefined;
    if (!data) return null;
    return (
      fromExifValue(data.DateTimeOriginal) ??
      fromExifValue(data.CreateDate) ??
      fromExifValue(data.DateTime)
    );
  } catch {
    return null;
  }
}
