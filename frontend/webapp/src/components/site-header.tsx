"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import {
  clearMedimadeSession,
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
} from "@/lib/medimade-api";

const meditateSub = [
  { href: "/meditate/create", label: "Create" },
  { href: "/meditate/library", label: "Library" },
  { href: "/meditate/sounds", label: "Sounds" },
] as const;

const navRest = [
  { href: "/journal", label: "Journal" },
  { href: "/ideate", label: "Ideate" },
  { href: "/focus", label: "Focus" },
  { href: "/admin", label: "Admin" },
  { href: "/settings", label: "API" },
] as const;

function isMeditateSection(path: string): boolean {
  return path === "/meditate" || path.startsWith("/meditate/");
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const mobileMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [meditateMenuOpen, setMeditateMenuOpen] = useState(false);
  /** Session is read from storage; SSR has no JWT — keep initial false so server and first client paint match (avoids hydration mismatch). */
  const [signedIn, setSignedIn] = useState(false);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setSignedIn(Boolean(getMedimadeSessionJwt()));
      const email = getMedimadeSessionEmail();
      setSessionLabel(
        getMedimadeSessionDisplayName()?.trim() || email || null,
      );
    };
    sync();
    window.addEventListener("medimade-session-changed", sync);
    return () => window.removeEventListener("medimade-session-changed", sync);
  }, []);
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className="relative sticky top-0 z-[100] border-b border-white/10 bg-nav shadow-[0_4px_18px_rgb(30_37_48_/_0.22)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="relative mx-auto h-full max-w-6xl px-4 sm:px-6">
          <span
            className="absolute left-[17px] top-[calc(50%+1px)] h-36 w-72 -translate-x-1/2 -translate-y-1/2 blur-lg"
            style={{
              background:
                "radial-gradient(circle, rgb(118 148 176 / 0.42) 0%, rgb(88 118 146 / 0.2) 42%, rgb(51 70 92 / 0) 78%)",
            }}
          />
        </div>
        <span
          className="absolute right-0 top-1/2 h-40 w-[22rem] translate-x-[42%] -translate-y-1/2 blur-xl"
          style={{
            background:
              "radial-gradient(circle, rgb(28 42 58 / 0.92) 0%, rgb(36 52 70 / 0.48) 32%, rgb(51 70 92 / 0) 68%)",
          }}
        />
      </div>
      <div className="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="relative inline-flex items-center text-nav-foreground"
        >
          <LogoMark
            size={34}
            className="relative z-[1] top-px mr-[13px] shrink-0"
          />
          <span className="relative z-[1] -top-px font-display text-2xl font-medium tracking-tight lowercase">
            consciously
          </span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          <div
            className="relative"
            onMouseEnter={() => setMeditateMenuOpen(true)}
            onMouseLeave={() => setMeditateMenuOpen(false)}
            onFocusCapture={() => setMeditateMenuOpen(true)}
            onBlurCapture={(e) => {
              const next = e.relatedTarget as Node | null;
              if (next && e.currentTarget.contains(next)) return;
              setMeditateMenuOpen(false);
            }}
          >
            <Link
              href="/meditate"
              aria-haspopup="true"
              aria-expanded={meditateMenuOpen}
              className={`inline-flex rounded-lg px-3 py-2 text-sm transition-colors hover:bg-nav-active hover:text-nav-foreground ${
                isMeditateSection(pathname)
                  ? "bg-nav-active font-semibold text-nav-foreground"
                  : "text-nav-muted"
              }`}
            >
              Meditate
            </Link>
            {meditateMenuOpen ? (
              <div
                className="absolute left-0 top-full z-[110] min-w-[11rem] pt-1"
                role="menu"
                aria-label="Meditate"
              >
                <div className="rounded-xl border border-border bg-card py-1 shadow-lg">
                  {meditateSub.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      aria-current={isActive(item.href) ? "page" : undefined}
                      className={`block px-3 py-2 text-sm transition-colors hover:bg-accent-soft/50 ${
                        isActive(item.href)
                          ? "font-semibold text-foreground"
                          : "text-muted"
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          {navRest.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-nav-active hover:text-nav-foreground ${
                isActive(item.href)
                  ? "bg-nav-active font-semibold text-nav-foreground"
                  : "text-nav-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {signedIn ? (
            <div className="ml-2 flex items-center gap-2">
              <span
                className="hidden max-w-[10rem] truncate text-xs text-nav-muted md:inline"
                title={sessionLabel ?? ""}
              >
                {sessionLabel ?? "Signed in"}
              </span>
              <button
                type="button"
                onClick={() => clearMedimadeSession()}
                className="rounded-lg border border-white/20 px-3 py-2 text-sm text-nav-muted transition-colors hover:bg-nav-active hover:text-nav-foreground"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="ml-2 rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-nav-foreground transition-colors hover:bg-nav-active"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/pro"
            className="ml-2 rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-sm transition-opacity hover:opacity-90"
          >
            Pro
          </Link>
        </nav>
        <details ref={mobileMenuRef} className="relative sm:hidden">
          <summary
            aria-label="Menu"
            className="cursor-pointer list-none rounded-lg border border-white/20 p-2 text-sm text-nav-foreground"
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
          <div className="absolute right-0 mt-2 w-52 rounded-xl border border-border bg-card py-2 shadow-lg">
            <p className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Meditate
            </p>
            <Link
              href="/meditate"
              onClick={() => {
                if (mobileMenuRef.current) mobileMenuRef.current.open = false;
              }}
              className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
                pathname === "/meditate" ? "font-semibold text-foreground" : ""
              }`}
            >
              Overview
            </Link>
            {meditateSub.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (mobileMenuRef.current) mobileMenuRef.current.open = false;
                }}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
                  isActive(item.href) ? "font-semibold text-foreground" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="my-2 border-t border-border" role="separator" />
            {navRest.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (mobileMenuRef.current) mobileMenuRef.current.open = false;
                }}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
                  isActive(item.href) ? "font-semibold text-foreground" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
            {signedIn ? (
              <button
                type="button"
                onClick={() => {
                  clearMedimadeSession();
                  if (mobileMenuRef.current) mobileMenuRef.current.open = false;
                }}
                className="block w-full px-4 py-2 text-left text-sm text-muted"
              >
                Sign out
              </button>
            ) : (
              <Link
                href="/login"
                onClick={() => {
                  if (mobileMenuRef.current) mobileMenuRef.current.open = false;
                }}
                className="block px-4 py-2 text-sm font-medium text-accent-link"
              >
                Sign in
              </Link>
            )}
            <Link
              href="/pro"
              onClick={() => {
                if (mobileMenuRef.current) mobileMenuRef.current.open = false;
              }}
              className="block px-4 py-2 text-sm font-medium text-accent-link"
            >
              Pro
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}
