import { JournalView } from "@/components/journal-view";

export const metadata = {
  title: "Journal",
};

export default function JournalPage() {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <JournalView />
    </div>
  );
}
