/**
 * Client session: access JWT + refresh token in localStorage (same browser profile).
 * HttpOnly cookies are still set when the browser allows them; body refresh is the
 * durable fallback so cross-origin / localhost cookie blocks cannot sign you out.
 *
 * Explicit Log out ONLY: clearMedimadeSession().
 * Never auto-clear ACTIVE_KEY / refresh / access on a failed refresh — parallel
 * tab rotation and stale cookies routinely return one-off "invalid" responses.
 */

const EMAIL_KEY = "mm_session_email_v1";
const DISPLAY_NAME_KEY = "mm_session_display_name_v1";
const ACTIVE_KEY = "mm_session_active_v1";
/** Durable access JWT for same-profile reloads (XSS tradeoff accepted for session stickiness). */
const ACCESS_JWT_KEY = "mm_session_access_jwt_v1";
/** Durable refresh token when third-party cookies are blocked. */
const REFRESH_TOKEN_KEY = "mm_session_refresh_v1";
/** Legacy — migrated into ACCESS_JWT_KEY then removed. */
const LEGACY_JWT_KEY = "mm_session_jwt_v1";
/** Legacy client-only guest flag — cleared on real login / logout. */
const LEGACY_GUEST_KEY = "mm_session_guest_v1";

/** Survive HMR so parallel refresh rotations cannot race across module instances. */
const REFRESH_LOCK_KEY = "__mm_ensure_session_inflight__";

let memoryAccessJwt: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let accessRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityBound = false;
let hydratedFromStorage = false;

/** Fallback if JWT exp cannot be parsed — refresh ~10 minutes before a 1h token. */
const ACCESS_REFRESH_FALLBACK_MS = 50 * 60 * 1000;
const ACCESS_REFRESH_MIN_MS = 60 * 1000;
const ACCESS_REFRESH_LEAD_MS = 5 * 60 * 1000;

type RefreshLockHolder = { promise: Promise<boolean> };

function getRefreshLock(): RefreshLockHolder | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, RefreshLockHolder | undefined>;
  return w[REFRESH_LOCK_KEY] ?? null;
}

function setRefreshLock(holder: RefreshLockHolder | null): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, RefreshLockHolder | undefined>;
  if (holder) w[REFRESH_LOCK_KEY] = holder;
  else delete w[REFRESH_LOCK_KEY];
}

function clearAccessRefreshTimer(): void {
  if (accessRefreshTimer) {
    clearTimeout(accessRefreshTimer);
    accessRefreshTimer = null;
  }
}

function readJwtExpMs(jwt: string): number | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const pad = parts[1]!.length % 4 === 0 ? "" : "=".repeat(4 - (parts[1]!.length % 4));
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const payload = JSON.parse(atob(b64)) as { exp?: unknown };
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

function accessJwtNeedsRefresh(jwt: string | null): boolean {
  if (!jwt) return true;
  const expMs = readJwtExpMs(jwt);
  if (!expMs) return false; // unparseable — keep using until API 401s
  return expMs - Date.now() <= ACCESS_REFRESH_LEAD_MS;
}

function scheduleAccessRefresh(): void {
  if (typeof window === "undefined") return;
  clearAccessRefreshTimer();
  const jwt = memoryAccessJwt;
  let delay = ACCESS_REFRESH_FALLBACK_MS;
  if (jwt) {
    const expMs = readJwtExpMs(jwt);
    if (expMs) {
      delay = Math.max(ACCESS_REFRESH_MIN_MS, expMs - Date.now() - ACCESS_REFRESH_LEAD_MS);
    }
  }
  accessRefreshTimer = setTimeout(() => {
    accessRefreshTimer = null;
    void ensureMedimadeSession({ force: true });
  }, delay);
  bindVisibilityRefresh();
}

function bindVisibilityRefresh(): void {
  if (typeof window === "undefined" || visibilityBound) return;
  visibilityBound = true;
  const kick = () => {
    if (!isMedimadeSessionActive()) return;
    if (document.visibilityState && document.visibilityState !== "visible") return;
    // Soft kick only — forced refresh on every focus races tabs and signs people out.
    void ensureMedimadeSession({ force: false });
  };
  document.addEventListener("visibilitychange", kick);
  window.addEventListener("focus", kick);
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

function readStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = window.localStorage.getItem(key)?.trim();
    return t || null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* */
  }
}

