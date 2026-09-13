/**
 * App vs marketing route helpers — auth gating and post-login redirects.
 */

const AUTH_NEXT_STORAGE_KEY = "mm_auth_next_v1";

/** Same-origin path only (no protocol-relative URLs). */
export function safeAuthNext(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || typeof raw !== "string") return fallback;
  const t = raw.trim();
  if (!t.startsWith("/") || t.startsWith("//")) return fallback;
  // Block auth loops.
  if (
    t === "/login" ||
    t.startsWith("/login?") ||
    t.startsWith("/auth/")
  ) {
    return fallback;
  }
  return t;
}

export function rememberAuthNext(path: string): void {
  if (typeof window === "undefined") return;
  const next = safeAuthNext(path, "");
  if (!next) return;
  try {
    window.sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, next);
  } catch {
    /* */
  }
}

export function consumeAuthNext(fallback = "/"): string {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY);
    window.sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY);
    return safeAuthNext(raw, fallback);
  } catch {
    return fallback;
  }
}

export function peekAuthNext(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY);
    const next = safeAuthNext(raw, "");
    return next || null;
  } catch {
    return null;
  }
}

type PrefixRule = {
  /** Path prefix that requires a signed-in session. */
  prefix: string;
  /** Marketing page to land on when gated. */
  marketing: string;
};

const PROTECTED_PREFIXES: PrefixRule[] = [
  { prefix: "/meditate/create", marketing: "/meditate" },
  { prefix: "/meditate/library", marketing: "/meditate" },
  { prefix: "/meditate/sounds", marketing: "/meditate" },
  { prefix: "/create", marketing: "/meditate" },
  { prefix: "/library", marketing: "/meditate" },
  { prefix: "/journal/my", marketing: "/journal" },
  { prefix: "/ideate/my", marketing: "/ideate" },
  { prefix: "/ideate/goal", marketing: "/ideate" },
  { prefix: "/dream/my", marketing: "/ideate" },
  { prefix: "/dream/goal", marketing: "/ideate" },
  { prefix: "/plan/goal", marketing: "/ideate" },
  { prefix: "/plan/my", marketing: "/ideate" },
  { prefix: "/focus/my", marketing: "/focus" },
  { prefix: "/admin", marketing: "/" },
  { prefix: "/schedule", marketing: "/" },
  { prefix: "/analytics", marketing: "/" },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isProtectedAppPath(pathname: string): boolean {
  const path = pathname.split("?")[0]?.split("#")[0] || pathname;
  return PROTECTED_PREFIXES.some((r) => matchesPrefix(path, r.prefix));
}

export function marketingFallbackForPath(pathname: string): string {
  const path = pathname.split("?")[0]?.split("#")[0] || pathname;
  for (const r of PROTECTED_PREFIXES) {
    if (matchesPrefix(path, r.prefix)) return r.marketing;
  }
  return "/";
}

/**
 * Build marketing URL with sign-in overlay + return path.
 * e.g. /ideate?signin=1&next=%2Fideate%2Fmy
 */
export function marketingSignInUrl(
  pathname: string,
  search = "",
): string {
  const full = `${pathname}${search || ""}`;
  const marketing = marketingFallbackForPath(pathname);
  const params = new URLSearchParams();
  params.set("signin", "1");
  params.set("next", safeAuthNext(full, marketing));
  return `${marketing}?${params.toString()}`;
}

export function isPublicAuthPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/auth/")
  );
}

/**
 * Marketing section roots → app destinations for signed-in users.
 * Exact path only (not nested routes). `/` is handled as the welcome dashboard
 * (same URL, different page) rather than a redirect.
 */
const MARKETING_ROOT_APP_DESTINATIONS: Record<string, string> = {
  "/meditate": "/meditate/library/creations",
  "/journal": "/journal/my",
  "/ideate": "/ideate/my",
  "/dream": "/ideate/my",
  "/focus": "/focus/my",
};

/** Normalize pathname (no query/hash, no trailing slash except `/`). */
export function normalizeAppPathname(pathname: string): string {
  const path = pathname.split("?")[0]?.split("#")[0] || pathname;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

/**
 * If this marketing root should bounce signed-in users into the app, return
 * the destination. Otherwise null (including `/`, which stays as welcome home).
 */
export function signedInDestinationForMarketingRoot(
  pathname: string,
): string | null {
  const path = normalizeAppPathname(pathname);
  return MARKETING_ROOT_APP_DESTINATIONS[path] ?? null;
}

