/**
 * Reads the JWT payload without verifying the signature (browser has no secret).
 * Used only for UX: profile completion, syncing display name from claims to localStorage.
 */
export function decodeMedimadeJwtPayloadUnverified(
  token: string,
): { sub?: string; email?: string; name?: string } | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(b64 + pad);
    const p = JSON.parse(json) as Record<string, unknown>;
    return {
      sub: typeof p.sub === "string" ? p.sub : undefined,
      email: typeof p.email === "string" ? p.email : undefined,
      name: typeof p.name === "string" ? p.name : undefined,
    };
  } catch {
    return null;
  }
}
