import { isGratitudeEntry, journalEntryPlainForHandoff, type JournalEntry, type JournalStoreV2 } from "@/lib/journal-storage";
import { journalMoodLabel } from "@/lib/journal-moods";
import { md5Hex, md5HexOfString } from "@/lib/md5";
import { buildZipBlob } from "@/lib/zip-store";

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function dayOneUuid(id: string): string {
  const hex = id.replace(/-/g, "").toUpperCase();
  if (/^[0-9A-F]{32}$/.test(hex)) return hex;
  return md5HexOfString(id).toUpperCase();
}

function decodeDataUrl(src: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,(.+)$/i.exec(src.trim());
  if (!m) return null;
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime: m[1], bytes };
  } catch {
    return null;
  }
}

function mimeToDayOneType(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("webp")) return "webp";
  return "jpeg";
}

function htmlToMarkdown(html: string): string {
  if (typeof document === "undefined") {
    return journalEntryPlainForHandoff(html);
  }
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  wrap.querySelectorAll("[data-journal-voice-clip='1']").forEach((el) => {
    const raw = el.getAttribute("data-transcript");
    let spoken = "";
    if (raw) {
      try {
        spoken = journalEntryPlainForHandoff(decodeURIComponent(raw));
      } catch {
        spoken = "";
      }
    }
    const p = document.createElement("p");
    p.textContent = spoken ? `Voice: ${spoken}` : "Voice clip";
    el.replaceWith(p);
  });

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) {
      return Array.from(node.childNodes).map(walk).join("");
    }
    const tag = node.tagName.toLowerCase();
    const inner = Array.from(node.childNodes).map(walk).join("");
    if (tag === "img") {
      const src = node.getAttribute("src") ?? "";
      const alt = node.getAttribute("alt") ?? "";
      if (src.startsWith("data:")) return `![${alt}](${src})`;
      return alt ? `![${alt}](${src})` : "";
    }
    if (tag === "h2") return `\n## ${inner.trim()}\n`;
    if (tag === "h3") return `\n### ${inner.trim()}\n`;
    if (tag === "strong" || tag === "b") return `**${inner}**`;
    if (tag === "em" || tag === "i") return `*${inner}*`;
    if (tag === "li") return `- ${inner.trim()}\n`;
    if (tag === "br") return "\n";
    if (tag === "p" || tag === "div") return `${inner.trim()}\n\n`;
    if (tag === "ul" || tag === "ol") return `\n${inner}\n`;
    return inner;
  };

  return walk(wrap).replace(/\n{3,}/g, "\n\n").trim();
}

function entryPlainBlock(e: JournalEntry): string {
  const date = new Date(e.createdAt).toLocaleString();
  const bits: string[] = [];
  bits.push(e.title.trim() || "Untitled entry");
  bits.push(date);
  if (e.mood) {
    const label = journalMoodLabel(e.mood);
    if (label) bits.push(`Mood: ${label}`);
  }
  if (e.tags?.length) bits.push(`Tags: ${e.tags.join(", ")}`);
  bits.push("");
  if (isGratitudeEntry(e)) {
    const lines = (e.gratitude ?? []).map((s) => s.trim()).filter(Boolean);
    bits.push(lines.length ? lines.map((l) => `• ${l}`).join("\n") : "(empty)");
  } else {
    bits.push(journalEntryPlainForHandoff(e.contentHtml) || "(empty)");
  }
  return bits.join("\n");
}

export function journalStoreToPlainText(entries: JournalEntry[]): string {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  return sorted.map(entryPlainBlock).join("\n\n———\n\n");
}

export function downloadJournalPlainText(entries: JournalEntry[]): void {
  const text = journalStoreToPlainText(entries);
  downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `journal-${stamp()}.txt`);
}

export function downloadJournalBackupJson(store: JournalStoreV2): void {
  const json = JSON.stringify(store, null, 2);
  downloadBlob(
    new Blob([json], { type: "application/json;charset=utf-8" }),
    `journal-backup-${stamp()}.json`,
  );
}

