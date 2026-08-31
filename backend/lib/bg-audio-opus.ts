/**
 * Ogg Opus encode settings for background-audio beds.
 *
 * Beds loop continuously in the player. Opus carries pre-skip/end-trim in the
 * container, so a looped bed has no encoder padding at the seam — unlike MP3,
 * where LAME delay/padding is audible on every cycle. MP3 stays as the
 * fallback for browsers without Ogg Opus support.
 */

export const OPUS_CONTENT_TYPE = "audio/ogg";
export const OPUS_EXTENSION = ".opus";

/** Transparent for ambient/music beds without inflating long files. */
const OPUS_BITRATE = "128k";

export function opusEncodeArgs(inputPath: string, outputPath: string): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-c:a",
    "libopus",
    "-b:a",
    OPUS_BITRATE,
    "-vbr",
    "on",
    "-application",
    "audio",
    // Opus is always 48 kHz internally; resampling up front keeps ffmpeg from
    // picking a different rate per source file.
    "-ar",
    "48000",
    outputPath,
  ];
}

/** `background-audio/foo.mp3` / `.wav` → `background-audio/foo.opus`. */
export function opusKeyForStem(key: string): string | null {
  const lower = key.toLowerCase();
  if (!lower.endsWith(".mp3") && !lower.endsWith(".wav")) return null;
  return `${key.slice(0, -4)}${OPUS_EXTENSION}`;
}
