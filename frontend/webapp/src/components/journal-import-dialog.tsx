"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  JournalHandwrittenGroupStep,
  JournalHandwrittenReviewStep,
  type HwPhoto,
} from "@/components/journal-handwritten-import";
import {
  applyBulkDateToDrafts,
  csvTableToDrafts,
  flagDuplicates,
  importSummary,
  JOURNAL_IMPORT_SOURCES,
  parseHandwrittenPhotoImport,
  runImportParser,
  sourceLabel,
  type CsvColumnMapping,
  type CsvColumnRole,
  type CsvTable,
  type ImportKind,
  type JournalImportDraft,
  type JournalImportPreviewRow,
} from "@/lib/journal-import";
import { fileToOcrBlob, terminateOcrWorker } from "@/lib/journal-import/ocr-browser";
import { formatJournalEntryDate, type JournalEntry } from "@/lib/journal-storage";
import {
  IconBook,
  IconFileText,
  IconMarkdown,
  IconPhoto,
  IconTable,
} from "@tabler/icons-react";

const STRAIGHTFORWARD: ImportKind[] = ["markdown", "day_one", "csv"];
const AI_ASSISTED: ImportKind[] = ["pdf_annotations", "handwritten_photo"];

function SourceIcon({ kind }: { kind: ImportKind }) {
  const cls = "mt-0.5 shrink-0 text-accent-link";
  if (kind === "markdown") return <IconMarkdown size={20} className={cls} aria-hidden />;
  if (kind === "day_one") return <IconBook size={20} className={cls} aria-hidden />;
  if (kind === "csv") return <IconTable size={20} className={cls} aria-hidden />;
  if (kind === "pdf_annotations") return <IconFileText size={20} className={cls} aria-hidden />;
  return <IconPhoto size={20} className={cls} aria-hidden />;
}

type Step = "pick" | "files" | "csv" | "pdf-dates" | "photo-group" | "photo-review" | "preview";

type Props = {
  open: boolean;
  existing: JournalEntry[];
  onClose: () => void;
  onCommit: (rows: JournalImportPreviewRow[], batchId: string) => void;
};

const ROLES: { id: CsvColumnRole; label: string }[] = [
  { id: "skip", label: "Ignore" },
  { id: "title", label: "Title" },
  { id: "body", label: "Entry text" },
  { id: "date", label: "Date" },
  { id: "mood", label: "Mood" },
  { id: "tags", label: "Tags" },
];

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

