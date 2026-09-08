/**
 * Ideate home hero band background — device preference.
 */

export type IdeateHeroBgId =
  | "paper"
  | "black"
  | "navy"
  | "mandala"
  | "floral"
  | "ornate"
  | "waves"
  | "celestial"
  | "astrology";

export type IdeateHeroBgOption = {
  id: IdeateHeroBgId;
  label: string;
  /** Solid swatch when no preview image. */
  swatch: string;
  /** Optional image preview for the picker chip. */
  swatchImage?: string;
  /** Extra class on `.home-hero` (empty = default paper + vignette). */
  className: string;
};

export const IDEATE_HERO_BG_OPTIONS: readonly IdeateHeroBgOption[] = [
  { id: "paper", label: "Paper", swatch: "#FAF8F3", className: "" },
  { id: "black", label: "Black", swatch: "#000000", className: "home-hero--ideate" },
  { id: "navy", label: "Navy", swatch: "#1E2530", className: "home-hero--ideate-navy" },
  {
    id: "mandala",
    label: "Mandala",
    swatch: "#1a1820",
    swatchImage: "/patterns/hero/adobestock-1713569649.webp",
    className: "home-hero--stock home-hero--stock-mandala",
  },
  {
    id: "floral",
    label: "Floral",
    swatch: "#F3EEE6",
    swatchImage: "/patterns/hero/adobestock-2156039259.webp",
    className: "home-hero--stock home-hero--stock-floral",
  },
  {
    id: "ornate",
    label: "Ornate",
    swatch: "#EDE8DF",
    swatchImage: "/patterns/hero/adobestock-2162625652.webp",
    className: "home-hero--stock home-hero--stock-ornate",
  },
  {
    id: "waves",
    label: "Waves",
    swatch: "#2A4A6A",
    swatchImage: "/patterns/hero/adobestock-2157180245.webp",
    className: "home-hero--stock home-hero--stock-waves",
  },
  {
    id: "celestial",
    label: "Celestial",
    swatch: "#0B1A3A",
    swatchImage: "/patterns/hero/adobestock-2055049378.webp",
    className: "home-hero--stock home-hero--stock-celestial",
  },
  {
    id: "astrology",
    label: "Astrology",
    swatch: "#12182A",
    swatchImage: "/patterns/hero/adobestock-2089052451.webp",
    className: "home-hero--stock home-hero--stock-astrology",
  },
] as const;

const LS_KEY = "mm_ideate_hero_bg_v1";
const DEFAULT: IdeateHeroBgId = "black";

const VALID_IDS = new Set<string>(IDEATE_HERO_BG_OPTIONS.map((o) => o.id));

export function isIdeateHeroBgId(x: unknown): x is IdeateHeroBgId {
  return typeof x === "string" && VALID_IDS.has(x);
}

export function getIdeateHeroBgOption(id: IdeateHeroBgId): IdeateHeroBgOption {
  return (
    IDEATE_HERO_BG_OPTIONS.find((o) => o.id === id) ?? IDEATE_HERO_BG_OPTIONS[1]!
  );
}

export function loadIdeateHeroBg(): IdeateHeroBgId {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (isIdeateHeroBgId(raw)) return raw;
  } catch {
    /* */
  }
  return DEFAULT;
}

export function saveIdeateHeroBg(id: IdeateHeroBgId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, id);
  } catch {
    /* */
  }
}
