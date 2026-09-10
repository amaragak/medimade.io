/**
 * UI-only override: show marketing chrome while keeping the session JWT
 * so “View marketing page” can resume without a full logout.
 */

const STORAGE_KEY = "mm_marketing_preview_v1";
export const MARKETING_PREVIEW_CHANGED_EVENT = "medimade-marketing-preview-changed";

function notify(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(MARKETING_PREVIEW_CHANGED_EVENT));
  // Reuse session listeners so AppChrome / home re-sync in one place.
  window.dispatchEvent(new Event("medimade-session-changed"));
}

export function isMarketingPreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function enterMarketingPreviewMode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode */
  }
  notify();
}

export function exitMarketingPreviewMode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
  notify();
}

/** Display label for the preserved session (resume CTA). */
export function preservedSessionLabel(
  displayName: string | null | undefined,
  email: string | null | undefined,
): string {
  const name = displayName?.trim();
  if (name) return name;
  const em = email?.trim();
  if (em) return em;
  return "your account";
}
