"use client";

import type { ReactNode } from "react";
import { JournalInsightsAutoRefresh } from "@/components/journal-insights-autorefresh";
import { JournalView } from "@/components/journal-view";

/**
 * Journal / Gratitudes / Insights share one mounted JournalView so tab switches
 * only change the URL + local section state (no remount / re-fetch).
 */
export default function JournalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JournalInsightsAutoRefresh />
      {/* Pages exist for URL + metadata; UI is owned by the persistent shell. */}
      <div className="hidden" aria-hidden>
        {children}
      </div>
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <JournalView />
      </div>
    </>
  );
}
