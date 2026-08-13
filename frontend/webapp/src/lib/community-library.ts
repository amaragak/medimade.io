import type { LibraryMeditationItem } from "./medimade-api";

/**
 * Curated Community Library entries.
 * Add popular community meditations here; they show on the Library → Community tab.
 *
 * `audioUrl` should be a playable HTTPS MP3 (e.g. CloudFront). `id` must be unique.
 */
export type CommunityLibraryEntry = {
  id: string;
  title: string;
  audioUrl: string;
  description?: string | null;
  meditationType?: string | null;
  meditationStyle?: string | null;
  speakerName?: string | null;
  durationSeconds?: number | null;
  createdAt?: string | null;
  scriptText?: string | null;
  /** Optional CDN/S3 key; defaults to `community/<id>`. */
  s3Key?: string;
};

export const COMMUNITY_LIBRARY: CommunityLibraryEntry[] = [
  // {
  //   id: "example-calm-morning",
  //   title: "Calm morning",
  //   description: "A short community favourite to start the day.",
  //   audioUrl: "https://d2ok8ugk4ei3kf.cloudfront.net/community/example.mp3",
  //   meditationType: "Breath-led",
  //   speakerName: "Tara",
  //   durationSeconds: 180,
  // },
];

export function communityLibraryAsItems(): LibraryMeditationItem[] {
  return COMMUNITY_LIBRARY.filter(
    (e) => e.id.trim() && e.title.trim() && e.audioUrl.trim(),
  ).map((e) => {
    const id = e.id.trim();
    return {
      id,
      sk: null,
      s3Key: e.s3Key?.trim() || `community/${id}`,
      audioUrl: e.audioUrl.trim(),
      title: e.title.trim(),
      meditationType: e.meditationType?.trim() || null,
      meditationStyle: e.meditationStyle?.trim() || null,
      speakerModelId: null,
      speakerName: e.speakerName?.trim() || null,
      description: e.description?.trim() || null,
      createdAt: e.createdAt?.trim() || null,
      durationSeconds:
        typeof e.durationSeconds === "number" && Number.isFinite(e.durationSeconds)
          ? e.durationSeconds
          : null,
      scriptText: e.scriptText?.trim() || null,
      scriptTruncated: false,
      scriptUtf8Bytes: null,
      rating: null,
      favourite: false,
      archived: false,
      catalogued: true,
      mp3Bytes: null,
      isDraft: false,
      liveMix: false,
      backgroundNatureKey: null,
      backgroundMusicKey: null,
      backgroundNoiseKey: null,
      backgroundNatureGain: null,
      backgroundMusicGain: null,
      backgroundNoiseGain: null,
    };
  });
}
