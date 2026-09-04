/**
 * Theme source of truth.
 *
 * `PRIMARY` is the brand fill (gold-peach). Neutrals (paper, navy ink, borders)
 * are independent so the page stays cream and the light header matches the app canvas.
 */

import {
  HOME_HERO_PATTERN_DARK,
  HOME_HERO_PATTERN_LIGHT,
} from "@/lib/color-scheme";

/** Brand fill — gold-peach. Text on this fill must use `onAccent` (#3D2E10). */
export const PRIMARY = "#F0A855";

/** Links and accent text on cream (deeper amber — peach fill on cream fails contrast). */
export const ACCENT_LINK = "#B8703A";

/** Dark warm brown on gold-peach fills. */
export const ON_ACCENT = "#3D2E10";

/**
 * @deprecated Flat `PRIMARY` fills replaced button gradients. Kept so existing
 * `--accent-gradient*` CSS vars still resolve without breaking older CSS.
 */
export const ACCENT_BUTTON_GRADIENT = "{accent}";
export const ACCENT_BUTTON_GRADIENT_BLEND = 1;

/**
 * Header wordmark fill. Radial origin sits on the sun (left of the text).
 * White near the sun → light gold-peach by the end of “consciously”.
 * Ellipse is sized to the glyph box so the shift reads across the word.
 * Placeholders: {white} {soft} {end}. Becomes `--brand-wordmark-gradient`.
 * SOFT/END = accent mixed into white (0 = white, 1 = solid gold-peach).
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
/** Light app canvas + header base — one off-white (#FAF8F3). */
const APP_CANVAS_LIGHT = "#FAF8F3";
/** Light-mode header base — matches app canvas. */
const NAV_LIGHT = APP_CANVAS_LIGHT;
const NAV_FOREGROUND = WHITE;
const NAV_MUTED = "rgb(255 255 255 / 0.68)";
const NAV_ACTIVE = "rgb(255 255 255 / 0.14)";
const NAV_FOREGROUND_LIGHT = "#1E2530";
const NAV_MUTED_LIGHT = "#5A5648";
/** Unrated star glyphs. */
export const STAR_IDLE = "#B5AF9F";

const GOLD_LIGHT = "#F0A855";

/**
 * Paper / ink / chrome. Independent of PRIMARY.
 */
