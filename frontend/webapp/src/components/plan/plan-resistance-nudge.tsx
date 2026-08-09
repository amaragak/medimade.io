"use client";

import { useEffect, useState } from "react";
import { classifyResistanceText } from "@/lib/plan-breakdown-claude";
import type { ResistanceCategory } from "@/lib/plan-ideate-store";
import {
  RESISTANCE_CHIP_OPTIONS,
  addResistanceEntry,
  loadIdeateStore,
  saveIdeateStore,
  type IdeateTodo,
} from "@/lib/plan-ideate-store";
import { pickNudgeCopy } from "@/lib/plan-stalled-todos";

type Props = {
  todo: IdeateTodo;
  projectId: string;
  subtaskId: string;
  copySeed: string;
  onDismiss: () => void;
  onRecorded: () => void;
};

export function PlanResistanceNudge({
  todo,
  projectId,
  subtaskId,
  copySeed,
  onDismiss,
  onRecorded,
}: Props) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedChip, setSelectedChip] = useState<ResistanceCategory | null>(
    null,
  );

  useEffect(() => {
    const store = loadIdeateStore();
    const t = store.todos.find((x) => x.id === todo.id);
    if (!t) return;
    saveIdeateStore({
      ...store,
      todos: store.todos.map((x) =>
        x.id === todo.id
          ? { ...x, stalledNudgeShownAt: new Date().toISOString() }
          : x,
      ),
    });
  }, [todo.id]);

  async function submit(category: ResistanceCategory | null) {
    const body = text.trim();
    if (!body && !category) return;
    setSubmitting(true);
    let store = loadIdeateStore();
    store = addResistanceEntry(store, {
      level: "todo",
      projectId,
      subtaskId,
      todoId: todo.id,
      text: body || RESISTANCE_CHIP_OPTIONS.find((c) => c.category === category)?.label || "—",
      category,
    });
    saveIdeateStore(store);
    onRecorded();
    setSubmitting(false);
    onDismiss();
    const note = body || category || "";
    if (note && !category) {
      void classifyResistanceText(note).then((inferred) => {
        if (!inferred) return;
        let s = loadIdeateStore();
        const entries = s.resistanceEntries;
        const last = entries[entries.length - 1];
        if (!last || last.todoId !== todo.id) return;
        s = {
          ...s,
          resistanceEntries: entries.map((e, i) =>
            i === entries.length - 1 ? { ...e, category: inferred } : e,
          ),
        };
        saveIdeateStore(s);
      });
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-accent/15 bg-accent-soft/10 px-3 py-3">
      <p className="font-hand text-sm italic leading-relaxed text-foreground/90">
        {pickNudgeCopy(copySeed)}
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        placeholder="Say it plainly, if you want to."
        className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none ring-accent/25 focus:ring-2"
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {RESISTANCE_CHIP_OPTIONS.map((chip) => (
          <button
            key={chip.category}
            type="button"
            onClick={() => {
              setSelectedChip(chip.category);
              if (chip.category !== "other") {
                void submit(chip.category);
              }
            }}
            className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors ${
              selectedChip === chip.category
                ? "border-accent/40 bg-accent-soft/35"
                : "border-border hover:border-accent/25"
            }`}
          >
            {chip.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={submitting || (!text.trim() && !selectedChip)}
          onClick={() => void submit(selectedChip)}
          className="cursor-pointer rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent-soft/20 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Share"}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="cursor-pointer rounded-full px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          Close
        </button>
      </div>
    </div>
  );
}
