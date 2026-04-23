"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import {
  fetchJournalInsightsRemote,
  getMedimadeApiBase,
  getMedimadeSessionJwt,
  runJournalInsightsRemote,
} from "@/lib/medimade-api";
import { loadJournalStore } from "@/lib/journal-storage";

function maxUpdatedAtIso(): string | null {
  try {
    const store = loadJournalStore();
    if (!store.entries.length) return null;
    let max = 0;
    for (const e of store.entries) {
      const t = new Date(e.updatedAt).getTime();
      if (Number.isFinite(t) && t > max) max = t;
    }
    return max ? new Date(max).toISOString() : null;
  } catch {
    return null;
  }
}

function isJournalEditorPath(p: string): boolean {
  return p === "/journal";
}

const inFlightRef = { current: false };
const lastTriggeredForUpdatedAtRef = { current: null as string | null };

/**
 * Run after the user leaves the journal editor context (navigate away from
 * `/journal`, or close the inline Insights panel on the journal page).
 */
export function scheduleJournalInsightsRefreshAfterLeavingEditor(): void {
  const base = getMedimadeApiBase();
  if (!base) return;
  if (!getMedimadeSessionJwt()) return;

  const localMax = maxUpdatedAtIso();
  if (!localMax) return;
  if (lastTriggeredForUpdatedAtRef.current === localMax) return;
  if (inFlightRef.current) return;
  inFlightRef.current = true;

  void (async () => {
    try {
      const existing = await fetchJournalInsightsRemote();
      const lastProcessed = existing?.meta.lastProcessedMaxUpdatedAt ?? null;
      const localMs = new Date(localMax).getTime();
      const processedMs = lastProcessed ? new Date(lastProcessed).getTime() : 0;
      if (!Number.isFinite(localMs)) return;
      if (localMs <= processedMs) return;
      lastTriggeredForUpdatedAtRef.current = localMax;
      await runJournalInsightsRemote();
    } catch {
      /* ignore: navigation-triggered background refresh */
    } finally {
      inFlightRef.current = false;
    }
  })();
}

export function JournalInsightsAutoRefresh() {
  const pathname = usePathname() || "/";
  const prevPathRef = useRef<string>(pathname);

  useEffect(() => {
    const prev = prevPathRef.current;
    if (prev === pathname) return;
    prevPathRef.current = pathname;

    if (!isJournalEditorPath(prev) || isJournalEditorPath(pathname)) return;
    scheduleJournalInsightsRefreshAfterLeavingEditor();
  }, [pathname]);

  return null;
}
