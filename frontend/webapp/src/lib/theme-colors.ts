/**
 * Theme source of truth.
 *
 * `PRIMARY` is the brand fill (gold-tan). Neutrals (paper, navy ink, borders)
 * are independent so the page stays cream and the header can be navy.
 */

/** Brand fill — gold-tan. Text on this fill must use `onAccent` (#3D2E10). */
export const PRIMARY = "#D9A24F";

/** Links and accent text on cream (deeper amber — gold-tan on cream fails contrast). */
export const ACCENT_LINK = "#B8703A";

/** Dark warm brown on gold-tan fills. */
export const ON_ACCENT = "#3D2E10";

/**
 * Gold-tan button fill. Same speaker-disc stops, slightly quieter.
 * Edit this CSS string (and BLEND) — it becomes `--accent-gradient-button`.
 * Placeholders: {light} {mid} {accent} {deep}. BLEND 0 = disc contrast, 1 = flat.
 */
export const ACCENT_BUTTON_GRADIENT =
  "linear-gradient(160deg, {light} 0%, {mid} 38%, {accent} 72%, {deep} 100%)";
export const ACCENT_BUTTON_GRADIENT_BLEND = 0.08;

/**
 * Header wordmark fill. Radial origin sits on the sun (left of the text).
 * White near the sun → light gold-tan by the end of “consciously”.
 * Ellipse is sized to the glyph box so the shift reads across the word.
 * Placeholders: {white} {soft} {end}. Becomes `--brand-wordmark-gradient`.
 * SOFT/END = accent mixed into white (0 = white, 1 = solid gold-tan).
 */
export const BRAND_WORDMARK_GRADIENT =
  "radial-gradient(ellipse 155% 200% at -1.75rem 50%, {white} 0%, {white} 28%, {soft} 55%, {end} 100%)";
export const BRAND_WORDMARK_SOFT = 0.16;
export const BRAND_WORDMARK_END = 0.28;

const WHITE = "#ffffff";
const BLACK = "#000000";

/** Independent of brand hue. */
export const DANGER = "#dc2626";
export const SUCCESS = "#059669";
export const INFO = "#0284c7";

const NAV = "#33465C";
// const NAV = "#6E88A3";
const NAV_FOREGROUND = WHITE;
const NAV_MUTED = "rgb(255 255 255 / 0.68)";
const NAV_ACTIVE = "rgb(255 255 255 / 0.14)";
/** Unrated star glyphs. */
export const STAR_IDLE = "#B5AF9F";

const GOLD_LIGHT = "#D9A24F";
const GOLD_DARK = "#E8C07A";

/**
 * Paper / ink / chrome. Independent of PRIMARY.
 */
const PAPER_LIGHT = {
  background: "#FAF8F3",
  foreground: "#1E2530",
  muted: "#7A7566",
  faint: "#A39C8C",
  card: "#FFFFFF",
  border: "#E5E0D2",
  borderSubtle: "#EEE9DB",
  deep: "#1E2530",
  surface: WHITE,
} as const;

const PAPER_DARK = {
  background: "#1E2530",
  foreground: "#FAF8F3",
  muted: "#A39C8C",
  faint: "#8A8478",
  card: "#2A3544",
  border: "#3D4A5C",
  borderSubtle: "#33465C",
  deep: "#0F141A",
  surface: "#2A3544",
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
  faint: string;
  card: string;
  border: string;
  borderSubtle: string;
  accent: string;
  accentSoft: string;
  accentLink: string;
  gold: string;
  deep: string;
  surface: string;
  onAccent: string;
  overlay: string;
  nav: string;
  navForeground: string;
  navMuted: string;
  navActive: string;
  /** Selected / active segment fills (navy). */
  selected: string;
  onSelected: string;
  starIdle: string;
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
    accentSoft: dark
      ? mixHex(paper.card, accent, 0.16)
      : mixHex(accent, paper.background, 0.857),
    onAccent: ON_ACCENT,
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
    accentLink: dark ? mixHex(ACCENT_LINK, WHITE, 0.28) : ACCENT_LINK,
    nav: NAV,
    navForeground: NAV_FOREGROUND,
    navMuted: NAV_MUTED,
    navActive: NAV_ACTIVE,
    selected: NAV,
    onSelected: WHITE,
    starIdle: STAR_IDLE,
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

/** Fills `ACCENT_BUTTON_GRADIENT` from the active theme. */
export function accentGradientButtonCss(s: Semantic): string {
  const t = ACCENT_BUTTON_GRADIENT_BLEND;
  return ACCENT_BUTTON_GRADIENT.replaceAll(
    "{light}",
    mixHex(s.gradientLight, s.accent, t),
  )
    .replaceAll("{mid}", mixHex(s.gradientMid, s.accent, t))
    .replaceAll("{accent}", s.accent)
    .replaceAll("{deep}", mixHex(s.gradientDeep, s.accent, t));
}

/** Fills `BRAND_WORDMARK_GRADIENT` from the active theme (resolved hex stops). */
export function brandWordmarkGradientCss(s: Semantic): string {
  return BRAND_WORDMARK_GRADIENT.replaceAll("{white}", WHITE)
    .replaceAll("{soft}", mixHex(WHITE, s.accent, BRAND_WORDMARK_SOFT))
    .replaceAll("{end}", mixHex(WHITE, s.accent, BRAND_WORDMARK_END));
}

/** Muted category / meditation-type card fills — [light mode, dark mode]. */
export const CATEGORY_CARD_FILLS: ReadonlyArray<readonly [string, string]> = [
  ["#e4d6c8", "#2a2420"],
  ["#d7e0d4", "#1f2820"],
  ["#d4dde6", "#1e2630"],
  ["#d5e4e2", "#1d2826"],
  ["#eadcc4", "#2a251c"],
  ["#e6d4d8", "#2a2226"],
  ["#e8e0c9", "#28241c"],
  ["#ddd6e4", "#242030"],
  ["#cfd8e2", "#1c2430"],
  ["#ead3c8", "#2c221e"],
  ["#d4e2d6", "#1e2820"],
  ["#dce0d0", "#24281e"],
  ["#d8d6d2", "#262420"],
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
    "--faint": s.faint,
    "--card": s.card,
    "--border": s.border,
    "--border-subtle": s.borderSubtle,
    "--accent": s.accent,
    "--accent-soft": s.accentSoft,
    "--accent-link": s.accentLink,
    "--gold": s.gold,
    "--deep": s.deep,
    "--surface": s.surface,
    "--on-accent": s.onAccent,
    "--overlay": s.overlay,
    "--nav": s.nav,
    "--nav-foreground": s.navForeground,
    "--nav-muted": s.navMuted,
    "--nav-active": s.navActive,
    "--selected": s.selected,
    "--on-selected": s.onSelected,
    "--star-idle": s.starIdle,
    "--danger": s.danger,
    "--danger-soft": s.dangerSoft,
    "--success": s.success,
    "--info": s.info,
    "--accent-gradient": accentGradientCss(s),
    "--accent-gradient-button": accentGradientButtonCss(s),
    "--brand-wordmark-gradient": brandWordmarkGradientCss(s),
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
  /** Class-driven dark theme (header toggle). Light is the default — not system preference. */
  cssBlock(":root.dark", varsFor(dark)),
].join("\n\n");
