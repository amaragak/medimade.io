/**
 * Theme source of truth.
 *
 * `PRIMARY` is the brand accent. Only obviously-branded colors are derived
 * from it (accent, accent-soft, mixer gradient). Paper, cards, ink, and
 * borders are independent neutrals so switching PRIMARY to red (etc.) does
 * not tint the whole page.
 */

/** Switch this to change the brand accent. Current: terracotta. */
export const PRIMARY = "#b86b48";
// export const PRIMARY = "#6E88A3";
// export const PRIMARY = "#C67D3E";

const WHITE = "#ffffff";
const BLACK = "#000000";

/** Independent of brand hue. */
export const DANGER = "#dc2626";
export const SUCCESS = "#059669";
export const INFO = "#0284c7";

/** Warm gold highlight — not derived from PRIMARY. */
const GOLD_LIGHT = "#c49a6c";
const GOLD_DARK = "#d4b896";

/**
 * Paper / ink / chrome. Stay put when PRIMARY changes.
 * Light matches the original cream UI; dark is the original warm night set.
 */
const PAPER_LIGHT = {
  background: "#f9f4ee",
  foreground: "#2c2621",
  muted: "#6f665e",
  card: "#fffaf6",
  border: "#ebe2d6",
  deep: "#1a1410",
  surface: WHITE,
} as const;

const PAPER_DARK = {
  background: "#171311",
  foreground: "#f4ebe3",
  muted: "#a89b90",
  card: "#221c18",
  border: "#3d342c",
  deep: "#0f0c0a",
  surface: "#221c18",
} as const;

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

const CSS_NAMED: Record<string, string> = {
  red: "#ff0000",
  orange: "#ffa500",
  gold: "#ffd700",
  green: "#008000",
  teal: "#008080",
  blue: "#0000ff",
  purple: "#800080",
  black: BLACK,
  white: WHITE,
};

/** Accept `#hex` or a small set of CSS color names (for trying a new PRIMARY). */
export function resolveColor(input: string): string {
  const t = input.trim();
  if (t.startsWith("#")) return t;
  return CSS_NAMED[t.toLowerCase()] ?? t;
}

