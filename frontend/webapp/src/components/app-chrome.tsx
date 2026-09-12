"use client";

import { type ReactNode, Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { AppTopBar } from "@/components/app-top-bar";
import { AppPrimaryTabsProvider } from "@/components/app-primary-tabs";
import { MainShell } from "@/components/main-shell";
import { SiteHeader } from "@/components/site-header";
import {
  SignInPromptOverlay,
  useSignInPromptQuery,
} from "@/components/sign-in-prompt-overlay";
import {
  isProtectedAppPath,
  isPublicAuthPath,
  marketingSignInUrl,
  rememberAuthNext,
  signedInDestinationForMarketingRoot,
} from "@/lib/app-routes";
import {
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
  isMedimadeSessionActive,
} from "@/lib/auth-session";
import {
  exitMarketingPreviewMode,
  isMarketingPreviewMode,
} from "@/lib/marketing-preview";

/** Sidebar / app shell needs a real access JWT, not sticky ACTIVE_KEY alone. */
function hasAppSession(): boolean {
  return isMedimadeSessionActive() && Boolean(getMedimadeSessionJwt());
}

function SignInOverlayHost() {
  const { wantsSignIn, nextPath, clearSignInQuery } = useSignInPromptQuery();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(wantsSignIn);
  }, [wantsSignIn]);

  return (
    <SignInPromptOverlay
      open={open}
      nextPath={nextPath}
      onDismiss={() => {
        setOpen(false);
        clearSignInQuery();
      }}
    />
  );
}

/**
 * Logged-out: marketing top nav (+ optional sign-in overlay).
 * Logged-in: sidebar + minimal top bar.
 * Marketing preview keeps the JWT but uses marketing chrome.
 * Protected app URLs redirect to the marketing section with ?signin=1&next=…
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const searchParams = useSearchParams();
  const [signedIn, setSignedIn] = useState(false);
  const [marketingPreview, setMarketingPreview] = useState(false);
  const [ready, setReady] = useState(false);
  const [accountLabel, setAccountLabel] = useState("Guest");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const sync = () => {
      setSignedIn(hasAppSession());
      setMarketingPreview(isMarketingPreviewMode());
      setAccountLabel(
        getMedimadeSessionDisplayName()?.trim() ||
          getMedimadeSessionEmail()?.trim() ||
          "Guest",
      );
      setReady(true);
    };
    void import("@/lib/auth-session").then((m) =>
      m.ensureMedimadeSession().finally(sync),
    );
    window.addEventListener("medimade-session-changed", sync);
    return () => window.removeEventListener("medimade-session-changed", sync);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [signedIn, marketingPreview, pathname]);

  const showAppChrome = signedIn && !marketingPreview;

  // Hitting a protected app URL while in marketing preview → open the app.
  useEffect(() => {
    if (!ready || !signedIn || !marketingPreview) return;
    if (!isProtectedAppPath(pathname) || isPublicAuthPath(pathname)) return;
    exitMarketingPreviewMode();
  }, [ready, signedIn, marketingPreview, pathname]);

  // Gate protected app routes when logged out (no JWT).
  useEffect(() => {
    if (!ready || signedIn) return;
    if (isPublicAuthPath(pathname)) return;
    if (!isProtectedAppPath(pathname)) return;
    const search = searchParams?.toString()
      ? `?${searchParams.toString()}`
      : "";
    const full = `${pathname}${search}`;
    rememberAuthNext(full);
    router.replace(marketingSignInUrl(pathname, search));
  }, [ready, signedIn, pathname, searchParams, router]);

  // Marketing section roots → app destinations when signed in (not in preview).
  useEffect(() => {
    if (!ready || !showAppChrome) return;
    const dest = signedInDestinationForMarketingRoot(pathname);
    if (!dest) return;
    router.replace(dest);
  }, [ready, showAppChrome, pathname, router]);

  const gateProtected =
    isProtectedAppPath(pathname) && !isPublicAuthPath(pathname);
  const bounceToApp = Boolean(
    showAppChrome && signedInDestinationForMarketingRoot(pathname),
  );

  // Avoid flashing the wrong chrome (or protected page body) before session hydrate.
  if (!ready) {
    if (gateProtected) {
      return (
        <>
          <div className="h-14 shrink-0 border-b border-border bg-nav" aria-hidden />
          <MainShell>
            <div className="mx-auto max-w-md px-4 py-20 text-sm text-muted">
              Loading…
            </div>
          </MainShell>
        </>
      );
    }
    return (
      <>
        <div className="h-14 shrink-0 border-b border-border bg-nav" aria-hidden />
        <MainShell>{children}</MainShell>
      </>
    );
  }

  if (!showAppChrome) {
    // While redirecting away from a protected URL (no session), don't flash app content.
    if (gateProtected && !signedIn) {
      return (
        <>
          <SiteHeader />
          <MainShell>
            <div className="mx-auto max-w-md px-4 py-20 text-sm text-muted">
              Redirecting…
            </div>
          </MainShell>
        </>
      );
    }
    return (
      <>
        <SiteHeader />
        <MainShell>{children}</MainShell>
        <Suspense fallback={null}>
          <SignInOverlayHost />
        </Suspense>
      </>
    );
  }

  return (
    <AppPrimaryTabsProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <AppTopBar
          mobileSidebarOpen={mobileOpen}
          onToggleSidebar={() => setMobileOpen((v) => !v)}
        />
        <div className="flex min-h-0 flex-1">
          <div className="hidden w-[200px] shrink-0 md:block" aria-hidden />
          <AppSidebar
            accountLabel={accountLabel}
            mobileOpen={mobileOpen}
            onCloseMobile={() => setMobileOpen(false)}
            onNavigate={() => setMobileOpen(false)}
          />
          <MainShell layout="app">
            {bounceToApp ? (
              <div className="mx-auto max-w-md px-4 py-20 text-sm text-muted">
                Redirecting…
              </div>
            ) : (
              children
            )}
          </MainShell>
        </div>
      </div>
    </AppPrimaryTabsProvider>
  );
}
