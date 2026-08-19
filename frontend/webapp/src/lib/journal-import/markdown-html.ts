export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMarkdown(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/** Light markdown → journal HTML. Not a full CommonMark parser. */
export function markdownToJournalHtml(md: string): string {
  const text = md.replace(/\r\n/g, "\n").trim();
  if (!text) return "<p></p>";
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let listKind: "ul" | "ol" | null = null;
  const closeList = () => {
    if (listKind) {
      out.push(listKind === "ul" ? "</ul>" : "</ol>");
      listKind = null;
    }
  };
  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      i += 1;
      continue;
    }
    const h = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (h) {
      closeList();
      const level = Math.min(3, h[1].length) + 1;
      const tag = level === 2 ? "h2" : "h3";
      out.push(`<${tag}>${inlineMarkdown(escapeHtmlText(h[2].trim()))}</${tag}>`);
      i += 1;
      continue;
    }
    const ul = /^[-*+]\s+(.+)$/.exec(line.trim());
    if (ul) {
      if (listKind !== "ul") {
        closeList();
        listKind = "ul";
        out.push("<ul>");
      }
      out.push(`<li>${inlineMarkdown(escapeHtmlText(ul[1]))}</li>`);
      i += 1;
      continue;
    }
    const ol = /^\d+[.)]\s+(.+)$/.exec(line.trim());
    if (ol) {
      if (listKind !== "ol") {
        closeList();
        listKind = "ol";
        out.push("<ol>");
      }
      out.push(`<li>${inlineMarkdown(escapeHtmlText(ol[1]))}</li>`);
      i += 1;
      continue;
    }
    closeList();
    const para: string[] = [line];
    i += 1;
    while (i < lines.length) {
      const n = (lines[i] ?? "").trimEnd();
      if (!n.trim()) break;
      if (/^(#{1,3})\s+/.test(n.trim())) break;
      if (/^[-*+]\s+/.test(n.trim())) break;
      if (/^\d+[.)]\s+/.test(n.trim())) break;
      para.push(n);
      i += 1;
    }
    out.push(
      `<p>${inlineMarkdown(escapeHtmlText(para.join(" ")))}</p>`,
    );
  }
  closeList();
  return out.length ? out.join("") : "<p></p>";
}
