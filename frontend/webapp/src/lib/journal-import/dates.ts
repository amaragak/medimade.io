export function parseIsoOrNull(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const direct = Date.parse(s);
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  const ymd = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (ymd) {
    const d = new Date(Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3])));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/** Dates in names like `2026-04-12.md` or `2026-04-12-lost-necklace.md`. */
export function dateFromFilename(name: string): string | null {
  const base = name.replace(/^.*[/\\]/, "");
  const m =
    /(\d{4})[-_.](\d{2})[-_.](\d{2})/.exec(base) ??
    /^(\d{4})(\d{2})(\d{2})(?:\D|$)/.exec(base);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const withoutDate = base.replace(
    /^\d{4}[-_.]?\d{2}[-_.]?\d{2}[-_.]?/,
    "",
  );
  const t = (withoutDate || base)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || "Untitled entry";
}

export function headingTitleAndBody(md: string): { title: string | null; body: string } {
  const text = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const m = /^#\s+(.+)$/m.exec(text);
  if (!m) return { title: null, body: text.trim() };
  const title = m[1].trim();
  const body = text.replace(m[0], "").trim();
  return { title: title || null, body };
}

export type YamlFrontmatter = {
  date?: string;
  title?: string;
  tags?: string[];
  rest: string;
};

export function splitYamlFrontmatter(md: string): YamlFrontmatter {
  const text = md.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---")) return { rest: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { rest: text };
  const block = text.slice(3, end).trim();
  const rest = text.slice(end + 4).replace(/^\n/, "");
  const out: YamlFrontmatter = { rest };
  for (const line of block.split("\n")) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim().replace(/^['"]|['"]$/g, "");
    if (key === "date" || key === "created" || key === "created_at") out.date = val;
    if (key === "title") out.title = val;
    if (key === "tags") {
      out.tags = val
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
  }
  return out;
}
