"use client";

import { OCR_LOW_CONFIDENCE, type OcrWord } from "@/lib/journal-import/ocr-browser";
import type { JournalImportPreviewRow } from "@/lib/journal-import/types";
import { formatJournalEntryDate } from "@/lib/journal-storage";

export type HwPhoto = {
  id: string;
  file: File;
  previewUrl: string;
};

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(`${v}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function spansFromMeta(meta: Record<string, unknown>): OcrWord[] {
  const raw = meta.ocr_spans;
  if (!Array.isArray(raw)) return [];
  const out: OcrWord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o.text !== "string" || !o.text) continue;
    out.push({
      text: o.text,
      confidence: typeof o.confidence === "number" ? o.confidence : null,
    });
  }
  return out;
}

export function JournalHandwrittenGroupStep({
  photos,
  groups,
  onGroupsChange,
  onRead,
  onAddPhotos,
  busy,
}: {
  photos: HwPhoto[];
  groups: string[][];
  onGroupsChange: (next: string[][]) => void;
  onRead: () => void;
  onAddPhotos?: () => void;
  busy?: boolean;
}) {
  const byId = new Map(photos.map((p) => [p.id, p]));

  const movePhoto = (photoId: string, toGroupIndex: number) => {
    const stripped = groups
      .map((g) => g.filter((id) => id !== photoId))
      .filter((g) => g.length);
    const next = [...stripped];
    const target = Math.max(0, Math.min(toGroupIndex, next.length));
    if (next[target]) {
      next[target] = [...next[target], photoId];
    } else {
      next.push([photoId]);
    }
    onGroupsChange(next.length ? next : [[photoId]]);
  };

  return (
    <div>
      <p className="text-sm text-foreground">
        Each stack becomes one journal page. Drag a photo onto another stack to
        join a long entry (page 1, page 2). Leave them apart if they’re separate
        days.
      </p>
      <p className="mt-2 text-xs text-muted">
        Photos are sent to Amazon Textract to read the handwriting, then you
        check the words. A live camera crop (like a scanner app) isn’t in this
        pass.
      </p>
      <ul className="mt-4 space-y-3">
        {groups.map((ids, gi) => (
          <li
            key={`g-${gi}-${ids.join("-")}`}
            className="rounded-xl border border-border bg-background p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("text/photo-id");
              if (id) movePhoto(id, gi);
            }}
          >
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-muted">
                Entry {gi + 1}
                {ids.length > 1 ? ` · ${ids.length} pages` : ""}
              </span>
              <div className="flex flex-wrap gap-1">
                {gi < groups.length - 1 ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/40"
                    onClick={() => {
                      const next = [...groups];
                      next[gi] = [...next[gi], ...next[gi + 1]];
                      next.splice(gi + 1, 1);
                      onGroupsChange(next);
                    }}
                  >
                    Join with next
                  </button>
                ) : null}
                {ids.length > 1 ? (
                  <button
                    type="button"
                    className="cursor-pointer rounded-lg border border-border px-2 py-1 text-xs hover:border-accent/40"
                    onClick={() => {
                      const rest = groups.filter((_, i) => i !== gi);
                      onGroupsChange([...rest, ...ids.map((id) => [id])]);
                    }}
                  >
                    Split pages
                  </button>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {ids.map((id, pi) => {
                const p = byId.get(id);
                if (!p) return null;
                return (
                  <div
                    key={id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/photo-id", id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className="relative cursor-grab"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.previewUrl}
                      alt={p.file.name}
                      className="h-24 w-20 rounded-lg object-cover ring-1 ring-border"
                    />
                    <span className="absolute bottom-1 left-1 rounded bg-overlay/80 px-1 text-[10px] text-on-accent">
                      {pi + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {onAddPhotos ? (
          <button
            type="button"
            disabled={busy}
            onClick={onAddPhotos}
            className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-accent/40 disabled:opacity-50"
          >
            Add photos
          </button>
        ) : null}
        <button
          type="button"
          disabled={busy || photos.length === 0}
          onClick={onRead}
          className="cursor-pointer rounded-xl accent-fill-gradient px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
        >
          Read handwriting
        </button>
      </div>
    </div>
  );
}

export function JournalHandwrittenReviewStep({
  rows,
  onRowsChange,
}: {
  rows: JournalImportPreviewRow[];
  onRowsChange: (next: JournalImportPreviewRow[]) => void;
}) {
  return (
    <div>
      <p className="text-sm text-foreground">
        We’ve done our best reading your handwriting — have a look and fix
        anything that’s off. Underlined words are the ones we’re least sure of.
      </p>
      <p className="mt-2 text-xs text-muted">
        Handwriting is harder than typed pages. English and Latin script only
        for now. Photos stay attached so you can check the original later.
      </p>
      <ul className="mt-4 space-y-5">
        {rows.map((r) => {
          const spans = spansFromMeta(r.source_metadata);
          const hasScores = spans.some((s) => s.confidence != null);
          return (
            <li
              key={r.key}
              className="rounded-xl border border-border bg-background p-3"
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={r.include}
                  onChange={(e) => {
                    const on = e.target.checked;
                    onRowsChange(
                      rows.map((x) =>
                        x.key === r.key ? { ...x, include: on } : x,
                      ),
                    );
                  }}
                  className="mt-1 h-4 w-4 accent-[var(--selected)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-wrap gap-2">
                      {r.media_refs.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={src}
                          alt={`Page ${i + 1}`}
                          className="max-h-56 max-w-full rounded-lg object-contain ring-1 ring-border"
                        />
                      ))}
                    </div>
                    <div>
                      {hasScores && spans.length ? (
                        <p className="mb-2 max-h-28 overflow-y-auto text-sm leading-relaxed text-foreground">
                          {spans.map((s, i) => {
                            const low =
                              s.confidence != null &&
                              s.confidence < OCR_LOW_CONFIDENCE;
                            return (
                              <span
                                key={i}
                                className={
                                  low
                                    ? "underline decoration-wavy decoration-accent-link underline-offset-2"
                                    : undefined
                                }
                              >
                                {s.text}{" "}
                              </span>
                            );
                          })}
                        </p>
                      ) : null}
                      <textarea
                        value={r.body}
                        onChange={(e) => {
                          const body = e.target.value;
                          onRowsChange(
                            rows.map((x) =>
                              x.key === r.key ? { ...x, body } : x,
                            ),
                          );
                        }}
                        rows={8}
                        placeholder="Type what you see if the reading came out empty."
                        className="w-full resize-y rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <label className="flex items-center gap-1.5">
                      Date
                      <input
                        type="date"
                        value={isoToDateInput(r.created_at)}
                        onChange={(e) => {
                          const created_at = dateInputToIso(e.target.value);
                          onRowsChange(
                            rows.map((x) =>
                              x.key === r.key
                                ? {
                                    ...x,
                                    created_at,
                                    date_uncertain: !created_at,
                                  }
                                : x,
                            ),
                          );
                        }}
                        className="rounded-lg border border-border bg-card px-2 py-1"
                      />
                    </label>
                    {r.date_uncertain || !r.created_at ? (
                      <span className="font-medium text-accent-link">
                        Date uncertain — no capture time on the photo
                      </span>
                    ) : (
                      <span>
                        {r.created_at
                          ? formatJournalEntryDate(r.created_at)
                          : null}
                      </span>
                    )}
                    {!r.body.trim() ? (
                      <span className="font-medium text-accent-link">
                        We couldn’t make out words on this page
                      </span>
                    ) : null}
                  </div>
                  {r.likelyDuplicate ? (
                    <p className="mt-1 text-xs text-accent-link">
                      Close to {r.duplicateHint}. Unchecked by default — tick it
                      if you still want it.
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
