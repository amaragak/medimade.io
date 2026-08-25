"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { isHardDocumentEntry } from "@/lib/spa-client-nav";

const HEADLINE = "Live Consciously.";
const STRAPLINE = "with our suite of self reflection tools.";

function TypeInPlace({
  full,
  typed,
  className,
}: {
  full: string;
  typed: string;
  className: string;
}) {
  return (
    <span className={`relative inline-grid max-w-full ${className}`}>
      {/* Invisible final string reserves width so glyphs don’t reflow from center. */}
      <span className="invisible col-start-1 row-start-1" aria-hidden>
        {full}
      </span>
      <span className="col-start-1 row-start-1 text-left" aria-hidden>
        {typed || "\u00a0"}
      </span>
    </span>
  );
}

/**
 * Homepage headline + strapline typewriter — hard entry only (refresh / URL).
 * Strapline starts after the headline finishes. Letters appear in final position.
 */
export function HomeHeadlineTypewriter() {
  const [headline, setHeadline] = useState("");
  const [strapline, setStrapline] = useState("");

  useLayoutEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !isHardDocumentEntry()) {
      setHeadline(HEADLINE);
      setStrapline(STRAPLINE);
    }
  }, []);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !isHardDocumentEntry()) {
      return;
    }

    let cancelled = false;
    let i = 0;

    setHeadline("");
    setStrapline("");

    const typeHeadline = () => {
      if (cancelled) return;
      i += 1;
      setHeadline(HEADLINE.slice(0, i));
      if (i < HEADLINE.length) {
        window.setTimeout(typeHeadline, 28);
      } else {
        window.setTimeout(typeStrapline, 120);
      }
    };

    let j = 0;
    const typeStrapline = () => {
      if (cancelled) return;
      j += 1;
      setStrapline(STRAPLINE.slice(0, j));
      if (j < STRAPLINE.length) {
        window.setTimeout(typeStrapline, 14);
      }
    };

    const start = window.setTimeout(typeHeadline, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
    };
  }, []);

  return (
    <div className="contents">
      <h1
        className="max-w-3xl font-display text-4xl font-medium leading-tight tracking-tight text-marketing-ink sm:text-5xl md:text-[3.5rem]"
        aria-label={HEADLINE}
      >
        <TypeInPlace full={HEADLINE} typed={headline} className="" />
      </h1>
      <p
        className="mt-4 max-w-xl text-base leading-relaxed text-marketing-body sm:text-lg"
        aria-label={STRAPLINE}
      >
        <TypeInPlace full={STRAPLINE} typed={strapline} className="" />
      </p>
    </div>
  );
}
