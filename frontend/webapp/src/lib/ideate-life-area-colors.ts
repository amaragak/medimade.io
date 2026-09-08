/**
 * Muted life-area card colours — washes that sit on the warm card surface.
 */

export type LifeAreaColorId =
  | "dusty-rose"
  | "sage"
  | "slate-blue"
  | "terracotta"
  | "lavender"
  | "muted-teal"
  | "warm-sand"
  | "dusty-mauve"
  | "soft-olive"
  | "clay";

export type LifeAreaColorOption = {
  id: LifeAreaColorId;
  /** Full-opacity swatch for the picker circle. */
  swatch: string;
  /** Light wash for card background. */
  wash: string;
  /** Card border at rest. */
  border: string;
  /** Slightly stronger border on hover. */
  borderHover: string;
};

function tones(swatch: string): Pick<
  LifeAreaColorOption,
  "swatch" | "wash" | "border" | "borderHover"
> {
  return {
    swatch,
    wash: `color-mix(in srgb, ${swatch} 22%, var(--card))`,
    border: `color-mix(in srgb, ${swatch} 48%, var(--border))`,
    borderHover: `color-mix(in srgb, ${swatch} 72%, var(--border))`,
  };
}

export const LIFE_AREA_COLORS: readonly LifeAreaColorOption[] = [
  { id: "dusty-rose", ...tones("#C9A4A4") },
  { id: "sage", ...tones("#A8B5A0") },
  { id: "slate-blue", ...tones("#9AABC0") },
  { id: "terracotta", ...tones("#C4A08A") },
  { id: "lavender", ...tones("#B5A8C4") },
  { id: "muted-teal", ...tones("#8FAAA8") },
  { id: "warm-sand", ...tones("#C9B896") },
  { id: "dusty-mauve", ...tones("#B8A0B0") },
  { id: "soft-olive", ...tones("#ADB090") },
  { id: "clay", ...tones("#C4A898") },
] as const;

const BY_ID = new Map(LIFE_AREA_COLORS.map((c) => [c.id, c]));

export function isLifeAreaColorId(x: unknown): x is LifeAreaColorId {
  return typeof x === "string" && BY_ID.has(x as LifeAreaColorId);
}

export function getLifeAreaColor(
  id: string | null | undefined,
): LifeAreaColorOption | null {
  if (!id) return null;
  return BY_ID.get(id as LifeAreaColorId) ?? null;
}
