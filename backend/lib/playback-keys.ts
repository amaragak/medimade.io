const MEDITATIONS_PREFIX = "meditations/";

/**
 * Library + job polling: stream from MP3 even when a lossless `meditations/*.wav`
 * sibling exists in S3 (pro tier later).
 */
export function meditationPlaybackS3Key(key: string): string {
  const k = key.trim();
  const lower = k.toLowerCase();
  if (!lower.startsWith(MEDITATIONS_PREFIX) || !lower.endsWith(".wav")) return k;
  return `${k.slice(0, -4)}.mp3`;
}

/** Rewrite `…/meditations/*.wav` URL to `.mp3` for the same stem. */
export function meditationPlaybackAudioUrl(audioUrl: string): string {
  const u = audioUrl.trim();
  if (!u) return u;
  try {
    const parsed = new URL(u);
    const path = parsed.pathname;
    const lower = path.toLowerCase();
    if (!lower.startsWith("/meditations/") || !lower.endsWith(".wav")) return u;
    parsed.pathname = path.replace(/\.wav$/i, ".mp3");
    return parsed.toString();
  } catch {
    return u;
  }
}
