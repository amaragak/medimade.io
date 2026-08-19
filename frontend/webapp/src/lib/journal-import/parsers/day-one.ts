import { parseIsoOrNull } from "@/lib/journal-import/dates";
import type { JournalImportDraft } from "@/lib/journal-import/types";
import { readZipArchive, type ZipFile } from "@/lib/zip-store";

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^\uFEFF/, "");
}

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

function findJournalJson(files: ZipFile[]): ZipFile | null {
  const jsons = files.filter((f) => /\.json$/i.test(f.name) && !f.name.includes("__MACOSX"));
  const named = jsons.find((f) => /journal\.json$/i.test(f.name.replace(/^.*[/\\]/, "")));
  return named ?? jsons[0] ?? null;
}

function photoRefs(entry: Record<string, unknown>): string[] {
  const photos = entry.photos;
  if (!Array.isArray(photos)) return [];
  const refs: string[] = [];
  for (const p of photos) {
    const o = asRecord(p);
    if (!o) continue;
    const md5 = typeof o.md5 === "string" ? o.md5 : "";
    const type = typeof o.type === "string" ? o.type : "jpeg";
    const id = typeof o.identifier === "string" ? o.identifier : "";
    if (md5) refs.push(`photos/${md5}.${type}`);
    else if (id) refs.push(`photos/${id}`);
  }
  return refs;
}

function tagsOf(entry: Record<string, unknown>): string[] {
  if (!Array.isArray(entry.tags)) return [];
  return entry.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
}

function bodyOf(entry: Record<string, unknown>): string {
  if (typeof entry.text === "string") return entry.text;
  if (typeof entry.richText === "string") return entry.richText;
  return "";
}

function draftsFromJournalObject(data: unknown): JournalImportDraft[] {
  const root = asRecord(data);
  const list = Array.isArray(data)
    ? data
    : Array.isArray(root?.entries)
      ? root.entries
      : null;
  if (!list) {
    throw new Error("That JSON doesn’t look like a Day One journal (no entries array).");
  }
  const drafts: JournalImportDraft[] = [];
  for (const raw of list) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const created =
      parseIsoOrNull(typeof entry.creationDate === "string" ? entry.creationDate : null) ??
      parseIsoOrNull(typeof entry.createdAt === "string" ? entry.createdAt : null);
    const media_refs = photoRefs(entry);
    const tags = tagsOf(entry);
    const titleFromMd = /^#\s+(.+)$/m.exec(bodyOf(entry));
    const rawBody = bodyOf(entry).replace(/!\[\]\(dayone-moment:\/\/[^)]+\)/gi, "").trim();
    const body = titleFromMd ? rawBody.replace(titleFromMd[0], "").trim() : rawBody;
    drafts.push({
      title: titleFromMd?.[1]?.trim() ?? null,
      body: titleFromMd ? body.replace(titleFromMd[0], "").trim() : body,
      created_at: created,
      date_uncertain: !created,
      source: "day_one",
      source_metadata: {
        uuid: typeof entry.uuid === "string" ? entry.uuid : undefined,
        tags,
        timeZone: typeof entry.timeZone === "string" ? entry.timeZone : undefined,
        location: entry.location ?? undefined,
        starred: entry.starred === true,
        modifiedDate:
          typeof entry.modifiedDate === "string" ? entry.modifiedDate : undefined,
      },
      media_refs,
    });
  }
  if (!drafts.length) {
    throw new Error("The Day One file didn’t contain any entries.");
  }
  return drafts;
}

export async function parseDayOneImport(files: File[]): Promise<JournalImportDraft[]> {
  if (!files.length) throw new Error("Choose a Day One zip or Journal.json file.");
  const file = files[0];
  const name = file.name.toLowerCase();
  if (name.endsWith(".json")) {
    const data = JSON.parse(await file.text()) as unknown;
    return draftsFromJournalObject(data);
  }
  const zip = await readZipArchive(await file.arrayBuffer());
  const jsonFile = findJournalJson(zip);
  if (!jsonFile) {
    throw new Error("No Journal.json found inside that zip.");
  }
  const data = JSON.parse(decodeUtf8(jsonFile.bytes)) as unknown;
  return draftsFromJournalObject(data);
}
