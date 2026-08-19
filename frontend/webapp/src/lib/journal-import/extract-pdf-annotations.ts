"use client";

export type PdfAnnotationUnit = {
  fileName: string;
  page: number;
  type: string;
  contents: string;
  pageText: string;
  annotDate: string | null;
};

function pdfDateToIso(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = /D:(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!m) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function itemInRect(
  x: number,
  y: number,
  rect: number[],
): boolean {
  if (rect.length < 4) return false;
  const x1 = Math.min(rect[0], rect[2]);
  const x2 = Math.max(rect[0], rect[2]);
  const y1 = Math.min(rect[1], rect[3]);
  const y2 = Math.max(rect[1], rect[3]);
  return x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 8 && y <= y2 + 8;
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  return pdfjs;
}

export async function extractPdfAnnotationUnits(
  files: File[],
): Promise<PdfAnnotationUnit[]> {
  const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
  if (!pdfs.length) {
    throw new Error("Choose one or more PDF files.");
  }
  const pdfjs = await loadPdfjs();
  const units: PdfAnnotationUnit[] = [];

  for (const file of pdfs) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data: buf }).promise;
    try {
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const annots = (await page.getAnnotations()) as Array<Record<string, unknown>>;
        const textContent = await page.getTextContent();
        const items = (textContent.items ?? []) as Array<{
          str?: string;
          transform?: number[];
        }>;
        const pageText = items
          .map((it) => (typeof it.str === "string" ? it.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 2500);

        const real = annots.filter((a) => {
          const subtype = String(a.subtype ?? a.annotationType ?? "");
          return subtype && subtype !== "Link" && subtype !== "Widget";
        });

        if (!real.length) continue;

        for (const a of real) {
          const subtype = String(a.subtype ?? "Annot");
          const contents =
            typeof a.contents === "string"
              ? a.contents
              : typeof a.contentsObj === "object" &&
                  a.contentsObj &&
                  "str" in (a.contentsObj as object)
                ? String((a.contentsObj as { str?: string }).str ?? "")
                : "";
          const rect = Array.isArray(a.rect)
            ? (a.rect as number[])
            : [];
          const highlighted = items
            .filter((it) => {
              const tr = it.transform;
              if (!tr || tr.length < 6) return false;
              return itemInRect(tr[4], tr[5], rect);
            })
            .map((it) => it.str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          units.push({
            fileName: file.name,
            page: p,
            type: subtype,
            contents: (contents || highlighted).trim().slice(0, 4000),
            pageText,
            annotDate: pdfDateToIso(a.modificationDate ?? a.creationDate),
          });
        }
      }
    } finally {
      await doc.destroy();
    }
  }

  if (!units.length) {
    throw new Error(
      "No annotation layer found in those PDFs. Highlights that are just coloured rectangles on the page (not real PDF notes) can’t be read. Sticky notes, true highlights, and typed comments can.",
    );
  }

  const hasWords = units.some(
    (u) => u.contents.trim().length > 0 || u.pageText.trim().length > 0,
  );
  if (!hasWords) {
    throw new Error(
      "Those PDFs have markup, but no readable text. Handwritten ink often isn’t stored as words.",
    );
  }

  return units;
}
