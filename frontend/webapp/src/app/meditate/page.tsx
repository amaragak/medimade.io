import { EnhancedHomePage } from "@/components/enhanced-home-page";

export const metadata = {
  title: "Meditate",
  description:
    "AI guided meditations that actually sound good. Chat through mood and intention, then generate a session with the voice, ambience, and pacing you want.",
};

/** Same enhanced homepage as `/` — old overview kept in `./legacy-overview.tsx` (unused). */
export default function MeditatePage() {
  return <EnhancedHomePage />;
}
