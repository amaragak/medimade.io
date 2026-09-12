"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { LogoMark } from "@/components/logo-mark";
import { AppPrimaryTabsSlot, AppTopBarTrailingSlot } from "@/components/app-primary-tabs";
import { AlphaChromeButton } from "@/components/dev-chrome-button";
import {
  buildAppBreadcrumbs,
  type AppBreadcrumbCrumb,
} from "@/lib/app-nav";
import { enterMarketingPreviewMode } from "@/lib/marketing-preview";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import { subscribeIdeateCloud } from "@/lib/ideate-cloud";
import {
  CREATE_SESSION_CHANGED_EVENT,
  readCreateSession,
} from "@/lib/create-session-storage";

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

function createMeditationStyleFromSession(): string | null {
  return readCreateSession()?.meditationStyle?.trim() || null;
}

function BreadcrumbChevron() {
  return (
    <span
      className="mx-1.5 inline-flex shrink-0 items-center text-muted md:mx-2.5"
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
  );
}

function BreadcrumbCrumb({
  crumb,
  last,
}: {
  crumb: AppBreadcrumbCrumb;
  last: boolean;
}) {
  if (last || !crumb.href) {
    return (
      <span
        className={`min-w-0 truncate ${
          last ? "text-foreground" : "italic text-muted"
        }`}
      >
        {crumb.label}
      </span>
    );
  }
  return (
    <Link
      href={crumb.href}
      className="min-w-0 truncate italic text-neutral-600 underline-offset-2 hover:underline dark:text-accent-link"
    >
      {crumb.label}
    </Link>
  );
}

export function AppTopBar({
  mobileSidebarOpen = false,
  onToggleSidebar,
}: {
  mobileSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [crumbs, setCrumbs] = useState<AppBreadcrumbCrumb[]>([]);

  useEffect(() => {
    const rebuild = () => {
      setCrumbs(
        buildAppBreadcrumbs(pathname, {
          lifeAreaTitle: lifeAreaTitleFromPath(pathname),
          createMeditationStyle: createMeditationStyleFromSession(),
          hash: typeof window !== "undefined" ? window.location.hash : "",
          search: typeof window !== "undefined" ? window.location.search : "",
        }),
      );
    };
    rebuild();
    const unsub = subscribeIdeateCloud(rebuild);
    window.addEventListener("storage", rebuild);
    window.addEventListener(CREATE_SESSION_CHANGED_EVENT, rebuild);
    return () => {
      unsub();
      window.removeEventListener("storage", rebuild);
      window.removeEventListener(CREATE_SESSION_CHANGED_EVENT, rebuild);
    };
  }, [pathname]);

  const mobileCrumbs =
    crumbs.length <= 2
      ? crumbs
      : [crumbs[0]!, crumbs[crumbs.length - 1]!];
  const mobileHasEllipsis = crumbs.length > 2;

  return (
    <header className="relative sticky top-0 z-[130] flex h-14 w-full shrink-0 items-center border-b border-border bg-background">
      {/* Desktop: brand aligned with sidebar. Mobile: brand + breadcrumbs left. */}
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
        <div className="flex min-w-0 items-center gap-4 md:gap-2">
          <Link
            href="/"
            className="inline-flex shrink-0 items-center md:hidden"
          >
            <LogoMark
              size={24}
              className="relative z-[1] mr-1.5 shrink-0 text-accent-button"
            />
            <span className="brand-wordmark font-display text-lg font-medium tracking-tight lowercase">
              consciously
            </span>
          </Link>

          {/* Mobile: first … last */}
          {mobileCrumbs.length > 0 ? (
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 items-center truncate font-display text-base font-medium tracking-tight md:hidden"
            >
              {mobileCrumbs.map((c, i) => {
                const last = i === mobileCrumbs.length - 1;
                return (
                  <Fragment key={`m-${c.label}-${i}`}>
                    {i > 0 ? (
                      <>
                        <BreadcrumbChevron />
                        {mobileHasEllipsis && i === 1 ? (
                          <>
                            <span className="shrink-0 text-muted" aria-hidden>
                              …
                            </span>
                            <BreadcrumbChevron />
                          </>
                        ) : null}
                      </>
                    ) : null}
                    <BreadcrumbCrumb crumb={c} last={last} />
                  </Fragment>
                );
              })}
            </nav>
          ) : null}

          {/* Desktop: full trail */}
          <nav
            aria-label="Breadcrumb"
            className="hidden min-w-0 items-center truncate font-display text-lg font-medium tracking-tight md:flex"
          >
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <Fragment key={`${c.label}-${i}`}>
                  {i > 0 ? <BreadcrumbChevron /> : null}
                  <BreadcrumbCrumb crumb={c} last={last} />
                </Fragment>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="absolute right-3 top-1/2 z-20 flex -translate-y-1/2 items-center gap-2 sm:right-4">
        <AppTopBarTrailingSlot className="flex max-w-[min(100vw-11rem,28rem)] items-center justify-end overflow-x-auto" />
        <div className="hidden md:contents">
          <AlphaChromeButton
            title="Alpha — show marketing site without clearing session"
            onClick={() => {
              enterMarketingPreviewMode();
              router.push("/");
            }}
          >
            View marketing page
          </AlphaChromeButton>
        </div>
        {onToggleSidebar ? (
          <button
            type="button"
            aria-label={mobileSidebarOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileSidebarOpen}
            onClick={onToggleSidebar}
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
              {mobileSidebarOpen ? (
                <>
                  <path d="M6 6l12 12" />
                  <path d="M18 6L6 18" />
                </>
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        ) : null}
      </div>

      {/* True viewport centre (full header width), not content-area centre. */}
      <div className="pointer-events-none absolute inset-0 z-[5] hidden items-center justify-center md:flex">
        <AppPrimaryTabsSlot className="pointer-events-auto flex max-w-[min(100%,48rem)] items-center justify-center overflow-x-auto" />
      </div>
    </header>
  );
}
