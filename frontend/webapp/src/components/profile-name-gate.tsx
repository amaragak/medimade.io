"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import {
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
  setMedimadeSession,
} from "@/lib/auth-session";
import { decodeMedimadeJwtPayloadUnverified } from "@/lib/medimade-jwt-payload";

/**
 * Sends signed-in users without a display name (per JWT `name` claim) to complete profile.
 * Skips auth routes and login so magic-link verify and name capture still work.
 */
export function ProfileNameGate() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (!pathname) return;
    if (pathname === "/login" || pathname.startsWith("/auth/")) return;

    const jwt = getMedimadeSessionJwt();
    if (!jwt) return;

    const lsName = getMedimadeSessionDisplayName();
    if (lsName?.trim()) return;

    const payload = decodeMedimadeJwtPayloadUnverified(jwt);
    const claimName = payload?.name?.trim();
    if (claimName) {
      setMedimadeSession(jwt, getMedimadeSessionEmail(), claimName);
      return;
    }

    const next = `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`;
    router.replace(`/auth/complete-profile?next=${encodeURIComponent(next)}`);
  }, [pathname, router, searchParams]);

  return null;
}
