"use client";

import { GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TodoDraftRow = {
  id: string;
  title: string;
  /** @deprecated Kept for row shape; all listed rows are saved unless removed. */
  selected: boolean;
  /** User-laid-out steps vs model proposals. */
  kind: "yours" | "suggestion";
};

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
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const saveCount = rows.filter((r) => r.title.trim()).length;

  useEffect(() => {
    if (!editingId) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editingId]);

  function updateRow(id: string, patch: Partial<TodoDraftRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function removeRow(id: string) {
    onChange(rows.filter((r) => r.id !== id));
    if (editingId === id) setEditingId(null);
  }

  function reorderByDrag(fromId: string, toId: string) {
    if (fromId === toId) return;
    const from = rows.findIndex((r) => r.id === fromId);
    const to = rows.findIndex((r) => r.id === toId);
    if (from < 0 || to < 0) return;
    const next = [...rows];
    const [item] = next.splice(from, 1);
    if (!item) return;
    next.splice(to, 0, item);
    onChange(next);
  }

  function addRow() {
    const t = newTitle.trim();
    if (!t) return;
    const id = `draft_${Math.random().toString(16).slice(2)}`;
    onChange([
      ...rows,
      {
        id,
        title: t,
        selected: true,
        kind: "yours",
      },
    ]);
    setNewTitle("");
    setEditingId(id);
  }

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Proposed tasks
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Edit or remove anything that doesn&apos;t fit, then save what&apos;s left.
      </p>
      <ul className="mt-2">
        {rows.map((row) => {
          const isEditing = editingId === row.id;
          return (
            <li
              key={row.id}
              className={`flex flex-wrap items-center gap-2 border-b border-border/70 py-2.5 last:border-b-0 ${
                dragId === row.id ? "opacity-50" : ""
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain") || dragId;
                if (fromId) reorderByDrag(fromId, row.id);
                setDragId(null);
              }}
            >
              <button
                type="button"
                draggable
                aria-label="Drag to reorder"
                onDragStart={(e) => {
                  setDragId(row.id);
                  e.dataTransfer.setData("text/plain", row.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragId(null)}
                className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center text-muted active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={row.title}
                    onChange={(e) =>
                      updateRow(row.id, { title: e.target.value })
                    }
                    onBlur={() => setEditingId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === "Escape") {
                        e.preventDefault();
                        setEditingId(null);
                      }
                    }}
                    className="w-full border-0 bg-transparent px-1 py-1 text-sm outline-none ring-1 ring-accent/30"
                    aria-label="Edit task title"
                  />
                ) : (
                  <p className="px-1 py-1 text-sm leading-snug text-foreground">
                    {row.title.trim() || (
                      <span className="text-muted">Untitled task</span>
                    )}
                  </p>
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setEditingId(isEditing ? null : row.id)
                  }
                  className="cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline"
                >
                  {isEditing ? "Done" : "Edit"}
                </button>
                {onSpecifyRow ? (
                  <button
                    type="button"
                    disabled={specifyingId === row.id}
                    onClick={() => void onSpecifyRow(row)}
                    className="cursor-pointer text-xs font-medium text-accent-link underline-offset-2 hover:underline disabled:opacity-50"
                  >
                    {specifyingId === row.id
                      ? "Getting specific…"
                      : "Get specific"}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => removeRow(row.id)}
                  className="cursor-pointer text-xs text-muted hover:text-foreground"
                >
                  Remove
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Add your own task"
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
        disabled={saving || saveCount === 0}
        onClick={onSave}
        className="mt-3 cursor-pointer rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent-soft/20 disabled:opacity-50"
      >
        {saving
          ? "Saving…"
          : saveCount === 0
            ? "Save tasks"
            : `Save ${saveCount} task${saveCount === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