export function JournalImportDialog({ open, existing, onClose, onCommit }: Props) {
  const [step, setStep] = useState<Step>("pick");
  const [kind, setKind] = useState<ImportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [csv, setCsv] = useState<CsvTable | null>(null);
  const [mapping, setMapping] = useState<CsvColumnMapping>({});
  const [rows, setRows] = useState<JournalImportPreviewRow[]>([]);
  const [pdfDrafts, setPdfDrafts] = useState<JournalImportDraft[]>([]);
  const [bulkDate, setBulkDate] = useState("");
  const [hwPhotos, setHwPhotos] = useState<HwPhoto[]>([]);
  const [hwGroups, setHwGroups] = useState<string[][]>([]);
  const [ocrProgress, setOcrProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const addPhotoRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const reset = useCallback(() => {
    setStep("pick");
    setKind(null);
    setError(null);
    setBusy(false);
    setCsv(null);
    setMapping({});
    setRows([]);
    setPdfDrafts([]);
    setBulkDate("");
    setHwPhotos((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
    setHwGroups([]);
    setOcrProgress(null);
    void terminateOcrWorker();
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const source = JOURNAL_IMPORT_SOURCES.find((s) => s.id === kind);

  const photosFromFiles = async (images: File[]): Promise<HwPhoto[]> => {
    const items: HwPhoto[] = [];
    for (const file of images) {
      const blob = await fileToOcrBlob(file);
      items.push({
        id:
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(blob),
      });
    }
    return items;
  };

  const ingestFiles = async (files: File[]) => {
    if (!kind || !files.length) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "handwritten_photo") {
        const images = files.filter(
          (f) =>
            /^image\//i.test(f.type) ||
            /\.(jpe?g|png|heic|heif)$/i.test(f.name),
        );
        if (!images.length) {
          throw new Error("Choose JPEG, PNG, or HEIC photos of your pages.");
        }
        const items = await photosFromFiles(images);
        setHwPhotos((prev) => {
          for (const p of prev) URL.revokeObjectURL(p.previewUrl);
          return items;
        });
        setHwGroups(items.map((p) => [p.id]));
        setStep("photo-group");
        return;
      }
      const result = await runImportParser(kind, files);
      if (result.csv) {
        setCsv(result.csv);
        setMapping(
          Object.fromEntries(result.csv.headers.map((_, i) => [i, "skip" as const])),
        );
        setStep("csv");
        return;
      }
      if (result.drafts) {
        if (result.pdfDatesMissing) {
          setPdfDrafts(result.drafts);
          setStep("pdf-dates");
          setError(
            "Dates could not be found in those PDFs. You can still give the whole batch one date so they land together on the timeline.",
          );
          return;
        }
        setRows(flagDuplicates(result.drafts, existing));
        setStep("preview");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read those files.");
    } finally {
      setBusy(false);
    }
  };

  const appendHandwrittenPhotos = async (files: File[]) => {
    const images = files.filter(
      (f) =>
        /^image\//i.test(f.type) ||
        /\.(jpe?g|png|heic|heif)$/i.test(f.name),
    );
    if (!images.length) return;
    setBusy(true);
    setError(null);
    try {
      const items = await photosFromFiles(images);
      setHwPhotos((prev) => [...prev, ...items]);
      setHwGroups((prev) => [...prev, ...items.map((p) => [p.id])]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add those photos.");
    } finally {
      setBusy(false);
    }
  };

  const applyCsv = () => {
    if (!csv) return;
    setBusy(true);
    setError(null);
    try {
      const drafts = csvTableToDrafts(csv, mapping);
      setRows(flagDuplicates(drafts, existing));
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not map that CSV.");
    } finally {
      setBusy(false);
    }
  };

  const applyPdfBulkDate = () => {
    const iso = dateInputToIso(bulkDate);
    if (!iso) {
      setError("Choose a date for the whole batch.");
      return;
    }
    setError(null);
    setRows(flagDuplicates(applyBulkDateToDrafts(pdfDrafts, iso), existing));
    setStep("preview");
  };

  const readHandwriting = async () => {
    setBusy(true);
    setError(null);
    setOcrProgress("Starting…");
    try {
      const byId = new Map(hwPhotos.map((p) => [p.id, p]));
      const groups = hwGroups
        .map((ids) => ({
          files: ids.map((id) => byId.get(id)?.file).filter((f): f is File => Boolean(f)),
        }))
        .filter((g) => g.files.length);
      const drafts = await parseHandwrittenPhotoImport(groups, (done, total) => {
        setOcrProgress(`Reading page ${done} of ${total}…`);
      });
      setRows(flagDuplicates(drafts, existing));
      setStep("photo-review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read those photos.");
    } finally {
      setBusy(false);
      setOcrProgress(null);
    }
  };

  const summary = importSummary(rows);
  const blocked = rows.some((r) => r.include && !r.created_at);

  const tryCommit = () => {
    setError(null);
    const batchId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `imp_${Date.now()}`;
    const missing = rows.filter((r) => r.include && !r.created_at);
    if (missing.length) {
      setError(
        "A few pages still need a date. Fill those in, or uncheck them, then save.",
      );
      return;
    }
    onCommit(rows, batchId);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="journal-import-title"
        aria-modal="true"
        tabIndex={-1}
        ref={panelRef}
        className={`flex max-h-[min(92vh,44rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl outline-none ${
          step === "photo-group" || step === "photo-review"
            ? "max-w-4xl"
            : "max-w-2xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2
              id="journal-import-title"
              className="font-display text-xl font-medium text-foreground"
            >
              Import
            </h2>
            <p className="mt-1 text-sm text-muted">
              Nothing is saved until you look it over and confirm.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft/50 hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {step === "pick" ? (
            <div className="flex flex-col gap-5">
              {(
                [
                  { title: "Straightforward", ids: STRAIGHTFORWARD },
                  {
                    title: "AI-assisted — you'll review the results",
                    ids: AI_ASSISTED,
                  },
                ] as const
              ).map((group) => (
                <div key={group.title}>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {group.title}
                  </p>
                  <div className="grid gap-1.5">
                    {group.ids.map((id) => {
                      const s = JOURNAL_IMPORT_SOURCES.find((x) => x.id === id);
                      if (!s) return null;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setKind(s.id);
                            setStep("files");
                            setError(null);
                          }}
                          className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background px-4 py-2.5 text-left hover:border-accent/40 focus-visible:border-accent/40 focus-visible:outline-none"
                        >
                          <SourceIcon kind={s.id} />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold">{s.label}</span>
                            <span className="mt-0.5 block text-sm text-muted">{s.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {step === "files" && source ? (
            <div>
              <button
                type="button"
                className="cursor-pointer text-sm font-medium text-accent-link underline-offset-2 hover:underline"
                onClick={() => {
                  setStep("pick");
                  setKind(null);
                  setError(null);
                }}
              >
                Back
              </button>
              <p className="mt-3 text-sm text-foreground">
                {source.hint}
              </p>
              <div
                className="mt-4 rounded-2xl border border-dashed border-border bg-background px-4 py-8 text-center"
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const list = Array.from(e.dataTransfer.files);
                  void ingestFiles(list);
                }}
              >
                <p className="text-sm text-muted">Drop files here, or</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    className="cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
                    onClick={() => fileRef.current?.click()}
                  >
                    Choose files
                  </button>
                  {kind === "handwritten_photo" ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-accent/40 disabled:opacity-50"
                      onClick={() => cameraRef.current?.click()}
                    >
                      Take a photo
                    </button>
                  ) : null}
                  {source.directory ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="cursor-pointer rounded-xl border border-border px-4 py-2 text-sm font-semibold hover:border-accent/40 disabled:opacity-50"
                      onClick={() => folderRef.current?.click()}
                    >
                      Choose a folder
                    </button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={source.accept}
                  multiple={source.multiple}
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void ingestFiles(list);
                  }}
                />
                {kind === "handwritten_photo" ? (
                  <input
                    ref={cameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void ingestFiles(list);
                    }}
                  />
                ) : null}
                {source.directory ? (
                  <input
                    ref={folderRef}
                    type="file"
                    className="hidden"
                    multiple
                    {...{ webkitdirectory: "" }}
                    onChange={(e) => {
                      const list = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      void ingestFiles(list);
                    }}
                  />
                ) : null}
              </div>
            </div>
          ) : null}

          {step === "csv" && csv ? (
            <div>
              <p className="text-sm text-foreground">
                Which column is the entry, and which is the date? We won’t guess.
              </p>
              <div className="mt-3 overflow-x-auto rounded-xl border border-border">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-background">
                    <tr>
                      {csv.headers.map((h, i) => (
                        <th key={i} className="border-b border-border px-2 py-2 font-semibold">
                          <div className="mb-1">{h || `Column ${i + 1}`}</div>
                          <select
                            value={mapping[i] ?? "skip"}
                            onChange={(e) =>
                              setMapping((m) => ({
                                ...m,
                                [i]: e.target.value as CsvColumnRole,
                              }))
                            }
                            className="w-full rounded-lg border border-border bg-card px-1 py-1 text-xs"
                          >
                            {ROLES.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csv.rows.slice(0, 4).map((row, ri) => (
                      <tr key={ri} className="border-b border-border last:border-0">
                        {row.map((c, ci) => (
                          <td key={ci} className="max-w-[10rem] truncate px-2 py-1.5 text-muted">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-muted">First few rows, so you can check the mapping.</p>
            </div>
          ) : null}

          {step === "pdf-dates" ? (
            <div>
              <p className="text-sm text-foreground">
                {pdfDrafts.length}{" "}
                {pdfDrafts.length === 1 ? "page" : "pages"} came through, but no
                dates we could trust. Set one date for all of them — not perfect,
                but they keep a place on the timeline.
              </p>
              <label className="mt-4 block text-sm font-medium">
                Date for this batch
                <input
                  type="date"
                  value={bulkDate}
                  onChange={(e) => setBulkDate(e.target.value)}
                  className="mt-1.5 block w-full max-w-xs rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent/50"
                />
              </label>
            </div>
          ) : null}

          {step === "photo-group" ? (
            <JournalHandwrittenGroupStep
              photos={hwPhotos}
              groups={hwGroups}
              onGroupsChange={setHwGroups}
              onRead={() => void readHandwriting()}
              onAddPhotos={() => addPhotoRef.current?.click()}
              busy={busy}
            />
          ) : null}

          {step === "photo-review" ? (
            <JournalHandwrittenReviewStep
              rows={rows}
              onRowsChange={setRows}
            />
          ) : null}

          {step === "preview" ? (
            <div>
              <p className="text-sm text-foreground">
                {summary.count} {summary.count === 1 ? "entry" : "entries"}
                {summary.dateRange ? ` · ${summary.dateRange}` : ""}
                {summary.duplicates
                  ? ` · ${summary.duplicates} look like they may already be here`
                  : ""}
              </p>
              {summary.mediaSkipped ? (
                <p className="mt-2 rounded-xl bg-accent-soft/40 px-3 py-2 text-sm text-foreground">
                  Photos and other media weren’t imported this time — only the words and dates.
                  References are kept so we can bring media in later.
                </p>
              ) : null}
              {summary.uncertainDates ? (
                <p className="mt-2 text-sm text-muted">
                  Some pages don’t have a sure date. Add one, or leave them unchecked.
                </p>
              ) : null}
              <ul className="mt-4 space-y-3">
                {rows.map((r) => (
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
                          setRows((prev) =>
                            prev.map((x) =>
                              x.key === r.key ? { ...x, include: on } : x,
                            ),
                          );
                        }}
                        className="mt-1 h-4 w-4 accent-[var(--selected)]"
                      />
                      <div className="min-w-0 flex-1">
                        <input
                          type="text"
                          value={r.title ?? ""}
                          onChange={(e) => {
                            const title = e.target.value;
                            setRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key ? { ...x, title } : x,
                              ),
                            );
                          }}
                          placeholder="Untitled entry"
                          className="w-full border-0 bg-transparent text-sm font-semibold outline-none"
                        />
                        <textarea
                          value={r.body}
                          onChange={(e) => {
                            const body = e.target.value;
                            setRows((prev) =>
                              prev.map((x) =>
                                x.key === r.key ? { ...x, body } : x,
                              ),
                            );
                          }}
                          rows={3}
                          className="mt-1 w-full resize-y rounded-lg border border-border bg-card px-2 py-1.5 text-sm outline-none"
                        />
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                          <label className="flex items-center gap-1.5">
                            Date
                            <input
                              type="date"
                              value={isoToDateInput(r.created_at)}
                              onChange={(e) => {
                                const created_at = dateInputToIso(e.target.value);
                                setRows((prev) =>
                                  prev.map((x) =>
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
                          <span>{sourceLabel(r.source)}</span>
                          {r.date_uncertain || !r.created_at ? (
                            <span className="font-medium text-accent-link">
                              Date uncertain
                            </span>
                          ) : (
                            <span>
                              {r.created_at
                                ? formatJournalEntryDate(r.created_at)
                                : null}
                            </span>
                          )}
                        </div>
                        {r.likelyDuplicate ? (
                          <p className="mt-1 text-xs text-accent-link">
                            Close to {r.duplicateHint}. Unchecked by default — tick it if you still want it.
                          </p>
                        ) : null}
                        {r.media_refs.length && r.source !== "handwritten_photo" ? (
                          <p className="mt-1 text-xs text-muted">
                            {r.media_refs.length} media{" "}
                            {r.media_refs.length === 1 ? "file" : "files"} noted, not imported.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
          <input
            ref={addPhotoRef}
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = "";
              void appendHandwrittenPhotos(list);
            }}
          />
          {busy ? (
            <p className="mt-3 text-sm text-muted">
              {kind === "pdf_annotations"
                ? "Reading annotations and asking Haiku to date them…"
                : kind === "handwritten_photo"
                  ? ocrProgress || "Reading your handwriting…"
                  : "Reading…"}
            </p>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-6 py-3">
          {step === "csv" ? (
            <button
              type="button"
              disabled={busy}
              onClick={applyCsv}
              className="cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
            >
              Preview entries
            </button>
          ) : null}
          {step === "pdf-dates" ? (
            <button
              type="button"
              disabled={!bulkDate}
              onClick={applyPdfBulkDate}
              className="cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
            >
              Use this date for all
            </button>
          ) : null}
          {step === "photo-review" || step === "preview" ? (
            <button
              type="button"
              disabled={busy || blocked || summary.count === 0}
              onClick={tryCommit}
              className="cursor-pointer rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-on-accent disabled:opacity-50"
            >
              Save {summary.count} {summary.count === 1 ? "entry" : "entries"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
