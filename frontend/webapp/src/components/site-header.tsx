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
  getMedimadeSessionJwt,
} from "@/lib/medimade-api";
import {
  COLOR_SCHEME_CHANGED_EVENT,
  applyColorScheme,
  getStoredColorScheme,
  toggleColorScheme,
  type ColorScheme,
} from "@/lib/color-scheme";
import { markSpaClientNavigation } from "@/lib/spa-client-nav";

type NavSubItem = { href: string; label: string };

const meditateSub: NavSubItem[] = [
  { href: "/meditate/create", label: "Create" },
  { href: "/meditate/library/creations", label: "Library" },
  { href: "/meditate/sounds", label: "Sounds" },
];

const journalSub: NavSubItem[] = [
  { href: "/journal/my", label: "My Journal" },
];

const ideateSub: NavSubItem[] = [
  { href: "/ideate/my", label: "My Ideas" },
];

const focusSub: NavSubItem[] = [];

const utilityNav: NavSubItem[] = [
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

function NavFlyout({
  href,
  label,
  items,
  active,
  isItemActive,
}: {
  href: string;
  label: string;
  items: NavSubItem[];
  active: boolean;
  isItemActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const hasMenu = items.length > 0;

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        if (hasMenu) setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
      onFocusCapture={() => {
        if (hasMenu) setOpen(true);
      }}
      onBlurCapture={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setOpen(false);
      }}
    >
      <Link
        href={href}
        aria-haspopup={hasMenu ? "true" : undefined}
        aria-expanded={hasMenu ? open : undefined}
        className={`inline-flex rounded-lg px-3 py-2 text-sm transition-colors hover:bg-nav-active hover:text-nav-foreground ${
          active
            ? "bg-nav-active font-semibold text-nav-foreground"
            : "text-nav-muted"
        }`}
      >
        {label}
      </Link>
      {hasMenu && open ? (
        <div
          className="absolute left-0 top-full z-[110] min-w-[11rem] pt-1"
          role="menu"
          aria-label={label}
        >
          <div className="rounded-xl border border-border bg-card py-1 shadow-lg">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={isItemActive(item.href) ? "page" : undefined}
                className={`block px-3 py-2 text-sm transition-colors hover:bg-accent-soft/50 ${
                  isItemActive(item.href)
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
  );
}

function MobileSection({
  title,
  overviewHref,
  overviewLabel = "Overview",
  items,
  pathname,
  isItemActive,
  onNavigate,
}: {
  title: string;
  overviewHref: string;
  overviewLabel?: string;
  items: NavSubItem[];
  pathname: string;
  isItemActive: (href: string) => boolean;
  onNavigate: () => void;
}) {
  return (
    <>
      <p className="px-4 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </p>
      <Link
        href={overviewHref}
        onClick={onNavigate}
        className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
          pathname === overviewHref ? "font-semibold text-foreground" : ""
        }`}
      >
        {overviewLabel}
      </Link>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          aria-current={isItemActive(item.href) ? "page" : undefined}
          className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
            isItemActive(item.href) ? "font-semibold text-foreground" : ""
          }`}
        >
          {item.label}
        </Link>
      ))}
    </>
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
      setSignedIn(Boolean(getMedimadeSessionJwt()));
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

  const isItemActive = (href: string) =>
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);

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
        <Link
          href="/"
          className="relative inline-flex items-center"
        >
          <LogoMark
            size={34}
            className="relative z-[1] top-px mr-[13px] shrink-0 text-accent-button"
          />
          <span className="brand-wordmark relative z-[1] -top-px font-display text-2xl font-medium tracking-tight lowercase">
            consciously
          </span>
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          <NavFlyout
            href="/meditate"
            label="Meditate"
            items={meditateSub}
            active={sectionActive(pathname, "/meditate")}
            isItemActive={isItemActive}
          />
          <NavFlyout
            href="/journal"
            label="Journal"
            items={journalSub}
            active={sectionActive(pathname, "/journal")}
            isItemActive={isItemActive}
          />
          <NavFlyout
            href="/ideate"
            label="Ideate"
            items={ideateSub}
            active={sectionActive(pathname, "/ideate")}
            isItemActive={isItemActive}
          />
          <NavFlyout
            href="/focus"
            label="Focus"
            items={focusSub}
            active={sectionActive(pathname, "/focus")}
            isItemActive={isItemActive}
          />
          {utilityNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isItemActive(item.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-nav-active hover:text-nav-foreground ${
                isItemActive(item.href)
                  ? "bg-nav-active font-semibold text-nav-foreground"
                  : "text-nav-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
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
              <MobileSection
                title="Meditate"
                overviewHref="/meditate"
                items={meditateSub}
                pathname={pathname}
                isItemActive={isItemActive}
                onNavigate={closeMobile}
              />
              <div className="my-2 border-t border-border" role="separator" />
              <MobileSection
                title="Journal"
                overviewHref="/journal"
                items={journalSub}
                pathname={pathname}
                isItemActive={isItemActive}
                onNavigate={closeMobile}
              />
              <div className="my-2 border-t border-border" role="separator" />
              <MobileSection
                title="Ideate"
                overviewHref="/ideate"
                items={ideateSub}
                pathname={pathname}
                isItemActive={isItemActive}
                onNavigate={closeMobile}
              />
              <div className="my-2 border-t border-border" role="separator" />
              <MobileSection
                title="Focus"
                overviewHref="/focus"
                items={focusSub}
                pathname={pathname}
                isItemActive={isItemActive}
                onNavigate={closeMobile}
              />
              <div className="my-2 border-t border-border" role="separator" />
              {utilityNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={closeMobile}
                  aria-current={isItemActive(item.href) ? "page" : undefined}
                  className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
                    isItemActive(item.href) ? "font-semibold text-foreground" : ""
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
                    closeMobile();
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-muted"
                >
                  Sign out
                </button>
              ) : (
                <Link
                  href="/login"
                  onClick={closeMobile}
                  className="block px-4 py-2 text-sm font-medium text-accent-link"
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/pro"
                onClick={closeMobile}
                className="block px-4 py-2 text-sm font-medium text-accent-link"
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
