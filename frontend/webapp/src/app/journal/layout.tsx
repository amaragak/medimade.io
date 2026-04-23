import type { ReactNode } from "react";
import { JournalInsightsAutoRefresh } from "@/components/journal-insights-autorefresh";

export default function JournalLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <JournalInsightsAutoRefresh />
      {children}
    </>
  );
}

