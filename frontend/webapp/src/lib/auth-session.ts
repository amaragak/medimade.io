/**
 * Client session: access JWT in memory only; email/name in localStorage.
 * Refresh lives in HttpOnly cookie (set by API). Call ensureMedimadeSession() on boot.
 */

const EMAIL_KEY = "mm_session_email_v1";
const DISPLAY_NAME_KEY = "mm_session_display_name_v1";
const ACTIVE_KEY = "mm_session_active_v1";
/** Legacy — cleared on read so XSS cannot keep stealing long-lived tokens. */
const LEGACY_JWT_KEY = "mm_session_jwt_v1";

let memoryAccessJwt: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let accessRefreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Refresh ~10 minutes before the 1h access JWT expires. */
const ACCESS_REFRESH_AFTER_MS = 50 * 60 * 1000;

function clearAccessRefreshTimer(): void {
  if (accessRefreshTimer) {
    clearTimeout(accessRefreshTimer);
    accessRefreshTimer = null;
  }
}

function scheduleAccessRefresh(): void {
  if (typeof window === "undefined") return;
  clearAccessRefreshTimer();
  accessRefreshTimer = setTimeout(() => {
    accessRefreshTimer = null;
    void ensureMedimadeSession({ force: true });
  }, ACCESS_REFRESH_AFTER_MS);
}

function normalizeStoredJwt(raw: string): string | null {
  let t = raw.trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/^Bearer\s+/i, "").trim();
  return t || null;
}

function clearLegacyJwtFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_JWT_KEY);
  } catch {
    /* */
  }
}

export function getMedimadeSessionJwt(): string | null {
  if (typeof window === "undefined") return null;
  clearLegacyJwtFromStorage();
  return memoryAccessJwt;
}

export function getMedimadeSessionEmail(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = window.localStorage.getItem(EMAIL_KEY)?.trim();
    return t || null;
  } catch {
    return null;
  }
}

export function getMedimadeSessionDisplayName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = window.localStorage.getItem(DISPLAY_NAME_KEY)?.trim();
    return t || null;
  } catch {
    return null;
  }
}

export function isMedimadeSessionActive(): boolean {
  if (typeof window === "undefined") return false;
  if (memoryAccessJwt) return true;
  try {
    return window.localStorage.getItem(ACTIVE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMedimadeSession(
  token: string,
  email?: string | null,
  displayName?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const jwt = normalizeStoredJwt(token);
    if (!jwt) return;
    memoryAccessJwt = jwt;
    clearLegacyJwtFromStorage();
    window.localStorage.setItem(ACTIVE_KEY, "1");
    if (email?.trim()) window.localStorage.setItem(EMAIL_KEY, email.trim());
    else window.localStorage.removeItem(EMAIL_KEY);
    if (displayName?.trim())
      window.localStorage.setItem(DISPLAY_NAME_KEY, displayName.trim());
    else window.localStorage.removeItem(DISPLAY_NAME_KEY);
    scheduleAccessRefresh();
    window.dispatchEvent(new Event("medimade-session-changed"));
  } catch {
    /* */
  }
}

export function clearMedimadeSession(): void {
  if (typeof window === "undefined") return;
  memoryAccessJwt = null;
  clearAccessRefreshTimer();
  try {
    window.localStorage.removeItem(LEGACY_JWT_KEY);
    window.localStorage.removeItem(EMAIL_KEY);
    window.localStorage.removeItem(DISPLAY_NAME_KEY);
    window.localStorage.removeItem(ACTIVE_KEY);
    window.localStorage.removeItem("mm_plan_dreams_v1");
    window.localStorage.removeItem("mm_ideate_vision_board_v1");
    window.localStorage.removeItem("mm_ideate_reflection_questions_v1");
    window.localStorage.removeItem("mm_ideate_demo_seed_v1");
  } catch {
    /* */
  }
  void import("@/lib/ideate-cloud").then((m) => {
    m.clearIdeateCloudSessionCache();
  });
  // Best-effort server logout (clears HttpOnly refresh cookie).
  void import("@/lib/medimade-api")
    .then((m) => m.logoutMedimadeSessionRemote())
    .catch(() => {
      /* */
    });
  try {
    window.dispatchEvent(new Event("medimade-session-changed"));
  } catch {
    /* */
  }
}

/**
 * Restore memory access JWT from HttpOnly refresh cookie after reload.
 * Safe to call often — coalesces concurrent calls.
 * Pass `{ force: true }` to ignore a (possibly expired) in-memory access JWT.
 */
export async function ensureMedimadeSession(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  clearLegacyJwtFromStorage();
  if (!opts?.force && memoryAccessJwt) return true;
  if (!isMedimadeSessionActive() && !getMedimadeSessionEmail()) return false;
  if (refreshInFlight) return refreshInFlight;

  if (opts?.force) memoryAccessJwt = null;

  refreshInFlight = (async () => {
    try {
      const { refreshMedimadeSessionRemote } = await import("@/lib/medimade-api");
      const result = await refreshMedimadeSessionRemote();
      if (!result?.token) {
        memoryAccessJwt = null;
        try {
          window.localStorage.removeItem(ACTIVE_KEY);
        } catch {
          /* */
        }
        return false;
      }
      setMedimadeSession(result.token, result.email, result.displayName);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}