function hydrateAccessJwtFromStorage(): void {
  if (typeof window === "undefined") return;
  if (!hydratedFromStorage) {
    hydratedFromStorage = true;
    try {
      const modern = normalizeStoredJwt(readStorage(ACCESS_JWT_KEY) ?? "");
      const legacy = normalizeStoredJwt(readStorage(LEGACY_JWT_KEY) ?? "");
      const jwt = modern || legacy;
      if (jwt) {
        memoryAccessJwt = jwt;
        if (!modern) writeStorage(ACCESS_JWT_KEY, jwt);
      }
      writeStorage(LEGACY_JWT_KEY, null);
      window.addEventListener("storage", (ev) => {
        if (ev.key === ACCESS_JWT_KEY) {
          const next = normalizeStoredJwt(ev.newValue ?? "");
          memoryAccessJwt = next;
          if (next) scheduleAccessRefresh();
        }
        if (ev.key === REFRESH_TOKEN_KEY && ev.newValue) {
          // Another tab rotated — keep sticky session; next refresh uses new token.
        }
        if (ev.key === ACTIVE_KEY && ev.newValue !== "1") {
          // Only explicit logout in another tab clears activity. Do not wipe JWT
          // here on a transient null write race.
          if (ev.newValue === null || ev.newValue === "") {
            memoryAccessJwt = null;
          }
        }
      });
    } catch {
      /* */
    }
    return;
  }
  // Re-read after another tab may have rotated tokens.
  const modern = normalizeStoredJwt(readStorage(ACCESS_JWT_KEY) ?? "");
  if (modern) memoryAccessJwt = modern;
}

/** Opaque refresh token for POST /auth/refresh body when cookies are blocked. */
export function getMedimadeRefreshToken(): string | null {
  return readStorage(REFRESH_TOKEN_KEY);
}

export function setMedimadeRefreshToken(token: string | null): void {
  const t = token?.trim() || null;
  writeStorage(REFRESH_TOKEN_KEY, t);
}

export function getMedimadeSessionJwt(): string | null {
  if (typeof window === "undefined") return null;
  hydrateAccessJwtFromStorage();
  return memoryAccessJwt;
}

export function getMedimadeSessionEmail(): string | null {
  return readStorage(EMAIL_KEY);
}

export function getMedimadeSessionDisplayName(): string | null {
  return readStorage(DISPLAY_NAME_KEY);
}

/** True if we have an access JWT or a remembered signed-in flag. */
export function isMedimadeSessionActive(): boolean {
  if (typeof window === "undefined") return false;
  // Drop legacy client-only guest sessions (no JWT) — guest is a real account now.
  if (readStorage(LEGACY_GUEST_KEY) === "1" && !memoryAccessJwt) {
    try {
      window.localStorage.removeItem(LEGACY_GUEST_KEY);
      window.localStorage.removeItem(ACTIVE_KEY);
      window.localStorage.removeItem(DISPLAY_NAME_KEY);
    } catch {
      /* */
    }
  }
  hydrateAccessJwtFromStorage();
  if (memoryAccessJwt) return true;
  return readStorage(ACTIVE_KEY) === "1";
}

export function setMedimadeSession(
  token: string,
  email?: string | null,
  displayName?: string | null,
  refreshToken?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const jwt = normalizeStoredJwt(token);
    if (!jwt) return;
    memoryAccessJwt = jwt;
    writeStorage(LEGACY_GUEST_KEY, null);
    writeStorage(ACCESS_JWT_KEY, jwt);
    writeStorage(LEGACY_JWT_KEY, null);
    writeStorage(ACTIVE_KEY, "1");
    if (typeof email === "string" && email.trim()) {
      writeStorage(EMAIL_KEY, email.trim());
    } else if (email === null) {
      writeStorage(EMAIL_KEY, null);
    }
    if (typeof displayName === "string" && displayName.trim()) {
      writeStorage(DISPLAY_NAME_KEY, displayName.trim());
    } else if (displayName === null) {
      writeStorage(DISPLAY_NAME_KEY, null);
    }
    if (refreshToken !== undefined) {
      setMedimadeRefreshToken(refreshToken);
    }
    scheduleAccessRefresh();
    window.dispatchEvent(new Event("medimade-session-changed"));
  } catch {
    /* */
  }
}

