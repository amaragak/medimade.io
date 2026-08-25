/**
 * Light / dark appearance. Default is light; user choice is stored in localStorage
 * and applied as `class="dark"` on `<html>` (not `prefers-color-scheme`).
 */

export type ColorScheme = "light" | "dark";

export const COLOR_SCHEME_STORAGE_KEY = "mm_color_scheme";
export const COLOR_SCHEME_CHANGED_EVENT = "mm-color-scheme-changed";

/** Hero paisley tiles — keep in sync with `--home-hero-pattern` in theme-colors. */
export const HOME_HERO_PATTERN_LIGHT =
  "/patterns/paisley-tile-800-offwhite.webp";
export const HOME_HERO_PATTERN_DARK =
  "/patterns/paisley-tile-800-tonal-navy.webp";

export function getStoredColorScheme(): ColorScheme {
  if (typeof window === "undefined") return "light";
  try {
    return localStorage.getItem(COLOR_SCHEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export function applyColorScheme(scheme: ColorScheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  /* Disable color transitions for one frame so the root token swap paints once. */
  root.classList.add("theme-switching");
  root.classList.toggle("dark", scheme === "dark");
  root.style.colorScheme = scheme;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("theme-switching");
    });
  });
}

export function setColorScheme(scheme: ColorScheme): void {
  try {
    localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    /* private mode */
  }
  applyColorScheme(scheme);
  window.dispatchEvent(new Event(COLOR_SCHEME_CHANGED_EVENT));
}

export function toggleColorScheme(): ColorScheme {
  const next: ColorScheme =
    getStoredColorScheme() === "dark" ? "light" : "dark";
  setColorScheme(next);
  return next;
}

/**
 * Inline boot script — set class before first paint, and preload the active
 * hero paisley so `background-image` does not flash in after layout.
 * Default is light; only an explicit stored `"dark"` opts into dark mode.
 */
export const colorSchemeBootScript = `(function(){var dark=false;try{dark=localStorage.getItem(${JSON.stringify(COLOR_SCHEME_STORAGE_KEY)})==="dark"}catch(e){}var root=document.documentElement;if(dark){root.classList.add("dark");root.style.colorScheme="dark"}else{root.style.colorScheme="light"}var active=dark?${JSON.stringify(HOME_HERO_PATTERN_DARK)}:${JSON.stringify(HOME_HERO_PATTERN_LIGHT)};var img=new Image();img.fetchPriority="high";img.src=active})();`;