export function printJournalPdf(entries: JournalEntry[]): void {
  const w = window.open("", "_blank", "noopener,noreferrer");
  if (!w) return;
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const article = sorted
    .map((e) => {
      const body = document.createElement("div");
      body.textContent = entryPlainBlock(e);
      return `<article><pre>${body.innerHTML}</pre></article>`;
    })
    .join("");
  w.document.write(`<!doctype html><html><head><title>Journal</title><style>
    body{font-family:Georgia,serif;max-width:40rem;margin:2rem auto;color:#222;padding:0 1rem}
    article{page-break-inside:avoid;margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:1px solid #ddd}
    pre{white-space:pre-wrap;font:inherit;margin:0}
  </style></head><body>${article}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

type DayOnePhoto = {
  identifier: string;
  md5: string;
  type: string;
  orderInEntry: number;
};

function collectDataImages(html: string): { src: string; alt: string }[] {
  if (typeof document === "undefined") return [];
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  return Array.from(wrap.querySelectorAll("img[src]"))
    .map((el) => ({
      src: el.getAttribute("src") ?? "",
      alt: el.getAttribute("alt") ?? "",
    }))
    .filter((x) => x.src.startsWith("data:"));
}

function entryToDayOne(e: JournalEntry): {
  json: Record<string, unknown>;
  photos: { md5: string; type: string; bytes: Uint8Array }[];
} {
  const uuid = dayOneUuid(e.id);
  const tags = [...(e.tags ?? [])];
  if (isGratitudeEntry(e) && !tags.includes("gratitude")) tags.push("gratitude");
  const mood = journalMoodLabel(e.mood);
  if (mood && !tags.includes(mood.toLowerCase())) tags.push(mood.toLowerCase());

  let text = "";
  if (e.title.trim()) text += `# ${e.title.trim()}\n\n`;
  if (isGratitudeEntry(e)) {
    const lines = (e.gratitude ?? []).map((s) => s.trim()).filter(Boolean);
    text += lines.map((l) => `- ${l}`).join("\n");
  } else {
    text += htmlToMarkdown(e.contentHtml);
  }

  const photosMeta: DayOnePhoto[] = [];
  const photoFiles: { md5: string; type: string; bytes: Uint8Array }[] = [];
  const images = isGratitudeEntry(e) ? [] : collectDataImages(e.contentHtml);
  images.forEach((img, orderInEntry) => {
    const decoded = decodeDataUrl(img.src);
    if (!decoded) return;
    const type = mimeToDayOneType(decoded.mime);
    const md5 = md5Hex(decoded.bytes);
    const identifier = md5HexOfString(`${uuid}:${orderInEntry}:${md5}`).toUpperCase();
    photosMeta.push({ identifier, md5, type, orderInEntry });
    photoFiles.push({ md5, type, bytes: decoded.bytes });
    const needle = `![${img.alt}](${img.src})`;
    const moment = `![](dayone-moment://${identifier})`;
    if (text.includes(needle)) text = text.replace(needle, moment);
    else text += `\n\n${moment}`;
  });

  const json: Record<string, unknown> = {
    uuid,
    creationDate: new Date(e.createdAt).toISOString(),
    modifiedDate: new Date(e.updatedAt).toISOString(),
    text: text.trim() || " ",
    starred: false,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    creationOSName: "consciously.live",
    tags,
  };
  if (photosMeta.length) json.photos = photosMeta;
  return { json, photos: photoFiles };
}

/** Day One JSON zip: `Journal.json` + `photos/{md5}.{type}`. Import via Day One Settings → Import. */
export function downloadJournalDayOneZip(entries: JournalEntry[]): void {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const dayOneEntries: Record<string, unknown>[] = [];
  const files: { name: string; bytes: Uint8Array }[] = [];
  const seenPhoto = new Set<string>();
  for (const e of sorted) {
    const { json, photos } = entryToDayOne(e);
    dayOneEntries.push(json);
    for (const p of photos) {
      if (seenPhoto.has(p.md5)) continue;
      seenPhoto.add(p.md5);
      files.push({ name: `photos/${p.md5}.${p.type}`, bytes: p.bytes });
    }
  }
  const journal = {
    metadata: { version: "1.0" },
    entries: dayOneEntries,
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(journal, null, 2));
  files.unshift({ name: "Journal.json", bytes: jsonBytes });
  const blob = buildZipBlob(files);
  downloadBlob(blob, `journal-day-one-${stamp()}.zip`);
}
