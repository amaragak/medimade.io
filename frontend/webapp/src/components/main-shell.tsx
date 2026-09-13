"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLibraryPlayer } from "@/components/library-player-provider";
import {
  FOCUS_PATTERN_CHANGED_EVENT,
  loadFocusPattern,
  type FocusPatternId,
} from "@/lib/focus-pattern";
import { isMarketingHeroRoute } from "@/lib/marketing-hero-routes";

function usePatternTileHeight(
  contentRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
) {
  const [heightPx, setHeightPx] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) {
      setHeightPx(0);
      return;
    }

    const el = contentRef.current;
    if (!el) return;

    const measure = () => {
      setHeightPx(Math.max(el.scrollHeight, el.offsetHeight));
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);

    const mo = new MutationObserver(measure);
    mo.observe(el, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [contentRef, enabled]);

  return heightPx;
}

export function MainShell({
  children,
  layout = "default",
}: {
  children: ReactNode;
  /** Signed-in app: flush-left content column + right-only pattern gutter. */
  layout?: "default" | "app";
}) {
  const pathname = usePathname() || "/";
  const isHeroPage =
    layout !== "app" && isMarketingHeroRoute(pathname);
  const isFocusApp =
    layout === "app" &&
    (pathname === "/focus/my" || pathname.startsWith("/focus/my/"));
  const contentRef = useRef<HTMLDivElement>(null);
  const patternTileActive = !isHeroPage;
  const tileHeightPx = usePatternTileHeight(contentRef, patternTileActive);
  const [focusPattern, setFocusPattern] = useState<FocusPatternId>("default");
  const { nowPlaying, playerStripHeightPx } = useLibraryPlayer();
  // Focus keeps the timer composition fixed; the strip overlays instead of padding the page.
  const playerPad =
    !isFocusApp && nowPlaying && playerStripHeightPx > 0
      ? playerStripHeightPx + 16
      : 0;

  useEffect(() => {
    if (!isFocusApp) return;
    const sync = () => setFocusPattern(loadFocusPattern());
    sync();
    window.addEventListener(FOCUS_PATTERN_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(FOCUS_PATTERN_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [isFocusApp]);

  return (
    <main
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-background"
      data-page-kind={isHeroPage ? "hero" : "standard"}
      data-app-layout={
        layout === "app" ? (isFocusApp ? "focus" : "signed-in") : undefined
      }
      data-focus-pattern={isFocusApp ? focusPattern : undefined}
      style={playerPad > 0 ? { paddingBottom: playerPad } : undefined}
    >
      {patternTileActive && tileHeightPx > 0 ? (
        <div
          className="page-pattern-tile"
          aria-hidden
          style={{ height: `${tileHeightPx}px` }}
        />
      ) : null}
      <div
        ref={contentRef}
        className="relative z-[1] flex min-h-0 w-full flex-1 flex-col"
      >
        {children}
      </div>
    </main>
  );
}
