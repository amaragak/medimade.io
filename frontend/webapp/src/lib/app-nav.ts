/**
 * Logged-in sidebar navigation tree + breadcrumb helpers.
 */

export type AppNavSubItem = {
  id: string;
  label: string;
  href: string;
};

export type AppNavSection = {
  id: string;
  label: string;
  /** Primary destination when the section label is clicked. */
  href: string;
  children?: AppNavSubItem[];
};

export const APP_NAV_MAIN: AppNavSection[] = [
  {
    id: "meditate",
    label: "Meditate",
    href: "/meditate/library/creations",
    children: [
      { id: "create", label: "Create", href: "/meditate/create" },
      { id: "library", label: "Library", href: "/meditate/library/creations" },
      { id: "sounds", label: "Sounds", href: "/meditate/sounds" },
    ],
  },
  {
    id: "journal",
    label: "Journal",
    href: "/journal/my",
    children: [
      { id: "new", label: "New entry", href: "/journal/my?new=1" },
      { id: "entries", label: "Entries", href: "/journal/my" },
    ],
  },
  {
    id: "ideate",
    label: "Ideate",
    href: "/ideate/my",
    children: [
      { id: "overview", label: "Overview", href: "/ideate/my" },
      { id: "vision-board", label: "Vision board", href: "/ideate/my/vision-board" },
      // Life areas are injected dynamically in AppSidebar (not static nav).
    ],
  },
  {
    id: "focus",
    label: "Focus",
    href: "/focus",
  },
];

export const APP_NAV_ADMIN: AppNavSection[] = [
  { id: "admin", label: "Admin", href: "/admin" },
  { id: "api", label: "API", href: "/settings" },
];

export const SIDEBAR_EXPAND_STORAGE_KEY = "mm_sidebar_expand_v1";

export function pathMatchesHref(pathname: string, href: string): boolean {
  const pathOnly = href.split("#")[0]?.split("?")[0] ?? href;
  if (pathOnly === "/") return pathname === "/";
  if (pathname === pathOnly) return true;
  // Library tabs share a prefix.
  if (pathOnly === "/meditate/library/creations") {
    return pathname.startsWith("/meditate/library");
  }
  if (pathOnly === "/meditate/create") {
    return pathname === "/meditate/create" || pathname.startsWith("/meditate/create/");
  }
  if (pathOnly === "/meditate/sounds") {
    return pathname === "/meditate/sounds" || pathname.startsWith("/meditate/sounds/");
  }
  if (pathOnly === "/journal/my") {
    return pathname === "/journal/my" || pathname.startsWith("/journal/my/");
  }
  if (pathOnly === "/ideate/my") {
    // Exact overview only — `/ideate/my/vision-board` is a sibling link.
    return pathname === "/ideate/my";
  }
  if (pathOnly === "/ideate/my/vision-board") {
    return (
      pathname === "/ideate/my/vision-board" ||
      pathname.startsWith("/ideate/my/vision-board/")
    );
  }
  if (pathOnly === "/admin") {
    return pathname === "/admin" || pathname.startsWith("/admin/");
  }
  return pathname.startsWith(`${pathOnly}/`);
}

export function activeNavSectionId(pathname: string): string | null {
  if (
    pathname.startsWith("/meditate") ||
    pathname.startsWith("/create") ||
    pathname.startsWith("/library")
  ) {
    return "meditate";
  }
  if (pathname.startsWith("/journal")) return "journal";
  if (pathname.startsWith("/ideate") || pathname.startsWith("/dream")) {
    return "ideate";
  }
  if (pathname.startsWith("/focus") || pathname.startsWith("/extension")) {
    return "focus";
  }
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/settings") || pathname.startsWith("/account")) {
    return "api";
  }
  return null;
}

