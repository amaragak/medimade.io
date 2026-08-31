/** Creator-selected guided length. Keep in sync with the web/mobile clients. */
export type MeditationTargetMinutes = 2 | 5 | 10 | 20;

export const MEDITATION_TARGET_MINUTES: readonly MeditationTargetMinutes[] = [
  2, 5, 10, 20,
];

export const DEFAULT_MEDITATION_TARGET_MINUTES: MeditationTargetMinutes = 5;

export function coerceMeditationTargetMinutes(
  raw: unknown,
): MeditationTargetMinutes {
  return MEDITATION_TARGET_MINUTES.includes(raw as MeditationTargetMinutes)
    ? (raw as MeditationTargetMinutes)
    : DEFAULT_MEDITATION_TARGET_MINUTES;
}
