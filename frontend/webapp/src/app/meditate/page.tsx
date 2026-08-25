import { EnhancedMeditatePage } from "@/components/enhanced-meditate-page";

export const metadata = {
  title: "Meditate",
  description:
    "AI guided meditations that actually sound good. Chat through mood and intention, then generate a session with the voice, ambience, and pacing you want.",
};

/** Meditation marketing — old overview kept in `./legacy-overview.tsx` (unused). */
export default function MeditatePage() {
  return <EnhancedMeditatePage />;
}