export function isSubItemActive(
  pathname: string,
  hash: string,
  search: string,
  sub: AppNavSubItem,
  sectionId: string,
): boolean {
  if (sectionId === "journal" && sub.id === "new") {
    return (
      (pathname === "/journal/my" || pathname.startsWith("/journal/my/")) &&
      new URLSearchParams(search).get("new") === "1"
    );
  }
  if (sectionId === "journal" && sub.id === "entries") {
    if (new URLSearchParams(search).get("new") === "1") return false;
    return pathMatchesHref(pathname, sub.href);
  }
  if (sectionId === "ideate" && sub.id === "overview") {
    if (pathname.startsWith("/ideate/goal/")) return false;
    return (
      pathname === "/ideate/my" ||
      pathname.startsWith("/ideate/my/")
    );
  }
  if (sectionId === "ideate" && sub.id.startsWith("life-area:")) {
    const dreamId = sub.id.slice("life-area:".length);
    const m = pathname.match(/^\/ideate\/goal\/([^/?#]+)/);
    if (!m?.[1]) return false;
    try {
      return decodeURIComponent(m[1]) === dreamId;
    } catch {
      return m[1] === dreamId;
    }
  }
  return pathMatchesHref(pathname, sub.href);
}

export type AppBreadcrumbCrumb = {
  label: string;
  href: string | null;
};

/**
 * Build breadcrumb crumbs for the logged-in top bar (no brand).
 * `lifeAreaTitle` is used when on `/ideate/goal/[id]`.
 */
export function buildAppBreadcrumbs(
  pathname: string,
  opts?: { lifeAreaTitle?: string | null; hash?: string; search?: string },
): AppBreadcrumbCrumb[] {
  const hash = opts?.hash ?? "";
  const search = opts?.search ?? "";

  if (pathname.startsWith("/meditate/create") || pathname.startsWith("/create")) {
    return [
      { label: "Meditate", href: "/meditate/library/creations" },
      { label: "Create", href: null },
    ];
  }
  if (pathname.startsWith("/meditate/library") || pathname.startsWith("/meditate/sounds")) {
    const leaf = pathname.startsWith("/meditate/sounds") ? "Sounds" : "Library";
    return [
      { label: "Meditate", href: "/meditate/library/creations" },
      { label: leaf, href: null },
    ];
  }
  if (pathname === "/meditate" || pathname.startsWith("/meditate/")) {
    return [
      { label: "Meditate", href: "/meditate/library/creations" },
      { label: "Overview", href: null },
    ];
  }

  if (pathname.startsWith("/journal")) {
    if (new URLSearchParams(search).get("new") === "1") {
      return [
        { label: "Journal", href: "/journal/my" },
        { label: "New entry", href: null },
      ];
    }
    if (pathname.startsWith("/journal/my")) {
      return [
        { label: "Journal", href: "/journal/my" },
        { label: "Entries", href: null },
      ];
    }
    return [{ label: "Journal", href: null }];
  }

  if (pathname.startsWith("/ideate/goal/")) {
    const title = opts?.lifeAreaTitle?.trim() || "Life area";
    return [
      { label: "Ideate", href: "/ideate/my" },
      { label: title, href: null },
    ];
  }
  if (pathname.startsWith("/ideate")) {
    if (pathname.startsWith("/ideate/my/vision-board")) {
      return [
        { label: "Ideate", href: "/ideate/my" },
        { label: "Vision board", href: null },
      ];
    }
    if (pathname.startsWith("/ideate/my")) {
      if (new URLSearchParams(search).get("new") === "1") {
        return [
          { label: "Ideate", href: "/ideate/my" },
          { label: "New life area", href: null },
        ];
      }
      return [
        { label: "Ideate", href: "/ideate/my" },
        { label: "Overview", href: null },
      ];
    }
    return [{ label: "Ideate", href: null }];
  }

  if (pathname.startsWith("/focus")) {
    return [{ label: "Focus", href: null }];
  }
  if (pathname.startsWith("/admin")) {
    return [{ label: "Admin", href: null }];
  }
  if (pathname.startsWith("/settings")) {
    return [{ label: "API", href: null }];
  }
  if (pathname.startsWith("/pro")) {
    return [{ label: "Pro", href: null }];
  }
  if (pathname.startsWith("/account")) {
    return [{ label: "Account", href: null }];
  }
  if (pathname === "/") {
    return [{ label: "Home", href: null }];
  }
  return [];
}

export function loadSidebarExpandState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SIDEBAR_EXPAND_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSidebarExpandState(state: Record<string, boolean>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      SIDEBAR_EXPAND_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    /* ignore */
  }
}
