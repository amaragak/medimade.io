"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import { AppPrimaryTabsSlot } from "@/components/app-primary-tabs";
import {
  buildAppBreadcrumbs,
  type AppBreadcrumbCrumb,
} from "@/lib/app-nav";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import { subscribeIdeateCloud } from "@/lib/ideate-cloud";

type Props = {
  onOpenSidebar?: () => void;
};

function lifeAreaTitleFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/ideate\/goal\/([^/?#]+)/);
  if (!m?.[1]) return null;
  try {
    const id = decodeURIComponent(m[1]);
    const dream = loadIdeateStore().dreams.find((d) => d.id === id);
    return dream?.title?.trim() || null;
  } catch {
    return null;
  }
}

export function AppTopBar({ onOpenSidebar }: Props) {
  const pathname = usePathname() || "/";
  const [crumbs, setCrumbs] = useState<AppBreadcrumbCrumb[]>([]);

  useEffect(() => {
    const rebuild = () => {
      setCrumbs(
        buildAppBreadcrumbs(pathname, {
          lifeAreaTitle: lifeAreaTitleFromPath(pathname),
          hash: typeof window !== "undefined" ? window.location.hash : "",
          search: typeof window !== "undefined" ? window.location.search : "",
        }),
      );
    };
    rebuild();
    const unsub = subscribeIdeateCloud(rebuild);
    window.addEventListener("storage", rebuild);
    return () => {
      unsub();
      window.removeEventListener("storage", rebuild);
    };
  }, [pathname]);

  return (
    <header className="relative sticky top-0 z-[130] flex h-14 w-full shrink-0 items-center border-b border-border bg-background">
      {/* Left-aligned with sidebar nav icons (px-2 + link px-2.5). */}
      <div className="relative z-10 hidden h-full w-[200px] shrink-0 items-center px-2 md:flex">
        <Link
          href="/"
          className="inline-flex min-w-0 items-center gap-2 px-2.5"
        >
          <LogoMark
            size={28}
            className="relative z-[1] shrink-0 text-accent-button"
          />
          <span className="brand-wordmark truncate font-display text-xl font-medium tracking-tight lowercase">
            consciously
          </span>
        </Link>
      </div>

      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-3 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          {onOpenSidebar ? (
            <button
              type="button"
              aria-label="Open menu"
              onClick={onOpenSidebar}
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border text-foreground md:hidden"
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
            </button>
          ) : null}
          {/* Mobile: compact wordmark beside menu. */}
          <Link
            href="/"
            className="inline-flex min-w-0 items-center md:hidden"
          >
            <LogoMark
              size={24}
              className="relative z-[1] mr-1.5 shrink-0 text-accent-button"
            />
            <span className="brand-wordmark truncate font-display text-lg font-medium tracking-tight lowercase">
              consciously
            </span>
          </Link>
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 items-center truncate font-display text-lg font-medium tracking-tight md:flex"
          >
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              const earlier = !last;
              return (
                <Fragment key={`${c.label}-${i}`}>
                  {i > 0 ? (
                    <span
                      className="mx-2.5 inline-flex shrink-0 items-center text-muted"
                      aria-hidden
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="15"
                        height="15"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="opacity-70"
                      >
                        <path d="M9 6l6 6-6 6" />
                      </svg>
                    </span>
                  ) : null}
                  {last || !c.href ? (
                    <span
                      className={
                        last
                          ? "text-foreground"
                          : earlier
                            ? "italic text-muted"
                            : "text-muted"
                      }
                    >
                      {c.label}
                    </span>
                  ) : (
                    <Link
                      href={c.href}
                      className={`italic text-accent-link underline-offset-2 hover:underline`}
                    >
                      {c.label}
                    </Link>
                  )}
                </Fragment>
              );
            })}
          </nav>
        </div>
      </div>

      {/* True viewport centre (full header width), not content-area centre. */}
      <div className="pointer-events-none absolute inset-0 z-[5] hidden items-center justify-center md:flex">
        <AppPrimaryTabsSlot className="pointer-events-auto flex max-w-[min(100%,48rem)] items-center justify-center overflow-x-auto" />
      </div>
    </header>
  );
}