const PAPER_LIGHT = {
  background: APP_CANVAS_LIGHT,
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

/**
 * Brighter gold for filled CTAs (header Pro, accent-fill-gradient buttons).
 * Matches dark-mode `--accent`; light mode keeps `--accent` at PRIMARY for borders/tabs.
 */
export const ACCENT_BUTTON_FILL = rel(resolveColor(PRIMARY), 1.8, 0.08, 0.12);

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
  /** Brighter gold for filled buttons — same in both themes (dark-mode accent). */
  accentButton: string;
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
  /** Selected / active segment fills — gold-peach in light, navy in dark. */
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
  /** Marketing / hero surfaces (role tokens — one value per theme). */
  homeHeroBg: string;
  homeHeroPattern: string;
  homeHeroPatternOpacity: string;
  marketingInk: string;
  marketingMuted: string;
  marketingBandA: string;
  marketingBandB: string;
  marketingBandC: string;
  marketingBandD: string;
  /** Ideate band on meditate page (distinct light tan). */
  marketingBandIdeate: string;
  marketingBody: string;
  marketingCardBg: string;
  marketingCardBorder: string;
  marketingCardHover: string;
  marketingCardShadow: string;
  marketingIconBg: string;
  marketingIconFg: string;
  marketingPanelBg: string;
  marketingEyebrow: string;
  marketingPillarIdleBg: string;
  marketingPillarSelectedBg: string;
  marketingPillarIdleIconFg: string;
  marketingHighlightIconBg: string;
  marketingHighlightIconFg: string;
  marketingNavChrome: string;
  marketingInputShellBg: string;
  marketingPlaceholder: string;
  marketingMenuBg: string;
  marketingMenuBorder: string;
  marketingMenuHover: string;
  marketingMenuMuted: string;
  journalWarmBg: string;
  journalWarmBorder: string;
  journalWarmInputBg: string;
  headerBorder: string;
  headerShadow: string;
  headerGlowSun: string;
  headerGlowRight: string;
  proHeaderCtaBg: string;
  proHeaderCtaFg: string;
  proHeaderCtaImage: string;
  proHeaderCtaShadow: string;
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
    accentButton: ACCENT_BUTTON_FILL,
    gold,
    overlay: BLACK,
    accentLink: dark ? mixHex(ACCENT_LINK, WHITE, 0.28) : ACCENT_LINK,
    nav: dark ? NAV : NAV_LIGHT,
    navForeground: dark ? NAV_FOREGROUND : NAV_FOREGROUND_LIGHT,
    navMuted: dark ? NAV_MUTED : NAV_MUTED_LIGHT,
    navActive: dark
      ? NAV_ACTIVE
      : mixHex(ACCENT_BUTTON_FILL, NAV_LIGHT, 0.84),
    // Light: Pro/button gold for active fills. Dark: navy selected.
    selected: dark ? NAV : ACCENT_BUTTON_FILL,
    onSelected: dark ? WHITE : ON_ACCENT,
    starIdle: STAR_IDLE,
    danger: dark ? mixHex(DANGER, WHITE, 0.35) : DANGER,
    dangerSoft: dark ? mixHex(DANGER, BLACK, 0.78) : mixHex(DANGER, WHITE, 0.92),
    success: dark ? mixHex(SUCCESS, WHITE, 0.2) : SUCCESS,
    info: dark ? mixHex(INFO, WHITE, 0.2) : INFO,
    homeHeroBg: dark ? "#1A2330" : paper.background,
    homeHeroPattern: dark
      ? `url(${JSON.stringify(HOME_HERO_PATTERN_DARK)})`
      : `url(${JSON.stringify(HOME_HERO_PATTERN_LIGHT)})`,
    homeHeroPatternOpacity: dark ? "0.18" : "0.32",
    marketingInk: dark ? "#F4F0E8" : "#1E2530",
    marketingMuted: dark ? "#A8B0BC" : "#5A5342",
    marketingBody: dark ? "#A8B0BC" : "#7A7566",
    /** Lighter mid band (e.g. “Tools that talk…”, pillars). */
    marketingBandA: dark
      ? "#2A3A4E"
      : mixHex(PRIMARY, paper.background, 0.82),
    /** Deeper CTA band (e.g. “Start with…”). */
    marketingBandB: dark
      ? "#1A2330"
      : mixHex(PRIMARY, paper.background, 0.7),
    /** Mid band (meditate / feature strips). */
    marketingBandC: dark
      ? "#243447"
      : mixHex(PRIMARY, paper.background, 0.74),
    /** Soft cream band (journal, listen samples). */
    marketingBandD: dark
      ? "#161D28"
      : mixHex(PRIMARY, paper.background, 0.9),
    /** Softest band (ideate) — distinct from journal band D. */
    marketingBandIdeate: dark
      ? "#1A2330"
      : mixHex(PRIMARY, paper.background, 0.94),
    marketingCardBg: dark ? "#2A3544" : "#FFFFFF",
    marketingCardBorder: dark ? "rgba(255,255,255,0.1)" : "#E5DFD0",
    marketingCardHover: dark ? "#323E4F" : "#FBF8F2",
    marketingCardShadow: dark
      ? "none"
      : "0 10px 28px rgb(30 37 48 / 0.06)",
    marketingIconBg: dark
      ? "rgba(255,255,255,0.1)"
      : mixHex(PRIMARY, paper.background, 0.86),
    marketingIconFg: dark ? GOLD_LIGHT : "#33465C",
    marketingPanelBg: dark ? "#12181F" : "#FFFFFF",
    marketingEyebrow: dark ? GOLD_LIGHT : ACCENT_LINK,
    marketingPillarIdleBg: dark ? "#243041" : "#FFFFFF",
    marketingPillarSelectedBg: dark ? "#2F2C24" : "#FFFFFF",
    marketingPillarIdleIconFg: dark ? "#F4F0E8" : "#33465C",
    marketingHighlightIconBg: dark
      ? "rgba(240,168,85,0.22)"
      : mixHex(PRIMARY, paper.background, 0.86),
    marketingHighlightIconFg: dark ? GOLD_LIGHT : ACCENT_LINK,
    marketingNavChrome: dark ? "rgba(255,255,255,0.2)" : "#D8D0BC",
    marketingInputShellBg: dark ? "rgba(255,255,255,0.06)" : "#FFFFFF",
    marketingPlaceholder: dark ? "rgba(255,255,255,0.3)" : "#C8C0B2",
    marketingMenuBg: dark ? "#1E2530" : "#FFFFFF",
    marketingMenuBorder: dark ? "rgba(255,255,255,0.15)" : "#D8D2C4",
    marketingMenuHover: dark ? "rgba(255,255,255,0.1)" : "#F4F0E8",
    marketingMenuMuted: dark ? "#C8C0B2" : "#5A5548",
    journalWarmBg: dark
      ? "#2A261F"
      : mixHex(PRIMARY, paper.background, 0.94),
    journalWarmBorder: dark
      ? "#5A4F3A"
      : mixHex(PRIMARY, paper.background, 0.72),
    journalWarmInputBg: dark ? "#1C1914" : "#FFFFFF",
    headerBorder: dark ? "rgba(255,255,255,0.1)" : "#E5E0D2",
    headerShadow: dark
      ? "0 4px 18px rgb(20 28 38 / 0.28)"
      : "0 4px 18px rgb(80 60 30 / 0.06)",
    headerGlowSun: dark
      ? "radial-gradient(circle, rgb(148 176 200 / 0.22) 0%, rgb(108 138 165 / 0.12) 42%, rgb(51 70 92 / 0) 78%)"
      : "radial-gradient(circle, rgb(255 255 255 / 1) 0%, rgb(255 255 255 / 0.65) 42%, rgb(250 248 243 / 0) 78%)",
    headerGlowRight: dark
      ? "radial-gradient(circle, rgb(16 26 38 / 0.4) 0%, rgb(24 36 50 / 0.22) 32%, rgb(51 70 92 / 0) 68%)"
      : "radial-gradient(circle, rgb(232 224 208 / 0.7) 0%, rgb(232 224 208 / 0.3) 36%, rgb(250 248 243 / 0) 70%)",
    proHeaderCtaBg: ACCENT_BUTTON_FILL,
    proHeaderCtaFg: ON_ACCENT,
    proHeaderCtaImage: "none",
    proHeaderCtaShadow: "none",
  };
}

