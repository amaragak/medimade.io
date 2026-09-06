"use client";

import { useEffect } from "react";
import {
  downloadJournalBackupJson,
  downloadJournalDayOneZip,
  downloadJournalPlainText,
  printJournalPdf,
} from "@/lib/journal-export";
import type { JournalEntry, JournalStoreV2 } from "@/lib/journal-storage";
import { JournalPinLockCheckbox } from "@/components/journal-lock-gate";

type Props = {
  open: boolean;
  onClose: () => void;
  entries: JournalEntry[];
  store: JournalStoreV2;
};

export function JournalSettingsDialog({
  open,
  onClose,
  entries,
  store,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/45 p-4 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-labelledby="journal-settings-title"
        aria-modal="true"
        className="max-h-[min(90vh,36rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2
            id="journal-settings-title"
            className="font-display text-xl font-medium text-foreground"
          >
            Journal settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft/50 hover:text-foreground"
          >
            Close
          </button>
        </div>

        <section className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Privacy
          </h3>
          <div className="mt-2">
            <JournalPinLockCheckbox />
          </div>
        </section>

        <section className="mt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Export
          </h3>
          <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <ExportBtn onClick={() => downloadJournalPlainText(entries)}>
              Plain text
            </ExportBtn>
            <ExportBtn onClick={() => printJournalPdf(entries)}>
              PDF
            </ExportBtn>
            <ExportBtn onClick={() => downloadJournalBackupJson(store)}>
              JSON backup
            </ExportBtn>
            <ExportBtn onClick={() => downloadJournalDayOneZip(entries)}>
              Day One
            </ExportBtn>
          </div>
        </section>
      </div>
    </div>
  );
}

function ExportBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-xl border border-border bg-background px-3 py-2 text-left text-sm font-medium hover:border-accent/40"
    >
      {children}
    </button>
  );
}

export function IconSettingsCog({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
