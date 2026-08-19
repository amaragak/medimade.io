import {
  dateFromFilename,
  headingTitleAndBody,
  splitYamlFrontmatter,
  titleFromFilename,
  parseIsoOrNull,
} from "@/lib/journal-import/dates";
import type { JournalImportDraft } from "@/lib/journal-import/types";
import { readZipArchive } from "@/lib/zip-store";

const TEXT_EXT = /\.(md|markdown|txt|text)$/i;

function isTextName(name: string): boolean {
  return TEXT_EXT.test(name);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function draftFromMarkdownFile(opts: {
  name: string;
  text: string;
  lastModified?: number;
}): JournalImportDraft {
  const fm = splitYamlFrontmatter(opts.text);
  const headed = headingTitleAndBody(fm.rest);
  const title =
    fm.title?.trim() ||
    headed.title ||
    titleFromFilename(opts.name);
  const fromFm = parseIsoOrNull(fm.date ?? null);
  const fromName = dateFromFilename(opts.name);
  const fromFs =
    typeof opts.lastModified === "number" && Number.isFinite(opts.lastModified)
      ? new Date(opts.lastModified).toISOString()
      : null;
  const created_at = fromFm ?? fromName ?? fromFs;
  const date_uncertain = !fromFm && !fromName;
  return {
    title: title.trim() ? title.trim() : null,
    body: headed.body,
    created_at,
    date_uncertain,
    source: isTextName(opts.name) && /\.txt$/i.test(opts.name) ? "plaintext" : "markdown",
    source_metadata: {
      filename: opts.name,
      ...(fm.tags?.length ? { tags: fm.tags } : {}),
      date_source: fromFm ? "frontmatter" : fromName ? "filename" : fromFs ? "file_mtime" : "none",
    },
    media_refs: [],
  };
}

export async function parseMarkdownImport(files: File[]): Promise<JournalImportDraft[]> {
  const drafts: JournalImportDraft[] = [];
  for (const file of files) {
    const name = file.webkitRelativePath || file.name;
    const lower = name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const zip = await readZipArchive(await file.arrayBuffer());
      for (const z of zip) {
        if (!isTextName(z.name) || z.name.startsWith("__MACOSX/")) continue;
        drafts.push(
          draftFromMarkdownFile({
            name: z.name,
            text: decodeUtf8(z.bytes),
          }),
        );
      }
      continue;
    }
    if (!isTextName(name)) continue;
    drafts.push(
      draftFromMarkdownFile({
        name,
        text: await file.text(),
        lastModified: file.lastModified,
      }),
    );
  }
  if (!drafts.length) {
    throw new Error("No markdown or text files found in what you chose.");
  }
  return drafts;
}
