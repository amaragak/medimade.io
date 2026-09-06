/**
 * Curated public community sessions for the homepage Listen section.
 * Audio URLs are real generated MP3s (CloudFront). Do not invent titles or durations.
 */
export type HomepageListenSample = {
  id: string;
  title: string;
  category: string;
  durationSeconds: number;
  audioUrl: string;
};

const MEDIA_BASE = (
  process.env.NEXT_PUBLIC_MEDIMADE_MEDIA_BASE_URL?.replace(/\/$/, "") ||
  "https://d30tgo2eshgnaf.cloudfront.net"
).trim();

export const HOMEPAGE_LISTEN_SAMPLES: HomepageListenSample[] = [
  {
    id: "04fa5b91-fa0c-4351-b68d-00ee172e70b0",
    title: "Softening the Grip: A Practice in Self-Compassion",
    category: "Loving-kindness",
    durationSeconds: 95,
    audioUrl: `${MEDIA_BASE}/meditations/_/4ad91230-4ad0-4f34-9521-01bb2c32860a.mp3`,
  },
  {
    id: "b3f239a6-5528-448e-bb70-409637c4b6c3",
    title: "Following Your Breath Through the Scatter",
    category: "Breath-led",
    durationSeconds: 128,
    audioUrl: `${MEDIA_BASE}/meditations/_/0e3a06f4-cbd8-4c33-a067-f1e30c41db72.mp3`,
  },
  {
    id: "d709dad9-c7d2-40ab-86d3-60e1b38c9d00",
    title: "Full Body Scan: Release Tension and Find Inner Peace",
    category: "Body scan",
    durationSeconds: 243,
    audioUrl: `${MEDIA_BASE}/meditations/_/62af7ea0-33ea-43f4-ad46-4aabc748bbe0.mp3`,
  },
];

export function formatHomepageDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