/** Explicit Log out only. No other path may clear the session. */
export function clearMedimadeSession(): void {
  if (typeof window === "undefined") return;
  const refreshForLogout = getMedimadeRefreshToken();
  memoryAccessJwt = null;
  clearAccessRefreshTimer();
  try {
    window.localStorage.removeItem(LEGACY_JWT_KEY);
    window.localStorage.removeItem(ACCESS_JWT_KEY);
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
    window.localStorage.removeItem(EMAIL_KEY);
    window.localStorage.removeItem(DISPLAY_NAME_KEY);
    window.localStorage.removeItem(ACTIVE_KEY);
    window.localStorage.removeItem(LEGACY_GUEST_KEY);
  } catch {
    /* */
  }
  // Wipe before notifying UI so a fast re-login cannot revive stale memory.
  void import("@/lib/ideate-cloud")
    .then((m) => {
      m.wipeIdeateDeviceData({ clearBackup: true });
    })
    .finally(() => {
      try {
        // Restore guest journal samples after account cache was stripped.
        void import("@/lib/journal-storage").then((j) => {
          j.resetJournalLocalToGuestDemos();
        });
        window.dispatchEvent(new Event("medimade-session-changed"));
      } catch {
        /* */
      }
    });
  // Best-effort server logout (clears HttpOnly refresh cookie + Dynamo row).
  void import("@/lib/medimade-api")
    .then((m) => m.logoutMedimadeSessionRemote(refreshForLogout))
    .catch(() => {
      /* */
    });
}

/**
 * Restore / rotate access JWT from refresh cookie or durable local refresh token.
 * Safe to call often — coalesces concurrent calls (including across HMR).
 *
 * Never clears the session here. Failed refresh keeps sticky signed-in state;
 * only clearMedimadeSession() (Log out) may wipe credentials.
 */
export async function ensureMedimadeSession(opts?: {
  force?: boolean;
}): Promise<boolean> {
  if (typeof window === "undefined") return false;
  hydrateAccessJwtFromStorage();
  if (!opts?.force && !accessJwtNeedsRefresh(memoryAccessJwt)) {
    scheduleAccessRefresh();
    return true;
  }
  if (!isMedimadeSessionActive() && !getMedimadeSessionEmail()) return false;

  const existingLock = getRefreshLock();
  if (existingLock) return existingLock.promise;
  if (refreshInFlight) return refreshInFlight;

  const previousJwt = memoryAccessJwt;

  const run = (async () => {
    try {
      const { refreshMedimadeSessionRemote } = await import("@/lib/medimade-api");
      const result = await refreshMedimadeSessionRemote();
      if (result.status === "ok" && result.token) {
        setMedimadeSession(
          result.token,
          result.email,
          result.displayName,
          result.refreshToken ?? undefined,
        );
        return true;
      }

      // Another tab may have rotated — adopt newer access JWT / refresh from storage.
      hydrateAccessJwtFromStorage();
      const adopted = memoryAccessJwt;
      const adoptedExp = adopted ? readJwtExpMs(adopted) : null;
      const adoptedLive =
        Boolean(adopted) &&
        (!adoptedExp || adoptedExp - Date.now() > 30_000);

      if (adoptedLive) {
        scheduleAccessRefresh();
        return true;
      }

      if (previousJwt) {
        const prevExp = readJwtExpMs(previousJwt);
        const prevLive = !prevExp || prevExp - Date.now() > 30_000;
        if (prevLive) {
          memoryAccessJwt = previousJwt;
          writeStorage(ACCESS_JWT_KEY, previousJwt);
          scheduleAccessRefresh();
          return true;
        }
      }

      // Keep sticky session + refresh token. One-off invalid/expired is usually a
      // race (another tab rotated) or a stale cookie — wiping signs people out.
      scheduleAccessRefresh();
      return Boolean(memoryAccessJwt);
    } catch {
      if (previousJwt) {
        memoryAccessJwt = previousJwt;
        writeStorage(ACCESS_JWT_KEY, previousJwt);
      }
      scheduleAccessRefresh();
      return Boolean(memoryAccessJwt);
    } finally {
      refreshInFlight = null;
      setRefreshLock(null);
    }
  })();

  refreshInFlight = run;
  setRefreshLock({ promise: run });
  return run;
}
