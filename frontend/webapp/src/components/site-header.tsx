"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/create", label: "Create" },
  ...(process.env.NODE_ENV !== "production"
    ? [{ href: "/analytics", label: "Analytics" }]
    : []),
  { href: "/library", label: "Library" },
  { href: "/schedule", label: "Schedule" },
  { href: "/settings", label: "API" },
];

export function SiteHeader() {
  const pathname = usePathname() || "/";
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
          medimade.io
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive(item.href) ? "page" : undefined}
              className={`rounded-lg px-3 py-2 text-sm transition-colors hover:bg-card hover:text-foreground ${
                isActive(item.href)
                  ? "bg-card text-foreground font-semibold"
                  : "text-muted"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/pro"
            className="ml-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90 dark:text-deep"
          >
            Pro
          </Link>
        </nav>
        <details className="relative sm:hidden">
          <summary className="cursor-pointer list-none rounded-lg border border-border px-3 py-2 text-sm">
            Menu
          </summary>
          <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card py-2 shadow-lg">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive(item.href) ? "page" : undefined}
                className={`block px-4 py-2 text-sm hover:bg-accent-soft/50 ${
                  isActive(item.href) ? "font-semibold text-foreground" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
            <Link
              href="/pro"
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
