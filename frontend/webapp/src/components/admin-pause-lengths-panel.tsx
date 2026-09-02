"use client";

import { useEffect, useState } from "react";
import {
  listAdminVoice,
  patchAdminVoice,
  type AdminPauseBands,
} from "@/lib/medimade-api";

const PAUSE_FIELDS: Array<{ id: keyof AdminPauseBands; label: string }> = [
  { id: "extra-short", label: "Extra short" },
  { id: "short", label: "Short" },
  { id: "medium", label: "Medium" },
  { id: "long", label: "Long" },
  { id: "extra-long", label: "Extra long" },
];

export function AdminPauseLengthsPanel(props: {
  onPausesChange?: (pauses: AdminPauseBands) => void;
}) {
  const [pauses, setPauses] = useState<AdminPauseBands | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listAdminVoice()
      .then((data) => {
        setPauses(data.pauses);
        props.onPausesChange?.(data.pauses);
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : "Could not load pause lengths"),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  async function savePauses() {
    if (!pauses) return;
    setPauseBusy(true);
    setError(null);
    try {
      const res = await patchAdminVoice({ pauses });
      if (res.pauses) {
        setPauses(res.pauses);
        props.onPausesChange?.(res.pauses);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save pauses");
    } finally {
      setPauseBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h2 className="font-display text-lg font-medium">Pause lengths</h2>
      <p className="mt-1 text-xs text-muted">
        Seconds of silence for each <code>[[PAUSE …]]</code> band in generated scripts and duration
        estimates.
      </p>
      {error ? (
        <p className="mt-2 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {pauses ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-5">
          {PAUSE_FIELDS.map((f) => (
            <label key={f.id} className="block text-xs font-medium text-muted">
              {f.label}
              <input
                type="number"
                min={0.2}
                max={120}
                step={0.1}
                value={pauses[f.id]}
                onChange={(e) =>
                  setPauses((p) => (p ? { ...p, [f.id]: Number(e.target.value) } : p))
                }
                className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Loading pause bands…</p>
      )}
      <button
        type="button"
        disabled={!pauses || pauseBusy}
        onClick={() => void savePauses()}
        className="mt-4 cursor-pointer rounded-full bg-accent-soft px-4 py-2 text-xs font-semibold text-accent-link disabled:opacity-50"
      >
        {pauseBusy ? "Saving…" : "Save pause lengths"}
      </button>
    </section>
  );
}
