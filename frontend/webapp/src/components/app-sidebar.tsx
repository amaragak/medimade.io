"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BookOpen, Code2, Focus, Lightbulb, Moon, Shield, Sun } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  APP_NAV_ADMIN,
  APP_NAV_MAIN,
  activeNavSectionId,
  isSubItemActive,
  loadSidebarExpandState,
  saveSidebarExpandState,
  type AppNavSection,
  type AppNavSubItem,
} from "@/lib/app-nav";
import { AlphaChromeButton } from "@/components/dev-chrome-button";
import {
  COLOR_SCHEME_CHANGED_EVENT,
  applyColorScheme,
  getStoredColorScheme,
  toggleColorScheme,
  type ColorScheme,
} from "@/lib/color-scheme";
import { clearMedimadeSession, isMedimadeSessionActive } from "@/lib/auth-session";
import { enterMarketingPreviewMode } from "@/lib/marketing-preview";
import { loadIdeateStore } from "@/lib/plan-ideate-store";
import {
  pullIdeateStoreFromCloud,
  subscribeIdeateCloud,
} from "@/lib/ideate-cloud";
import { isDemoIdeateDream } from "@/lib/ideate-demo-seed";

function ColorSchemeToggle() {
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
      className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
    >
      {isDark ? (
        <Sun aria-hidden className="size-4" strokeWidth={2} />
      ) : (
        <Moon aria-hidden className="size-4" strokeWidth={2} />
      )}
    </button>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const SECTION_ICONS: Record<string, ReactNode> = {
  meditate: (
    // Material Icons "self_improvement" — person in lotus posture (Apache-2.0).
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      aria-hidden
      className="size-[18px] shrink-0"
    >
      <circle cx="12" cy="6" r="2" />
      <path d="M21 16v-2c-2.24 0-4.16-.96-5.6-2.68l-1.34-1.6A1.98 1.98 0 0 0 12.53 9h-1.05c-.59 0-1.15.26-1.53.72l-1.34 1.6C7.16 13.04 5.24 14 3 14v2c2.77 0 5.19-1.17 7-3.25V15l-3.88 1.55c-.67.27-1.12.93-1.12 1.66C5 19.2 5.8 20 6.79 20H9v-.5a2.5 2.5 0 0 1 2.5-2.5h3c.28 0 .5.22.5.5s-.22.5-.5.5h-3c-.83 0-1.5.67-1.5 1.5v.5h7.21c.99 0 1.79-.8 1.79-1.79 0-.73-.45-1.39-1.12-1.66L14 15v-2.25c1.81 2.08 4.23 3.25 7 3.25z" />
    </svg>
  ),
  journal: <BookOpen aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />,
  ideate: <Lightbulb aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />,
  focus: <Focus aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />,
  admin: <Shield aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />,
  api: <Code2 aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />,
};

function NavSectionBlock({
  section,
  items,
  expanded,
  onToggle,
  pathname,
  hash,
  search,
  onNavigate,
  emptyAction,
}: {
  section: AppNavSection;
  /** Override static section.children when provided. */
  items?: AppNavSubItem[];
  expanded: boolean;
  onToggle: () => void;
  pathname: string;
  hash: string;
  search: string;
  onNavigate?: () => void;
  /** Shown under children when the list has no dynamic items (e.g. add life area). */
  emptyAction?: { href: string; label: string };
}) {
  const subs = items ?? section.children ?? [];
  const hasChildren = subs.length > 0 || Boolean(emptyAction);
  const sectionActive = activeNavSectionId(pathname) === section.id;
  const icon = SECTION_ICONS[section.id];

  return (
    <div className="px-2">
      <div className="flex items-center gap-0.5">
        <Link
          href={section.href}
          onClick={onNavigate}
          className={`flex min-w-0 flex-1 items-center gap-2 truncate rounded-lg px-2.5 py-2 text-[15px] transition-colors hover:bg-nav-active hover:text-foreground ${
            sectionActive && !hasChildren
              ? "font-semibold text-accent-link"
              : sectionActive
                ? "font-semibold text-foreground"
                : "text-muted"
          }`}
        >
          {icon ?? null}
          <span className="min-w-0 truncate">{section.label}</span>
        </Link>
        {hasChildren ? (
          <button
            type="button"
            aria-label={
              expanded
                ? `Collapse ${section.label}`
                : `Expand ${section.label}`
            }
            aria-expanded={expanded}
            onClick={onToggle}
            className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-nav-active hover:text-foreground"
          >
            <ChevronIcon expanded={expanded} />
          </button>
        ) : null}
      </div>
      {hasChildren && expanded ? (
        <ul className="mb-1 ml-2 mt-0.5 space-y-0.5 border-l border-border/80 pl-2">
          {subs.map((sub) => {
            const active = isSubItemActive(
              pathname,
              hash,
              search,
              sub,
              section.id,
            );
            return (
              <li key={sub.id} className="flex items-center gap-0.5">
                <Link
                  href={sub.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-nav-active ${
                    active
                      ? "font-medium text-accent-link"
                      : "text-muted"
                  }`}
                >
                  <span
                    className={`size-1 shrink-0 rounded-full ${
                      active ? "bg-accent" : "bg-muted/50"
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">{sub.label}</span>
                </Link>
                {sub.actionHref ? (
                  <Link
                    href={sub.actionHref}
                    onClick={onNavigate}
                    aria-label={sub.actionAriaLabel ?? `New ${sub.label}`}
                    title={sub.actionAriaLabel ?? `New ${sub.label}`}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-base font-medium leading-none text-muted transition-colors hover:bg-nav-active hover:text-accent-link"
                  >
                    +
                  </Link>
                ) : null}
              </li>
            );
          })}
          {emptyAction ? (
            <li>
              <Link
                href={emptyAction.href}
                onClick={onNavigate}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-muted transition-colors hover:bg-nav-active hover:text-foreground"
              >
                <span
                  className="size-1 shrink-0 rounded-full bg-muted/50"
                  aria-hidden
                />
                <span className="min-w-0 truncate">{emptyAction.label}</span>
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

type Props = {
  accountLabel: string;
  mobileOpen?: boolean;
  onNavigate?: () => void;
  onCloseMobile?: () => void;
};

export function AppSidebar({
  accountLabel,
  mobileOpen = false,
  onNavigate,
  onCloseMobile,
}: Props) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [hash, setHash] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lifeAreas, setLifeAreas] = useState<
    { id: string; title: string }[]
  >([]);

  useEffect(() => {
    setHash(window.location.hash || "");
    setSearch(window.location.search || "");
    const onHash = () => setHash(window.location.hash || "");
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [pathname]);

  useEffect(() => {
    setSearch(window.location.search || "");
  }, [pathname]);

  useEffect(() => {
    const syncLifeAreas = () => {
      const dreams = loadIdeateStore().dreams.filter((d) => !isDemoIdeateDream(d));
      const ordered = [...dreams].sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setLifeAreas(
        ordered.map((d) => ({
          id: d.id,
          title: d.title.trim() || "Untitled",
        })),
      );
    };
    syncLifeAreas();
    const unsub = subscribeIdeateCloud(syncLifeAreas);
    if (isMedimadeSessionActive()) {
      void pullIdeateStoreFromCloud().finally(syncLifeAreas);
    }
    window.addEventListener("medimade-session-changed", syncLifeAreas);
    return () => {
      unsub();
      window.removeEventListener("medimade-session-changed", syncLifeAreas);
    };
  }, []);

  useEffect(() => {
    const stored = loadSidebarExpandState();
    const active = activeNavSectionId(pathname);
    const next: Record<string, boolean> = { ...stored };
    for (const section of [...APP_NAV_MAIN, ...APP_NAV_ADMIN]) {
      if (section.children?.length) {
        if (next[section.id] === undefined) {
          next[section.id] = true;
        }
      }
    }
    if (active && APP_NAV_MAIN.some((s) => s.id === active && s.children?.length)) {
      if (stored[active] !== false) next[active] = true;
    }
    setExpanded(next);
  }, [pathname]);

  function toggleSection(id: string) {
    setExpanded((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveSidebarExpandState(next);
      return next;
    });
  }

  const ideateChildren = useMemo((): AppNavSubItem[] => {
    const base =
      APP_NAV_MAIN.find((s) => s.id === "ideate")?.children?.slice() ?? [];
    return [
      ...base,
      ...lifeAreas.map((d) => ({
        id: `life-area:${d.id}`,
        label: d.title,
        href: `/ideate/goal/${encodeURIComponent(d.id)}`,
      })),
    ];
  }, [lifeAreas]);

  const asideClass = useMemo(
    () =>
      [
        "flex w-[200px] shrink-0 flex-col border-r-[0.5px] border-border bg-surface-2",
        "fixed bottom-0 left-0 top-14 z-[120] transition-transform duration-200 ease-out",
        // Mobile: off-canvas until hamburger opens. Desktop: always visible.
        mobileOpen ? "translate-x-0 shadow-xl" : "-translate-x-full",
        "md:translate-x-0",
      ].join(" "),
    [mobileOpen],
  );

  return (
    <>
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 top-14 z-[110] bg-black/30 md:hidden"
          onClick={onCloseMobile}
        />
      ) : null}
      <aside className={asideClass} aria-label="App">
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-3">
          {APP_NAV_MAIN.map((section) => (
            <NavSectionBlock
              key={section.id}
              section={section}
              items={
                section.id === "ideate" ? ideateChildren : section.children
              }
              emptyAction={
                section.id === "ideate" && lifeAreas.length === 0
                  ? {
                      href: "/ideate/my?new=1",
                      label: "Add a life area",
                    }
                  : undefined
              }
              expanded={Boolean(expanded[section.id])}
              onToggle={() => toggleSection(section.id)}
              pathname={pathname}
              hash={hash}
              search={search}
              onNavigate={onNavigate}
            />
          ))}

          <div className="mx-3 my-3 border-t border-border" role="separator" />

          {APP_NAV_ADMIN.map((section) => (
            <NavSectionBlock
              key={section.id}
              section={section}
              expanded={false}
              onToggle={() => undefined}
              pathname={pathname}
              hash={hash}
              search={search}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto shrink-0 border-t border-border px-2 py-3">
          <div className="mb-1 flex items-center justify-end px-1">
            <ColorSchemeToggle />
          </div>
          <Link
            href="/settings"
            onClick={onNavigate}
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[15px] text-muted transition-colors hover:bg-nav-active hover:text-foreground"
            title={accountLabel}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft/80 text-xs font-semibold text-accent-link">
              {(accountLabel.trim()[0] || "G").toUpperCase()}
            </span>
            <span className="min-w-0 truncate">{accountLabel}</span>
          </Link>
          <div className="mt-2 flex flex-col gap-1.5 px-1">
            <button
              type="button"
              onClick={() => {
                clearMedimadeSession();
                onNavigate?.();
              }}
              className="cursor-pointer rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-nav-active"
            >
              Sign out
            </button>
            <Link
              href="/pro"
              onClick={onNavigate}
              className="rounded-lg border border-accent/70 bg-transparent px-2.5 py-1.5 text-sm font-medium text-accent-link transition-colors hover:bg-accent-soft/40"
            >
              Pro
            </Link>
            <AlphaChromeButton
              className="mt-1 w-full justify-center md:hidden"
              title="Alpha — show marketing site without clearing session"
              onClick={() => {
                enterMarketingPreviewMode();
                onNavigate?.();
                router.push("/");
              }}
            >
              View marketing page
            </AlphaChromeButton>
          </div>
        </div>
      </aside>
    </>
  );
}
