/**
 * Fixed warm sandy card backgrounds for Ideate life areas —
 * assigned in creation order (cycles after 5).
 */

export const LIFE_AREA_CARD_PALETTE = [
  "#EDD5B3",
  "#F2DFC8",
  "#E8C9A0",
  "#DFC4A0",
  "#E4CEB4",
] as const;

export function lifeAreaCardBackground(creationIndex: number): string {
  const i = ((creationIndex % LIFE_AREA_CARD_PALETTE.length) + LIFE_AREA_CARD_PALETTE.length) %
    LIFE_AREA_CARD_PALETTE.length;
  return LIFE_AREA_CARD_PALETTE[i]!;
}
