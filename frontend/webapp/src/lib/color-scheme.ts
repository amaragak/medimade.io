/**
 * Light / dark appearance. Default is light; user choice is stored in localStorage
 * and applied as `class="dark"` on `<html>` (not `prefers-color-scheme`).
 */

export type ColorScheme = "light" | "dark";

export const COLOR_SCHEME_STORAGE_KEY = "mm_color_scheme";
export const COLOR_SCHEME_CHANGED_EVENT = "mm-color-scheme-changed";

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
  root.classList.toggle("dark", scheme === "dark");
  root.style.colorScheme = scheme;
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

/** Inline boot script — set class before first paint to avoid a light flash. */
export const colorSchemeBootScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(COLOR_SCHEME_STORAGE_KEY)});if(t==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}else{document.documentElement.style.colorScheme="light"}}catch(e){}})();`;
