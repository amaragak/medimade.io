"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
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

export function MainShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isHeroPage = isMarketingHeroRoute(pathname);
  const contentRef = useRef<HTMLDivElement>(null);
  const patternTileActive = !isHeroPage;
  const tileHeightPx = usePatternTileHeight(contentRef, patternTileActive);

  return (
    <main
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain bg-background"
      data-page-kind={isHeroPage ? "hero" : "standard"}
    >
      {patternTileActive && tileHeightPx > 0 ? (
        <div
          className="page-pattern-tile"
          aria-hidden
          style={{ height: `${tileHeightPx}px` }}
        />
      ) : null}
      <div ref={contentRef} className="relative z-[1] flex w-full flex-col">
        {children}
      </div>
    </main>
  );
}
