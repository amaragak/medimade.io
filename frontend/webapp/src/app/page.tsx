"use client";

import { useEffect, useState } from "react";
import { EnhancedHomePage } from "@/components/enhanced-home-page";
import { WelcomeDashboard } from "@/components/welcome-dashboard";
import {
  getMedimadeSessionJwt,
  isMedimadeSessionActive,
} from "@/lib/auth-session";
import { isMarketingPreviewMode } from "@/lib/marketing-preview";

function hasAppSession(): boolean {
  return isMedimadeSessionActive() && Boolean(getMedimadeSessionJwt());
}

/**
 * Logged-out / marketing preview: marketing home.
 * Logged-in (app chrome): welcome / dashboard (same `/` URL).
 */
export default function HomePage() {
  const [ready, setReady] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);

  useEffect(() => {
    const sync = () => {
      setShowDashboard(hasAppSession() && !isMarketingPreviewMode());
      setReady(true);
    };
    void import("@/lib/auth-session").then((m) =>
      m.ensureMedimadeSession().finally(sync),
    );
    window.addEventListener("medimade-session-changed", sync);
    return () => window.removeEventListener("medimade-session-changed", sync);
  }, []);

  if (!ready) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-sm text-muted">
        Loading…
      </div>
    );
  }

  if (showDashboard) return <WelcomeDashboard />;
  return <EnhancedHomePage />;
}
