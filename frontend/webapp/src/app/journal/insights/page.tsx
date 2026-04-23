import { JournalInsightsView } from "@/components/journal-insights-view";

export const metadata = {
  title: "Journal insights",
};

export default function JournalInsightsPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <JournalInsightsView />
    </div>
  );
}

