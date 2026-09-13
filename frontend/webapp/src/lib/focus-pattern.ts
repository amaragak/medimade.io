/**
 * Focus page edge-pattern preference (fades into the clear centre band).
 * Device-local; does not change clear-band dimensions.
 */

export type FocusPatternId =
  | "default"
  | "mandala"
  | "floral"
  | "ornate"
  | "waves"
  | "celestial"
  | "astrology";

export type FocusPatternOption = {
  id: FocusPatternId;
  label: string;
  swatch: string;
  swatchImage?: string;
};

export const FOCUS_PATTERN_OPTIONS: readonly FocusPatternOption[] = [
  {
    id: "default",
    label: "Default",
    swatch: "#FAF8F3",
    swatchImage: "/patterns/paisley-tile-800-offwhite.webp",
  },
  {
    id: "mandala",
    label: "Mandala",
    swatch: "#1a1820",
    swatchImage: "/patterns/hero/adobestock-1713569649.webp",
  },
  {
    id: "floral",
    label: "Floral",
    swatch: "#F3EEE6",
    swatchImage: "/patterns/hero/adobestock-2156039259.webp",
  },
  {
    id: "ornate",
    label: "Ornate",
    swatch: "#EDE8DF",
    swatchImage: "/patterns/hero/adobestock-2162625652.webp",
  },
  {
    id: "waves",
    label: "Waves",
    swatch: "#2A4A6A",
    swatchImage: "/patterns/hero/adobestock-2157180245.webp",
  },
  {
    id: "celestial",
    label: "Celestial",
    swatch: "#0B1A3A",
    swatchImage: "/patterns/hero/adobestock-2055049378.webp",
  },
  {
    id: "astrology",
    label: "Astrology",
    swatch: "#12182A",
    swatchImage: "/patterns/hero/adobestock-2089052451.webp",
  },
] as const;

export const FOCUS_PATTERN_CHANGED_EVENT = "mm-focus-pattern-changed";

const LS_KEY = "mm_focus_pattern_v1";
const DEFAULT: FocusPatternId = "default";

const VALID_IDS = new Set<string>(FOCUS_PATTERN_OPTIONS.map((o) => o.id));

export function isFocusPatternId(x: unknown): x is FocusPatternId {
  return typeof x === "string" && VALID_IDS.has(x);
}

export function loadFocusPattern(): FocusPatternId {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (isFocusPatternId(raw)) return raw;
  } catch {
    /* */
  }
  return DEFAULT;
}

export function saveFocusPattern(id: FocusPatternId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, id);
    window.dispatchEvent(new Event(FOCUS_PATTERN_CHANGED_EVENT));
  } catch {
    /* */
  }
}