/** Filled CTA / `--gold` token — same brighter Pro gold in both themes. */
export const light = assemble(PAPER_LIGHT, ACCENT_BUTTON_FILL, false);
export const dark = assemble(PAPER_DARK, ACCENT_BUTTON_FILL, true);

export function accentGradientCss(s: Semantic): string {
  // Flat brand fill (legacy name kept for `--accent-gradient` consumers).
  return s.accent;
}

/** Fills `ACCENT_BUTTON_GRADIENT` from the active theme — now a flat accent. */
export function accentGradientButtonCss(s: Semantic): string {
  return ACCENT_BUTTON_GRADIENT.replaceAll("{accent}", s.accentButton)
    .replaceAll("{light}", s.accentButton)
    .replaceAll("{mid}", s.accentButton)
    .replaceAll("{deep}", s.accentButton);
}

/** Fills `BRAND_WORDMARK_GRADIENT` from the active theme (resolved hex stops). */
export function brandWordmarkGradientCss(s: Semantic, dark: boolean): string {
  if (!dark) {
    /* Near-black wordmark on light-tan header; sun mark carries the gold. */
    const ink = "#1E2530";
    return `linear-gradient(0deg, ${ink}, ${ink})`;
  }
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

function varsFor(s: Semantic, dark: boolean): Record<string, string> {
  return {
    /** Light: app canvas always matches header base (--nav). */
    "--background": dark ? s.background : s.nav,
    "--foreground": s.foreground,
    "--muted": s.muted,
    "--faint": s.faint,
    "--card": s.card,
    "--border": s.border,
    "--border-subtle": s.borderSubtle,
    "--accent": s.accent,
    "--accent-button": s.accentButton,
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
    "--brand-wordmark-gradient": brandWordmarkGradientCss(s, dark),
    "--accent-rgb": rgbChannels(s.accent),
    "--foreground-rgb": rgbChannels(s.foreground),
    "--deep-rgb": rgbChannels(s.deep),
    "--home-hero-bg": s.homeHeroBg,
    "--home-hero-pattern": s.homeHeroPattern,
    "--home-hero-pattern-opacity": s.homeHeroPatternOpacity,
    "--marketing-ink": s.marketingInk,
    "--marketing-muted": s.marketingMuted,
    "--marketing-band-a": s.marketingBandA,
    "--marketing-band-b": s.marketingBandB,
    "--marketing-band-c": s.marketingBandC,
    "--marketing-band-d": s.marketingBandD,
    "--marketing-band-ideate": s.marketingBandIdeate,
    "--marketing-body": s.marketingBody,
    "--marketing-card-bg": s.marketingCardBg,
    "--marketing-card-border": s.marketingCardBorder,
    "--marketing-card-hover": s.marketingCardHover,
    "--marketing-card-shadow": s.marketingCardShadow,
    "--marketing-icon-bg": s.marketingIconBg,
    "--marketing-icon-fg": s.marketingIconFg,
    "--marketing-panel-bg": s.marketingPanelBg,
    "--marketing-eyebrow": s.marketingEyebrow,
    "--marketing-pillar-idle-bg": s.marketingPillarIdleBg,
    "--marketing-pillar-selected-bg": s.marketingPillarSelectedBg,
    "--marketing-pillar-idle-icon-fg": s.marketingPillarIdleIconFg,
    "--marketing-highlight-icon-bg": s.marketingHighlightIconBg,
    "--marketing-highlight-icon-fg": s.marketingHighlightIconFg,
    "--marketing-nav-chrome": s.marketingNavChrome,
    "--marketing-input-shell-bg": s.marketingInputShellBg,
    "--marketing-placeholder": s.marketingPlaceholder,
    "--marketing-menu-bg": s.marketingMenuBg,
    "--marketing-menu-border": s.marketingMenuBorder,
    "--marketing-menu-hover": s.marketingMenuHover,
    "--marketing-menu-muted": s.marketingMenuMuted,
    "--journal-warm-bg": s.journalWarmBg,
    "--journal-warm-border": s.journalWarmBorder,
    "--journal-warm-input-bg": s.journalWarmInputBg,
    "--header-border": s.headerBorder,
    "--header-shadow": s.headerShadow,
    "--header-glow-sun": s.headerGlowSun,
    "--header-glow-right": s.headerGlowRight,
    "--pro-header-cta-bg": s.proHeaderCtaBg,
    "--pro-header-cta-fg": s.proHeaderCtaFg,
    "--pro-header-cta-image": s.proHeaderCtaImage,
    "--pro-header-cta-shadow": s.proHeaderCtaShadow,
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
  cssBlock(":root", varsFor(light, false)),
  /** Class-driven dark theme (header toggle). Default is light. */
  cssBlock(":root.dark", varsFor(dark, true)),
].join("\n\n");

/**
 * Critical hero paisley URLs — inlined in `<head>` so fetch starts before the
 * globals.css bundle; keep paths in sync with color-scheme.ts constants.
 */
export const homeHeroPatternCriticalCss = [
  `.home-hero::before{background-image:url("${HOME_HERO_PATTERN_LIGHT}")}`,
  `:root.dark .home-hero::before{background-image:url("${HOME_HERO_PATTERN_DARK}")}`,
  `.page-pattern-tile{background-image:url("${HOME_HERO_PATTERN_LIGHT}")}`,
  `:root.dark .page-pattern-tile{background-image:url("${HOME_HERO_PATTERN_DARK}")}`,
].join("\n");
