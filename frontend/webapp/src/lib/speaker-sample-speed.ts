/**
 * Voice preview samples: S3 keys `speaker-samples/<modelId>/<stem>.mp3` (Fish prosody speed).
 * Keep in sync with `backend/lib/speaker-sample-speed.ts`.
 */

export const SPEAKER_SAMPLE_SPEED_MIN = 0.75;
export const SPEAKER_SAMPLE_SPEED_MAX = 1;
export const SPEAKER_SAMPLE_SPEED_STEP = 0.05;

/** Speeds we generate and upload in the speaker-samples script. */
export const SPEAKER_PREVIEW_SPEEDS: readonly number[] = [
  0.75, 0.8, 0.85, 0.9, 0.95, 1,
];

export function snapSpeakerSampleSpeed(n: number): number {
  const k = Math.round(
    (n - SPEAKER_SAMPLE_SPEED_MIN) / SPEAKER_SAMPLE_SPEED_STEP,
  );
  let v = SPEAKER_SAMPLE_SPEED_MIN + k * SPEAKER_SAMPLE_SPEED_STEP;
  v = Math.min(
    SPEAKER_SAMPLE_SPEED_MAX,
    Math.max(SPEAKER_SAMPLE_SPEED_MIN, v),
  );
  return Math.round(v * 100) / 100;
}

/** Filename stem before `.mp3`, e.g. `0.75`, `0.9`, `1.0`. */
export function speechSpeedToSampleStem(speed: number): string {
  const n = snapSpeakerSampleSpeed(speed);
  const s = n.toFixed(2);
  if (/^\d+\.00$/.test(s)) return `${Math.trunc(n)}.0`;
  if (s.endsWith("0") && s.includes(".")) return s.slice(0, -1);
  return s;
}

export function speakerPreviewSampleKey(
  modelId: string,
  speed: number,
): string {
  return `speaker-samples/${modelId}/${speechSpeedToSampleStem(speed)}.mp3`;
}

/** Loudness-normalized preview MP3 (~-16 LUFS integrated). */
export function speakerPreviewLoudSampleKey(
  modelId: string,
  speed: number,
): string {
  return `speaker-samples/${modelId}/${speechSpeedToSampleStem(speed)}-loud.mp3`;
}

/** Processed preview (Pedalboard preset `mixer`) for the sound mixer; WAV on CDN. */
export function speakerPreviewFxSampleKey(
  modelId: string,
  speed: number,
): string {
  return `speaker-samples/${modelId}/${speechSpeedToSampleStem(speed)}-fx.wav`;
}

/** FX preview derived from the loudness-normalized MP3 input. */
export function speakerPreviewLoudFxSampleKey(
  modelId: string,
  speed: number,
): string {
  return `speaker-samples/${modelId}/${speechSpeedToSampleStem(speed)}-loud-fx.wav`;
}
