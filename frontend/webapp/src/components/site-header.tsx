"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import {
  clearMedimadeSession,
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  isMedimadeSessionActive,
} from "@/lib/medimade-api";
import {
  COLOR_SCHEME_CHANGED_EVENT,
  applyColorScheme,
  getStoredColorScheme,
  toggleColorScheme,
  type ColorScheme,
} from "@/lib/color-scheme";
import { markSpaClientNavigation } from "@/lib/spa-client-nav";

/** Marketing / logged-out top nav — section roots only (no app flyouts). */
const marketingNav: { href: string; label: string }[] = [
  { href: "/meditate", label: "Meditate" },
  { href: "/journal", label: "Journal" },
  { href: "/ideate", label: "Ideate" },
  { href: "/focus", label: "Focus" },
  { href: "/admin", label: "Admin" },
  { href: "/settings", label: "API" },
];

function sectionActive(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function ColorSchemeToggle({ className = "" }: { className?: string }) {
  const [scheme, setScheme] = useState<ColorScheme>("light");

  useEffect(() => {
    applyColorScheme(getStoredColorScheme());
    const sync = () => setScheme(getStoredColorScheme());
    sync();
    window.addEventListener(COLOR_SCHEME_CHANGED_EVENT, sync);
    return () => window.removeEventListener(COLOR_SCHEME_CHANGED_EVENT, sync);
  }, []);

  const isDark = scheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setScheme(toggleColorScheme())}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-marketing-nav-chrome text-nav-muted transition-[background-color,color,border-color] duration-150 ease-out hover:bg-nav-active hover:text-nav-foreground ${className}`}
    >
      {isDark ? (
        <Sun aria-hidden className="size-4" strokeWidth={2} />
      ) : (
        <Moon aria-hidden className="size-4" strokeWidth={2} />
      )}
    </button>
  );
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const prevPathnameRef = useRef(pathname);
  const mobileMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);

  useEffect(() => {
    if (prevPathnameRef.current !== pathname) {
      markSpaClientNavigation();
      prevPathnameRef.current = pathname;
    }
  }, [pathname]);

  useEffect(() => {
    const sync = () => {
      setSignedIn(isMedimadeSessionActive());
      const email = getMedimadeSessionEmail();
      setSessionLabel(
        getMedimadeSessionDisplayName()?.trim() || email || null,
      );
    };
    void import("@/lib/auth-session").then((m) =>
      m.ensureMedimadeSession().finally(sync),
    );
    window.addEventListener("medimade-session-changed", sync);
    return () => window.removeEventListener("medimade-session-changed", sync);
  }, []);

  const closeMobile = () => {
    if (mobileMenuRef.current) mobileMenuRef.current.open = false;
  };

  return (
    <header className="site-header relative sticky top-0 z-[100] border-b border-[color:var(--header-border)] bg-nav shadow-[var(--header-shadow)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="relative mx-auto h-full max-w-6xl px-4 sm:px-6">
          <span className="site-header-glow-sun absolute left-[17px] top-[calc(50%+1px)] h-36 w-72 -translate-x-1/2 -translate-y-1/2 blur-lg" />
        </div>
        <span className="site-header-glow-right absolute right-0 top-1/2 h-40 w-[22rem] translate-x-[42%] -translate-y-1/2 blur-xl" />
      </div>
      <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="relative inline-flex items-center">
          <LogoMark
            size={34}
            className="relative z-[1] top-px mr-[13px] shrink-0 text-accent-button"
          />
          <span className="brand-wordmark relative z-[1] -top-px font-display text-2xl font-medium tracking-tight lowercase">
            consciously
          </span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {marketingNav.map((item) => {
            const active =
              item.href === "/ideate"
                ? sectionActive(pathname, "/ideate") ||
                  sectionActive(pathname, "/dream")
                : sectionActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-nav-active hover:text-nav-foreground ${
                  active
                    ? "bg-nav-active font-semibold text-nav-foreground"
                    : "text-nav-muted"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
          <ColorSchemeToggle className="ml-1" />
          {signedIn ? (
            <div className="ml-1 flex items-center gap-2">
              <span
                className="hidden max-w-[10rem] truncate text-xs text-nav-muted md:inline"
                title={sessionLabel ?? ""}
              >
                {sessionLabel ?? "Signed in"}
              </span>
              <button
                type="button"
                onClick={() => clearMedimadeSession()}
                className="rounded-lg border border-marketing-nav-chrome px-3 py-2 text-sm text-nav-muted transition-[background-color,color,border-color] duration-150 ease-out hover:bg-nav-active hover:text-nav-foreground"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="ml-1 rounded-lg border border-marketing-nav-chrome px-3 py-2 text-sm font-medium text-nav-foreground transition-[background-color,color,border-color] duration-150 ease-out hover:bg-nav-active"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/pro"
            className="pro-header-cta ml-2 rounded-xl px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          >
            Pro
          </Link>
        </nav>
        <div className="flex items-center gap-2 sm:hidden">
          <ColorSchemeToggle />
          <details ref={mobileMenuRef} className="relative">
            <summary
              aria-label="Menu"
              className="cursor-pointer list-none rounded-lg border border-marketing-nav-chrome p-2 text-sm text-nav-foreground"
            >
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </summary>
            <div className="absolute right-0 mt-2 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-border bg-card py-2 shadow-lg">
              {marketingNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobile}
                  className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
                    sectionActive(pathname, item.href)
                      ? "font-semibold text-foreground"
                      : "text-muted"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
              <div className="my-2 border-t border-border" role="separator" />
              {signedIn ? (
                <button
                  type="button"
                  onClick={() => {
                    clearMedimadeSession();
                    closeMobile();
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-muted hover:bg-accent-soft/50"
                >
                  Sign out
                </button>
              ) : (
                <Link
                  href="/login"
                  onClick={closeMobile}
                  className="block px-4 py-2 text-sm font-medium text-foreground hover:bg-accent-soft/50"
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/pro"
                onClick={closeMobile}
                className="block px-4 py-2 text-sm font-medium text-accent-link hover:bg-accent-soft/50"
              >
                Pro
              </Link>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
