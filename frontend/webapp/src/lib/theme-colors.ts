/**
 * Brand color source of truth.
 *
 * Change `PRIMARY` to retheme the app. Warm neutrals, terracotta tints,
 * gold, gradients, and category fills are derived from it. Semantic status
 * colors (danger / success / info) stay independent so errors stay red.
 */

/** Switch this to change the brand. Current: terracotta. */
// export const PRIMARY = "#b86b48";
export const PRIMARY = "red";

const WHITE = "#ffffff";
const BLACK = "#000000";

/** Independent of brand hue. */
export const DANGER = "#dc2626";
export const SUCCESS = "#059669";
export const INFO = "#0284c7";

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function hexToRgb(hex: string): Rgb {
  const t = hex.trim().replace(/^#/, "");
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

/** Relative HSL offset from a hex (degrees, saturation delta, lightness delta). */
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

/**
 * Offsets tuned so today's terracotta `PRIMARY` reproduces the current UI.
 * Changing `PRIMARY` keeps the same relationships (cream paper, gold shift, etc.).
 */
function lightFromPrimary(p: string): Semantic {
  const accent = p;
  return {
    background: rel(p, 14, 0.037, 0.453),
    foreground: rel(p, 8.5, -0.298, -0.351),
    muted: rel(p, 9.5, -0.358, -0.1),
    card: rel(p, 8, 0.55, 0.48),
    border: rel(p, 15.5, -0.097, 0.378),
    accent,
    accentSoft: mixHex(p, rel(p, 14, 0.037, 0.453), 0.857),
    gold: rel(p, 12.6, -0.014, 0.094),
    deep: rel(p, 5.25, -0.203, -0.42),
    surface: WHITE,
    onAccent: onColor(accent),
    overlay: BLACK,
    danger: DANGER,
    dangerSoft: mixHex(DANGER, WHITE, 0.92),
    success: SUCCESS,
    info: INFO,
    gradientLight: rel(p, 9.5, 0.156, 0.274),
    gradientMid: rel(p, 2.9, 0.106, 0.1),
    gradientDeep: rel(p, -3.4, 0.065, -0.184),
  };
}

function darkFromPrimary(p: string): Semantic {
  const accent = rel(p, 1.8, 0.102, 0.129);
  return {
    background: rel(p, 1.3, -0.29, -0.42),
    foreground: rel(p, 11, 0.0, 0.42),
    muted: rel(p, 10, -0.3, 0.16),
    card: rel(p, 2, -0.22, -0.36),
    border: rel(p, 4, -0.2, -0.22),
    accent,
    accentSoft: rel(p, 4, -0.18, -0.28),
    gold: rel(p, 14, -0.05, 0.22),
    deep: rel(p, 4, -0.2, -0.46),
    surface: rel(p, 2, -0.22, -0.36),
    onAccent: onColor(accent),
    overlay: BLACK,
    danger: mixHex(DANGER, WHITE, 0.35),
    dangerSoft: mixHex(DANGER, BLACK, 0.78),
    success: mixHex(SUCCESS, WHITE, 0.2),
    info: mixHex(INFO, WHITE, 0.2),
    gradientLight: rel(p, 9.5, 0.156, 0.274),
    gradientMid: rel(p, 2.9, 0.106, 0.1),
    gradientDeep: rel(p, -3.4, 0.065, -0.184),
  };
}

export const light = lightFromPrimary(PRIMARY);
export const dark = darkFromPrimary(PRIMARY);

export function accentGradientCss(s: Semantic): string {
  return `linear-gradient(160deg, ${s.gradientLight} 0%, ${s.gradientMid} 38%, ${s.accent} 72%, ${s.gradientDeep} 100%)`;
}

/** Category card fills: brand hue plus stepped offsets so they retheme with PRIMARY. */
export function categoryCardFills(
  p: string = PRIMARY,
): ReadonlyArray<readonly [string, string]> {
  const { h, s } = hexToHsl(p);
  return Array.from({ length: 13 }, (_, i) => {
    const hue = h + i * 27;
    const lightFill = hslToHex(hue, clamp01(s * 0.35 + 0.12), 0.86);
    const darkFill = hslToHex(hue, clamp01(s * 0.22 + 0.08), 0.22);
    return [lightFill, darkFill] as const;
  });
}

export const CATEGORY_CARD_FILLS = categoryCardFills();

export function chartSeriesColor(seed: string, p: string = PRIMARY): string {
  let n = 0;
  for (let i = 0; i < seed.length; i += 1) n = (n * 31 + seed.charCodeAt(i)) >>> 0;
  const { h, s, l } = hexToHsl(p);
  return hslToHex(h + (n % 360), clamp01(s * 0.7 + 0.25), clamp01(l * 0.15 + 0.48));
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
