"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  clearMedimadeSession,
  getMedimadeSessionDisplayName,
  getMedimadeSessionEmail,
  getMedimadeSessionJwt,
} from "@/lib/medimade-api";

const meditateSub = [
  { href: "/meditate/create", label: "Create" },
  { href: "/meditate/library", label: "Library" },
] as const;

const navRest = [
  { href: "/journal", label: "Journal" },
  { href: "/plan", label: "Plan" },
  { href: "/focus", label: "Focus" },
  ...(process.env.NODE_ENV !== "production"
    ? [{ href: "/analytics", label: "Analytics" }]
    : []),
  { href: "/settings", label: "API" },
] as const;

function isMeditateSection(path: string): boolean {
  return path === "/meditate" || path.startsWith("/meditate/");
}

export function SiteHeader() {
  const pathname = usePathname() || "/";
  const mobileMenuRef = useRef<HTMLDetailsElement | null>(null);
  const [, bump] = useState(0);
  const [meditateMenuOpen, setMeditateMenuOpen] = useState(false);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener("medimade-session-changed", on);
    return () => window.removeEventListener("medimade-session-changed", on);
  }, []);
  const signedIn = Boolean(getMedimadeSessionJwt());
  const sessionEmail = getMedimadeSessionEmail();
  const sessionLabel =
    getMedimadeSessionDisplayName()?.trim() || sessionEmail || null;
  const isActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="font-display text-lg font-medium tracking-tight text-foreground"
        >
          Consciously
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
              className={`inline-flex rounded-lg px-3 py-2 text-sm transition-colors hover:bg-card hover:text-foreground ${
                isMeditateSection(pathname)
                  ? "bg-card font-semibold text-foreground"
                  : "text-muted"
              }`}
            >
              Meditate
            </Link>
            {meditateMenuOpen ? (
              <div
                className="absolute left-0 top-full z-50 min-w-[11rem] pt-1"
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
              className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-card hover:text-foreground ${
                isActive(item.href)
                  ? "bg-card font-semibold text-foreground"
                  : "text-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
          {signedIn ? (
            <div className="ml-2 flex items-center gap-2">
              <span
                className="hidden max-w-[10rem] truncate text-xs text-muted md:inline"
                title={sessionLabel ?? ""}
              >
                {sessionLabel ?? "Signed in"}
              </span>
              <button
                type="button"
                onClick={() => clearMedimadeSession()}
                className="rounded-lg border border-border px-3 py-2 text-sm text-muted transition-colors hover:bg-card hover:text-foreground"
              >
                Sign out
              </button>
            </div>
          ) : (
            <Link
              href="/login"
              className="ml-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card"
            >
              Sign in
            </Link>
          )}
          <Link
            href="/pro"
            className="ml-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 dark:text-deep"
          >
            Pro
          </Link>
        </nav>
        <details ref={mobileMenuRef} className="relative sm:hidden">
          <summary
            aria-label="Menu"
            className="cursor-pointer list-none rounded-lg border border-border p-2 text-sm"
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
                className="block px-4 py-2 text-sm font-medium text-accent"
              >
                Sign in
              </Link>
            )}
            <Link
              href="/pro"
              onClick={() => {
                if (mobileMenuRef.current) mobileMenuRef.current.open = false;
              }}
              className="block px-4 py-2 text-sm font-medium text-accent"
            >
              Pro
            </Link>
          </div>
        </details>
      </div>
    </header>
  );
}