export function hexToRgb(hex: string): Rgb {
  const t = resolveColor(hex).replace(/^#/, "");
  const full = t.length === 3 ? t.split("").map((c) => `${c}${c}`).join("") : t;
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToHsl(hex: string): Hsl {
  let { r, g, b } = hexToRgb(hex);
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const hp = hh / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) {
    r = c;
    g = x;
  } else if (hp < 2) {
    r = x;
    g = c;
  } else if (hp < 3) {
    g = c;
    b = x;
  } else if (hp < 4) {
    g = x;
    b = c;
  } else if (hp < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const m = ll - c / 2;
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

export function rel(hex: string, dh: number, ds: number, dl: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + dh, s + ds, l + dl);
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A.r + (B.r - A.r) * t,
    A.g + (B.g - A.g) * t,
    A.b + (B.b - A.b) * t,
  );
}

export function rgbChannels(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}

export function rgba(hex: string, alpha: number): string {
  return `rgb(${rgbChannels(hex)} / ${alpha})`;
}

/** White or near-black depending on background lightness. */
export function onColor(bgHex: string): string {
  return hexToHsl(bgHex).l > 0.55 ? rel(bgHex, 0, 0.05, -0.72) : WHITE;
}

type Semantic = {
  background: string;
  foreground: string;
  muted: string;
  card: string;
  border: string;
  accent: string;
  accentSoft: string;
  gold: string;
  deep: string;
  surface: string;
  onAccent: string;
  overlay: string;
  danger: string;
  dangerSoft: string;
  success: string;
  info: string;
  gradientLight: string;
  gradientMid: string;
  gradientDeep: string;
};

/** Brand tints/shades from PRIMARY, mixed onto the given paper (not replacing it). */
function brandFromPrimary(
  rawPrimary: string,
  paper: typeof PAPER_LIGHT | typeof PAPER_DARK,
  dark: boolean,
): Pick<
  Semantic,
  | "accent"
  | "accentSoft"
  | "onAccent"
  | "gradientLight"
  | "gradientMid"
  | "gradientDeep"
> {
  const p = resolveColor(rawPrimary);
  const accent = dark ? rel(p, 1.8, 0.08, 0.12) : p;
  return {
    accent,
    // Light: wash of accent on cream. Dark: slight accent in the card, not a red panel.
    accentSoft: dark
      ? mixHex(paper.card, accent, 0.16)
      : mixHex(accent, paper.background, 0.857),
    onAccent: onColor(accent),
    gradientLight: rel(p, 9.5, 0.156, 0.274),
    gradientMid: rel(p, 2.9, 0.106, 0.1),
    gradientDeep: rel(p, -3.4, 0.065, -0.184),
  };
}

function assemble(
  paper: typeof PAPER_LIGHT | typeof PAPER_DARK,
  gold: string,
  dark: boolean,
): Semantic {
  const brand = brandFromPrimary(PRIMARY, paper, dark);
  return {
    ...paper,
    ...brand,
    gold,
    overlay: BLACK,
    danger: dark ? mixHex(DANGER, WHITE, 0.35) : DANGER,
    dangerSoft: dark ? mixHex(DANGER, BLACK, 0.78) : mixHex(DANGER, WHITE, 0.92),
    success: dark ? mixHex(SUCCESS, WHITE, 0.2) : SUCCESS,
    info: dark ? mixHex(INFO, WHITE, 0.2) : INFO,
  };
}

export const light = assemble(PAPER_LIGHT, GOLD_LIGHT, false);
export const dark = assemble(PAPER_DARK, GOLD_DARK, true);

export function accentGradientCss(s: Semantic): string {
  return `linear-gradient(160deg, ${s.gradientLight} 0%, ${s.gradientMid} 38%, ${s.accent} 72%, ${s.gradientDeep} 100%)`;
}

/** Muted category card fills — independent of PRIMARY. [light, dark] */
export const CATEGORY_CARD_FILLS: ReadonlyArray<readonly [string, string]> = [
  ["#e4d6c8", "#3d342e"],
  ["#d7e0d4", "#2f382f"],
  ["#d4dde6", "#2e3640"],
  ["#d5e4e2", "#2d3a38"],
  ["#eadcc4", "#3d3628"],
  ["#e6d4d8", "#3c3034"],
  ["#e8e0c9", "#3c382a"],
  ["#ddd6e4", "#353040"],
  ["#cfd8e2", "#2c3440"],
  ["#ead3c8", "#3e302c"],
  ["#d4e2d6", "#2e3a30"],
  ["#dce0d0", "#34382c"],
  ["#d8d6d2", "#383430"],
];

export function chartSeriesColor(seed: string): string {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
  return hslToHex(n % 360, 0.55, 0.52);
}

function varsFor(s: Semantic): Record<string, string> {
  return {
    "--background": s.background,
    "--foreground": s.foreground,
    "--muted": s.muted,
    "--card": s.card,
    "--border": s.border,
    "--accent": s.accent,
    "--accent-soft": s.accentSoft,
    "--gold": s.gold,
    "--deep": s.deep,
    "--surface": s.surface,
    "--on-accent": s.onAccent,
    "--overlay": s.overlay,
    "--danger": s.danger,
    "--danger-soft": s.dangerSoft,
    "--success": s.success,
    "--info": s.info,
    "--accent-gradient": accentGradientCss(s),
    "--accent-rgb": rgbChannels(s.accent),
    "--foreground-rgb": rgbChannels(s.foreground),
    "--deep-rgb": rgbChannels(s.deep),
  };
}

function cssBlock(selector: string, vars: Record<string, string>, indent = ""): string {
  const pad = `${indent}  `;
  const body = Object.entries(vars)
    .map(([k, v]) => `${pad}${k}: ${v};`)
    .join("\n");
  return `${indent}${selector} {\n${body}\n${indent}}`;
}

/** Injected in root layout. The only place brand hexes become CSS variables. */
export const themeRootCss = [
  cssBlock(":root", varsFor(light)),
  `@media (prefers-color-scheme: dark) {\n${cssBlock(":root", varsFor(dark), "  ")}\n}`,
].join("\n\n");
