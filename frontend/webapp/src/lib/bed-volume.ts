/** Mixer fader 100% maps to this HTML/ffmpeg bed volume so speech at 1.0 stays louder. */
export const BED_GAIN_PEAK_VOLUME = 0.5;

/**
 * Ready-made soundscapes are a whole produced bed rather than one mixer
 * channel, so they play louder than a fader ever reaches — still under the
 * narration at 1.0, but clearly present.
 */
export const SOUNDSCAPE_ELEMENT_VOLUME = 0.67;

/** Bed-only lead-in before speech starts (live mix and baked mix). */
export const BED_VOICE_INTRO_SECONDS = 1.5;

export function bedElementVolume(gain: number): number {
  const g = Math.min(100, Math.max(0, Number.isFinite(gain) ? gain : 0));
  return (g / 100) * BED_GAIN_PEAK_VOLUME;
}

/** Apply after src/load — browsers reset HTMLMediaElement.volume to 1 on load(). */
export function applyBedElementVolume(
  el: HTMLMediaElement | null,
  gain: number,
): void {
  if (!el) return;
  el.volume = bedElementVolume(gain);
}
