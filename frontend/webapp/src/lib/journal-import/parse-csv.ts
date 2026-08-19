import type { CsvTable } from "@/lib/journal-import/types";

function parseRow(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells;
}

export function parseCsvText(text: string): CsvTable {
  const lines = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  const nonempty = lines.filter((l) => l.trim().length > 0);
  if (!nonempty.length) return { headers: [], rows: [] };
  const headers = parseRow(nonempty[0]).map((h) => h.trim());
  const width = headers.length;
  const rows: string[][] = [];
  for (const line of nonempty.slice(1)) {
    const cells = parseRow(line);
    while (cells.length < width) cells.push("");
    rows.push(cells.slice(0, width));
  }
  return { headers, rows };
}
