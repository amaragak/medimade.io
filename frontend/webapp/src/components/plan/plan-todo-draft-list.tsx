"use client";

import { useState } from "react";

export type TodoDraftRow = { id: string; title: string };

type Props = {
  rows: TodoDraftRow[];
  onChange: (rows: TodoDraftRow[]) => void;
  onSpecifyRow?: (row: TodoDraftRow) => Promise<void>;
  specifyingId?: string | null;
  onSave: () => void;
  saving?: boolean;
};

export function PlanTodoDraftList({
  rows,
  onChange,
  onSpecifyRow,
  specifyingId,
  onSave,
  saving = false,
}: Props) {
  const [newTitle, setNewTitle] = useState("");

  function updateRow(id: string, title: string) {
    onChange(rows.map((r) => (r.id === id ? { ...r, title } : r)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
  }

  function moveRow(id: string, dir: -1 | 1) {
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
    onChange(next);
  }

  function addRow() {
    const t = newTitle.trim();
    if (!t) return;
    onChange([
      ...rows,
      { id: `draft_${Math.random().toString(16).slice(2)}`, title: t },
    ]);
    setNewTitle("");
  }

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-border bg-card/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Proposed steps
      </p>
      <p className="text-xs leading-relaxed text-muted">
        Broad strokes — edit any line, or get specific on one when you&apos;re ready.
      </p>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-background px-2 py-2"
          >
            <input
              value={row.title}
              onChange={(e) => updateRow(row.id, e.target.value)}
              className="min-w-0 flex-1 rounded-lg border-0 bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-accent/30"
            />
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label="Move up"
                onClick={() => moveRow(row.id, -1)}
                className="cursor-pointer rounded-lg px-2 py-1 text-xs text-muted hover:bg-accent-soft/30"
              >
                ↑
              </button>
              <button
                type="button"
                aria-label="Move down"
                onClick={() => moveRow(row.id, 1)}
                className="cursor-pointer rounded-lg px-2 py-1 text-xs text-muted hover:bg-accent-soft/30"
              >
                ↓
              </button>
              {onSpecifyRow ? (
                <button
                  type="button"
                  disabled={specifyingId === row.id}
                  onClick={() => void onSpecifyRow(row)}
                  className="cursor-pointer rounded-lg px-2 py-1 text-xs font-medium text-accent-link hover:bg-accent-soft/30 disabled:opacity-50"
                >
                  {specifyingId === row.id ? "Getting specific…" : "Get specific"}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => removeRow(row.id)}
                className="cursor-pointer rounded-lg px-2 py-1 text-xs text-muted hover:bg-accent-soft/30"
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add your own step"
          className="min-w-[12rem] flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/25 focus:ring-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addRow();
            }
          }}
        />
        <button
          type="button"
          onClick={() => addRow()}
          className="cursor-pointer rounded-full border border-border px-3 py-2 text-sm font-medium hover:bg-accent-soft/20"
        >
          Add
        </button>
      </div>
      <button
        type="button"
        disabled={saving || rows.length === 0 || rows.every((r) => !r.title.trim())}
        onClick={onSave}
        className="cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save as todos"}
      </button>
    </div>
  );
}
