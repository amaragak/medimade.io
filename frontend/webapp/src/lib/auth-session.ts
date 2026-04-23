const JWT_KEY = "mm_session_jwt_v1";
const EMAIL_KEY = "mm_session_email_v1";
const DISPLAY_NAME_KEY = "mm_session_display_name_v1";

export function getMedimadeSessionJwt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const t = window.localStorage.getItem(JWT_KEY)?.trim();
    return t || null;
  } catch {
    return null;
  }
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

export function setMedimadeSession(
  token: string,
  email?: string | null,
  displayName?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(JWT_KEY, token.trim());
    if (email?.trim()) window.localStorage.setItem(EMAIL_KEY, email.trim());
    else window.localStorage.removeItem(EMAIL_KEY);
    if (displayName?.trim())
      window.localStorage.setItem(DISPLAY_NAME_KEY, displayName.trim());
    else window.localStorage.removeItem(DISPLAY_NAME_KEY);
    window.dispatchEvent(new Event("medimade-session-changed"));
  } catch {
    /* */
  }
}

export function clearMedimadeSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(JWT_KEY);
    window.localStorage.removeItem(EMAIL_KEY);
    window.localStorage.removeItem(DISPLAY_NAME_KEY);
    window.dispatchEvent(new Event("medimade-session-changed"));
  } catch {
    /* */
  }
}
