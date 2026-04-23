/**
 * Voice preview samples — keep in sync with `frontend/webapp/src/lib/speaker-sample-speed.ts`.
 */

export const SPEAKER_SAMPLE_SPEED_MIN = 0.75;
export const SPEAKER_SAMPLE_SPEED_MAX = 1;
export const SPEAKER_SAMPLE_SPEED_STEP = 0.05;

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

/** Fish TTS prosody speed for previews and jobs (fixed; no UI control). */
export const FIXED_SPEECH_PREVIEW_SPEED = snapSpeakerSampleSpeed(0.9);

/** Filename stem before `.mp3`, e.g. `0.75`, `0.9`, `1.0`. */
export function speechSpeedToSampleStem(speed: number): string {
  const n = snapSpeakerSampleSpeed(speed);
  const s = n.toFixed(2);
  if (/^\d+\.00$/.test(s)) return `${Math.trunc(n)}.0`;
  if (s.endsWith("0") && s.includes(".")) return s.slice(0, -1);
  return s;
}

export function speakerPreviewLoudSampleKey(
  modelId: string,
  speed: number,
): string {
  return `speaker-samples/${modelId}/${speechSpeedToSampleStem(speed)}-loud.mp3`;
}

/** FX preview derived from the loudness-normalized MP3 input (WAV on CDN). */
export function speakerPreviewLoudFxSampleKey(
  modelId: string,
  speed: number,
): string {
  return `speaker-samples/${modelId}/${speechSpeedToSampleStem(speed)}-loud-fx.wav`;
}
